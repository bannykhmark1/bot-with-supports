const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const dotenv = require('dotenv');
const nodemailer = require('nodemailer'); // или другой почтовый модуль

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

const allowedDomains = ['kurganmk', 'reftp', 'hobbs-it'];
const emailVerificationCodes = {}; // для хранения кодов подтверждения

const transporter = nodemailer.createTransport({
    service: 'connect.smtp.bz',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

const sendVerificationEmail = async (email, code) => {
    try {
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Код верификации',
            text: `Ваш код верификации: ${code}. Введите его в Телеграм боте, чтобы создать задачу.`
        });
        console.log('Verification email sent successfully');
    } catch (error) {
        console.error('Error sending verification email:', error);
        throw error; // Это нужно для передачи ошибки на уровень выше
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

const createTask = async (summary, description, login) => {
    const headers = {
        'Authorization': `OAuth ${YANDEX_TRACKER_OAUTH_TOKEN}`,
        'X-Cloud-Org-ID': YANDEX_TRACKER_ORG_ID,
        'Content-Type': 'application/json',
    };

    const data = {
        summary,
        description,
        queue: YANDEX_TRACKER_QUEUE,
        followers: [login], // Adding the login to the followers field
        author: login
    };

    try {
        const response = await axios.post(YANDEX_TRACKER_URL, data, { headers });
        return response.data;
    } catch (error) {
        console.error('Error creating task:', error.response ? error.response.data : error.message);
        throw error;
    }
};

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, 'Привет! Выберите команду для продолжения:', replyKeyboard);
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (text === '📝 Создать задачу') {
        states[chatId] = { state: SUMMARY };
        bot.sendMessage(chatId, 'Пожалуйста, введите название задачи.', removeKeyboard);
    } else if (text === '❌ Отмена') {
        states[chatId] = {};
        bot.sendMessage(chatId, 'Создание задачи отменено.', replyKeyboard);
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
        if (text === '🔙 Назад') {
            states[chatId].state = SUMMARY;
            bot.sendMessage(chatId, 'Пожалуйста, введите название задачи.', removeKeyboard);
        } else {
            states[chatId].description = text;
            states[chatId].state = EMAIL;
            bot.sendMessage(chatId, 'Пожалуйста, введите вашу корпоративную почту.', {
                reply_markup: {
                    keyboard: [['🔙 Назад', '❌ Отмена']],
                    one_time_keyboard: true,
                    resize_keyboard: true,
                },
            });
        }
    } else if (states[chatId] && states[chatId].state === EMAIL) {
        if (text === '🔙 Назад') {
            states[chatId].state = DESCRIPTION;
            bot.sendMessage(chatId, 'Теперь введите описание задачи.', {
                reply_markup: {
                    keyboard: [['🔙 Назад', '❌ Отмена']],
                    one_time_keyboard: true,
                    resize_keyboard: true,
                },
            });
        } else {
            const email = text;
            const emailParts = email.split('@');
            const domain = emailParts[1] ? emailParts[1].split('.')[0] : '';
            
            if (!allowedDomains.includes(domain)) {
                bot.sendMessage(chatId, 'Недопустимый домен почты. Пожалуйста, введите корпоративную почту с допустимым доменом (kurganmk, reftp, hobbs-it).', {
                    reply_markup: {
                        keyboard: [['🔙 Назад', '❌ Отмена']],
                        one_time_keyboard: true,
                        resize_keyboard: true,
                    },
                });
            } else {
                const login = emailParts[0];
                const code = Math.floor(100000 + Math.random() * 900000); // генерируем код
                emailVerificationCodes[chatId] = code; // сохраняем код для проверки
                
                try {
                    await sendVerificationEmail(email, code);
                    states[chatId].email = email;
                    states[chatId].state = VERIFICATION;
                    bot.sendMessage(chatId, 'Код подтверждения отправлен на вашу почту. Пожалуйста, введите его для завершения создания задачи.', {
                        reply_markup: {
                            keyboard: [['🔙 Назад', '❌ Отмена']],
                            one_time_keyboard: true,
                            resize_keyboard: true,
                        },
                    });
                } catch (error) {
                    bot.sendMessage(chatId, 'Ошибка при отправке кода подтверждения. Пожалуйста, попробуйте снова позже.', replyKeyboard);
                }
            }
        }
    } else if (states[chatId] && states[chatId].state === VERIFICATION) {
        if (text === '🔙 Назад') {
            states[chatId].state = EMAIL;
            bot.sendMessage(chatId, 'Пожалуйста, введите вашу корпоративную почту.', {
                reply_markup: {
                    keyboard: [['🔙 Назад', '❌ Отмена']],
                    one_time_keyboard: true,
                    resize_keyboard: true,
                },
            });
        } else {
            const enteredCode = parseInt(text, 10);
            if (emailVerificationCodes[chatId] && emailVerificationCodes[chatId] === enteredCode) {
                const { summary, description, email } = states[chatId];
                const login = email.split('@')[0];
                const updatedDescription = `${description}\n\nКорпоративная почта: ${email}`;

                try {
                    const task = await createTask(summary, updatedDescription, login);
                    const responseMessage = `Задача создана: ${task.key || 'Нет ключа'} - https://tracker.yandex.ru/${task.key}`;
                    bot.sendMessage(chatId, responseMessage, replyKeyboard);
                } catch (error) {
                    bot.sendMessage(chatId, `Ошибка создания задачи: ${error.message}`, replyKeyboard);
                }
            } else {
                bot.sendMessage(chatId, 'Неверный код подтверждения. Пожалуйста, попробуйте снова.', {
                    reply_markup: {
                        keyboard: [['🔙 Назад', '❌ Отмена']],
                        one_time_keyboard: true,
                        resize_keyboard: true,
                    },
                });
            }
        }
    }
});
