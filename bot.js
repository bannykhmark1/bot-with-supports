const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const dotenv = require('dotenv');
const nodemailer = require('nodemailer');
const { sequelize, TelegramUser, Image } = require('./models'); // Импортируем модели

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

const transporter = nodemailer.createTransport({
    host: 'connect.smtp.bz',
    port: 587,
    secure: false,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

const sendVerificationEmail = async (email, code) => {
    const htmlContent = `
        <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #333;">
            <h2 style="color: #4CAF50;">Код верификации</h2>
            <p>Ваш код верификации: <strong style="font-size: 1.2em;">${code}</strong></p>
            <p>Введите его в Телеграм боте, чтобы создать задачу.</p>
            <p>Спасибо!</p>
            <p style="color: #999; font-size: 0.9em;">Это письмо сгенерировано автоматически. Пожалуйста, не отвечайте на него.</p>
        </div>
    `;

    try {
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Код верификации',
            html: htmlContent,
        });
        console.log('Verification email sent successfully');
    } catch (error) {
        console.error('Error sending verification email:', error);
        throw error;
    }
};

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
const createTask = async (summary, description, login, imageData) => {
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

    if (imageData) {
        formData.append('attachments', imageData, { filename: 'image.jpg' });
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
    }
};

bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    delete states[chatId];

    const user = await TelegramUser.findByPk(chatId);
    if (user) {
        bot.sendMessage(chatId, 'Привет! Выберите команду для продолжения:', replyKeyboard);
    } else {
        bot.sendMessage(chatId, 'Привет! Введите вашу корпоративную почту для продолжения:', removeKeyboard);
        states[chatId] = { state: EMAIL };
    }
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    console.log('Received message:', text);
    console.log('Current state:', states[chatId]);

    // Проверка на наличие текста в сообщении
    if (text) {
        await MessageLog.create({ telegramId: chatId, message: text });
    } else {
        await MessageLog.create({ telegramId: chatId, message: 'No text in message' });
    }

    if (text === '❌ Отмена') {
        delete states[chatId];
        bot.sendMessage(chatId, 'Действие отменено.', replyKeyboard);
    } else if (states[chatId] && states[chatId].state === EMAIL) {
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
    } else if (states[chatId] && states[chatId].state === VERIFICATION) {
        const enteredCode = parseInt(text, 10);
        if (emailVerificationCodes[chatId] && emailVerificationCodes[chatId] === enteredCode) {
            const email = states[chatId].email;
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
    } else if (states[chatId] && states[chatId].state === SUMMARY) {
        states[chatId].summary = text;
        states[chatId].state = DESCRIPTION;
        bot.sendMessage(chatId, 'Теперь введите описание задачи.', {
            reply_markup: {
                keyboard: [['🔙 Назад', '❌ Отмена']],
                one_time_keyboard: true,
                resize_keyboard: true,
            },
        });
    } else if (states[chatId] && states[chatId].state === DESCRIPTION) {
        states[chatId].description = text;
        states[chatId].state = IMAGE;
        bot.sendMessage(chatId, 'Хотите добавить изображение к задаче? Если нет, отправьте /skip.', {
            reply_markup: {
                keyboard: [['/skip', '❌ Отмена']],
                one_time_keyboard: true,
                resize_keyboard: true,
            },
        });
    } else if (states[chatId] && states[chatId].state === IMAGE) {
        if (msg.photo) {
            const fileId = msg.photo[msg.photo.length - 1].file_id;
            const filePath = await bot.getFileLink(fileId);
            const response = await axios({ url: filePath, responseType: 'arraybuffer' });
            const imageData = response.data;

            await Image.create({
                telegramId: chatId,
                fileName: `${fileId}.jpg`,
                data: imageData,
            });

            const { summary, description } = states[chatId];
            const user = await TelegramUser.findByPk(chatId);

            try {
                const task = await createTask(summary, description, user.email.split('@')[0], imageData);
                bot.sendMessage(chatId, `Задача создана успешно: ${task.key}`, replyKeyboard);

                // Удаляем изображение из базы данных после использования
                await Image.destroy({ where: { telegramId: chatId, fileName: `${fileId}.jpg` } });
            } catch (error) {
                bot.sendMessage(chatId, `Ошибка при создании задачи: ${error.message}`, replyKeyboard);
            }
            delete states[chatId];
        } else if (text === '/skip') {
            const { summary, description } = states[chatId];
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
