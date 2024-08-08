const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const dotenv = require('dotenv');
const { Sequelize, TelegramUser, MessageLog } = require('./models');

dotenv.config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const YANDEX_TRACKER_URL = process.env.YANDEX_TRACKER_URL;
const YANDEX_TRACKER_ORG_ID = process.env.YANDEX_TRACKER_ORG_ID;
const YANDEX_TRACKER_OAUTH_TOKEN = process.env.YANDEX_TRACKER_OAUTH_TOKEN;
const YANDEX_TRACKER_QUEUE = process.env.YANDEX_TRACKER_QUEUE;

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

const states = {};
const SUMMARY = 'SUMMARY';
const DESCRIPTION = 'DESCRIPTION';
const EMAIL = 'EMAIL';
const VERIFICATION = 'VERIFICATION';
const IMAGE = 'IMAGE';

const allowedDomains = ['kurganmk', 'reftp', 'hobbs-it'];
const emailVerificationCodes = {};

const replyKeyboard = {
    reply_markup: {
        keyboard: [['📝 Создать задачу', '❌ Отмена']],
        one_time_keyboard: true,
        resize_keyboard: true,
    },
};

const removeKeyboard = {
    reply_markup: {
        remove_keyboard: true,
    },
};

// Функция для создания задачи
const createTask = async (summary, description, login, imagePath) => {
    const headers = {
        'Authorization': `OAuth ${YANDEX_TRACKER_OAUTH_TOKEN}`,
        'X-Cloud-Org-ID': YANDEX_TRACKER_ORG_ID,
    };

    const formData = new FormData();
    formData.append('summary', summary);
    formData.append('description', description);
    formData.append('queue', YANDEX_TRACKER_QUEUE);
    formData.append('followers', login);
    formData.append('author', login);

    if (imagePath) {
        const file = fs.createReadStream(imagePath);
        formData.append('attachments', file);
    }

    try {
        const response = await axios.post(YANDEX_TRACKER_URL, formData, {
            headers: {
                ...headers,
                ...formData.getHeaders(),
            },
        });
        return response.data;
    } catch (error) {
        console.error('Error creating task:', error.response ? error.response.data : error.message);
        throw error;
    } finally {
        if (imagePath) {
            await fs.unlink(imagePath); // Удаляем файл после его отправки в трекер
        }
    }
};

// Обработка сообщений
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    const currentState = states[chatId];

    // Логирование сообщений
    try {
        await MessageLog.create({ telegramId: chatId, message: text || 'No text in message' });
    } catch (error) {
        console.error('Ошибка при логировании сообщения:', error);
    }

    // Отмена действия
    if (text === '❌ Отмена') {
        delete states[chatId];
        bot.sendMessage(chatId, 'Действие отменено.', replyKeyboard);
        return;
    }

    // Обработка состояния EMAIL
    if (currentState && currentState.state === EMAIL) {
        const email = text;
        const emailParts = email.split('@');
        const domain = emailParts[1] ? emailParts[1].split('.')[0] : '';

        if (!allowedDomains.includes(domain)) {
            bot.sendMessage(chatId, 'Недопустимый домен почты. Пожалуйста, введите корпоративную почту с допустимым доменом (kurganmk, reftp, hobbs-it).', removeKeyboard);
        } else {
            const login = emailParts[0];
            const code = Math.floor(100000 + Math.random() * 900000);
            emailVerificationCodes[chatId] = code;

            try {
                await sendVerificationEmail(email, code);
                states[chatId].email = email;
                states[chatId].state = VERIFICATION;
                bot.sendMessage(chatId, 'Код подтверждения отправлен на вашу почту. Пожалуйста, введите его для завершения регистрации. Если кода нет в основной папке почты, проверьте папку Спам.', removeKeyboard);
            } catch (error) {
                bot.sendMessage(chatId, 'Ошибка при отправке кода подтверждения. Пожалуйста, попробуйте снова позже.', replyKeyboard);
            }
        }
    } else if (currentState && currentState.state === VERIFICATION) {
        const enteredCode = parseInt(text, 10);
        if (emailVerificationCodes[chatId] && emailVerificationCodes[chatId] === enteredCode) {
            const email = currentState.email;
            await TelegramUser.create({ telegramId: chatId, email });
            delete states[chatId];
            bot.sendMessage(chatId, 'Почта успешно подтверждена. Выберите команду для продолжения:', replyKeyboard);
        } else {
            bot.sendMessage(chatId, 'Неверный код подтверждения. Пожалуйста, попробуйте снова.', removeKeyboard);
        }
    } else if (text === '📝 Создать задачу') {
        const user = await TelegramUser.findByPk(chatId);
        if (!user) {
            bot.sendMessage(chatId, 'Пожалуйста, введите вашу корпоративную почту для начала:', removeKeyboard);
            states[chatId] = { state: EMAIL };
        } else {
            states[chatId] = { state: SUMMARY };
            bot.sendMessage(chatId, 'Пожалуйста, введите название задачи.', removeKeyboard);
        }
    } else if (currentState && currentState.state === SUMMARY) {
        states[chatId].summary = text;
        states[chatId].state = DESCRIPTION;
        bot.sendMessage(chatId, 'Теперь введите описание задачи.', {
            reply_markup: {
                keyboard: [['🔙 Назад', '❌ Отмена']],
                one_time_keyboard: true,
                resize_keyboard: true,
            },
        });
    } else if (currentState && currentState.state === DESCRIPTION) {
        if (text === '🔙 Назад') {
            states[chatId].state = SUMMARY;
            bot.sendMessage(chatId, 'Пожалуйста, введите название задачи.', removeKeyboard);
        } else {
            states[chatId].description = text;
            states[chatId].state = IMAGE;
            bot.sendMessage(chatId, 'Хотите добавить изображение к задаче? Если нет, отправьте /skip.', {
                reply_markup: {
                    keyboard: [['/skip', '❌ Отмена']],
                    one_time_keyboard: true,
                    resize_keyboard: true,
                },
            });
        }
    } else if (currentState && currentState.state === IMAGE) {
        if (msg.photo) {
            const fileId = msg.photo[msg.photo.length - 1].file_id;
            const filePath = await bot.getFileLink(fileId);
            const imagePath = path.join(__dirname, 'uploads', `${fileId}.jpg`);

            try {
                // Проверяем, существует ли папка, и создаем её, если нет
                const uploadDir = path.join(__dirname, 'uploads');
                try {
                    await fs.mkdir(uploadDir, { recursive: true });
                } catch (err) {
                    console.error('Ошибка при создании директории uploads:', err);
                }

                // Скачиваем файл
                const response = await axios({
                    url: filePath,
                    method: 'GET',
                    responseType: 'arraybuffer',
                });

                // Сохраняем файл
                await fs.writeFile(imagePath, response.data);
                console.log('Файл успешно сохранен:', imagePath);

                const { summary, description } = currentState;
                const user = await TelegramUser.findByPk(chatId);

                try {
                    const task = await createTask(summary, description, user.email.split('@')[0], imagePath);
                    bot.sendMessage(chatId, `Задача создана успешно: ${task.key}`, replyKeyboard);
                } catch (error) {
                    bot.sendMessage(chatId, `Ошибка при создании задачи: ${error.message}`, replyKeyboard);
                }
                delete states[chatId];
            } catch (error) {
                console.error('Ошибка при обработке изображения:', error);
                bot.sendMessage(chatId, 'Произошла ошибка при обработке изображения. Пожалуйста, попробуйте еще раз.', replyKeyboard);
                delete states[chatId];
            }
        } else if (text === '/skip') {
            const { summary, description } = currentState;
            const user = await TelegramUser.findByPk(chatId);

            try {
                const task = await createTask(summary, description, user.email.split('@')[0], null);
                bot.sendMessage(chatId, `Задача создана успешно: ${task.key}`, replyKeyboard);
            } catch (error) {
                bot.sendMessage(chatId, `Ошибка при создании задачи: ${error.message}`, replyKeyboard);
            }
            delete states[chatId];
        } else {
            bot.sendMessage(chatId, 'Пожалуйста, отправьте изображение или нажмите /skip, чтобы пропустить этот шаг.', removeKeyboard);
        }
    }
});

bot.on('polling_error', (error) => {
    console.error('Polling error:', error);
});
