const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const dotenv = require('dotenv');
const nodemailer = require('nodemailer');
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
const BUSINESS_UNIT = 'BUSINESS_UNIT';

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

// Клавиатура с основной функциональностью
const replyKeyboard = {
    reply_markup: {
        keyboard: [['📝 Создать задачу', '❌ Отмена'], ['🔓 Выйти из аккаунта']],
        one_time_keyboard: true,
        resize_keyboard: true,
    },
};

// Клавиатура для выбора бизнес-единицы
const businessUnitsKeyboard = {
    reply_markup: {
        keyboard: [
            ['Переработка КМК', 'Консервация КМК'],
            ['РПФ', 'СКХП', 'КСК'],
            ['Розница', 'Pervafood', 'Хлебокомбинат №1', 'УАГ'],
            ['🔓 Выйти из аккаунта']  // Добавлена кнопка выхода
        ],
        one_time_keyboard: true,
        resize_keyboard: true,
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
        followers: [login],
        author: login,
    };

    try {
        const response = await axios.post(YANDEX_TRACKER_URL, data, { headers });
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
        bot.sendMessage(chatId, 'Привет! Введите вашу корпоративную почту для продолжения:', { 
            reply_markup: {
                remove_keyboard: true,
                keyboard: [['🔓 Выйти из аккаунта']], // Добавлена кнопка выхода при запросе почты
            }
        });
        states[chatId] = { state: EMAIL };
    }
});

bot.onText(/\/logout/, async (msg) => {
    const chatId = msg.chat.id;
    await TelegramUser.destroy({ where: { telegramId: chatId } });
    delete states[chatId];
    bot.sendMessage(chatId, 'Вы вышли из аккаунта. Введите вашу корпоративную почту для повторного входа:', {
        reply_markup: {
            remove_keyboard: true,
            keyboard: [['🔓 Выйти из аккаунта']], // Кнопка выхода в начальном состоянии
        }
    });
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text || '';

    console.log('Received message:', text);
    console.log('Current state:', states[chatId]);

    // Логируем все сообщения в базу данных
    try {
        if (text) {
            await MessageLog.create({ telegramId: chatId, message: text });
        }
    } catch (error) {
        console.error('Error logging message:', error);
    }

    const currentState = states[chatId] ? states[chatId].state : null;

    if (text === '❌ Отмена') {
        delete states[chatId];
        bot.sendMessage(chatId, 'Действие отменено.', replyKeyboard);
    } else if (text === '🔓 Выйти из аккаунта') {
        await TelegramUser.destroy({ where: { telegramId: chatId } });
        delete states[chatId];
        bot.sendMessage(chatId, 'Вы вышли из аккаунта. Введите вашу корпоративную почту для повторного входа:', {
            reply_markup: {
                remove_keyboard: true,
                keyboard: [['🔓 Выйти из аккаунта']],
            }
        });
    } else if (currentState === EMAIL) {
        const email = text;
        const emailParts = email.split('@');
        const domain = emailParts[1] ? emailParts[1].split('.')[0] : '';

        if (!allowedDomains.includes(domain)) {
            bot.sendMessage(chatId, 'Недопустимый домен почты. Пожалуйста, введите корпоративную почту с допустимым доменом (kurganmk, reftp, hobbs-it).', {
                reply_markup: {
                    remove_keyboard: true,
                    keyboard: [['🔓 Выйти из аккаунта']],
                }
            });
        } else {
            const login = emailParts[0];
            const code = Math.floor(100000 + Math.random() * 900000);
            emailVerificationCodes[chatId] = code;

            try {
                await sendVerificationEmail(email, code);
                states[chatId] = { state: VERIFICATION, email };
                bot.sendMessage(chatId, 'Код подтверждения отправлен на вашу почту. Пожалуйста, введите его для завершения регистрации. Если кода нет в основной папке почты, проверьте папку Спам.', {
                    reply_markup: {
                        remove_keyboard: true,
                        keyboard: [['🔓 Выйти из аккаунта']],
                    }
                });
            } catch (error) {
                bot.sendMessage(chatId, 'Ошибка при отправке кода подтверждения. Пожалуйста, попробуйте снова позже.', replyKeyboard);
            }
        }
    } else if (currentState === VERIFICATION) {
        const enteredCode = parseInt(text, 10);
        if (emailVerificationCodes[chatId] === enteredCode) {
            const email = states[chatId].email;
            await TelegramUser.create({ telegramId: chatId, email });
            delete states[chatId];
            bot.sendMessage(chatId, 'Почта успешно подтверждена. Выберите команду для продолжения:', replyKeyboard);
        } else {
            bot.sendMessage(chatId, 'Неверный код подтверждения. Пожалуйста, попробуйте снова.', {
                reply_markup: {
                    remove_keyboard: true,
                    keyboard: [['🔓 Выйти из аккаунта']],
                }
            });
        }
    } else if (text === '📝 Создать задачу') {
        const user = await TelegramUser.findByPk(chatId);
        if (!user) {
            bot.sendMessage(chatId, 'Пожалуйста, введите вашу корпоративную почту для начала:', {
                reply_markup: {
                    remove_keyboard: true,
                    keyboard: [['🔓 Выйти из аккаунта']],
                }
            });
            states[chatId] = { state: EMAIL };
        } else {
            states[chatId] = { state: SUMMARY };
            bot.sendMessage(chatId, 'Пожалуйста, введите название задачи.', {
                reply_markup: {
                    remove_keyboard: true,
                    keyboard: [['🔓 Выйти из аккаунта']],
                }
            });
        }
    } else if (currentState === SUMMARY) {
        states[chatId].summary = text;
        states[chatId].state = DESCRIPTION;
        bot.sendMessage(chatId, 'Введите описание задачи.', {
            reply_markup: {
                remove_keyboard: true,
                keyboard: [['🔓 Выйти из аккаунта']],
            }
        });
    } else if (currentState === DESCRIPTION) {
        states[chatId].description = text;
        states[chatId].state = BUSINESS_UNIT;
        bot.sendMessage(chatId, 'Пожалуйста, выберите бизнес-единицу.', businessUnitsKeyboard);
    } else if (currentState === BUSINESS_UNIT) {
        states[chatId].businessUnit = text;

        const { summary, description } = states[chatId];
        const user = await TelegramUser.findByPk(chatId);
        const login = user.email.split('@')[0];

        try {
            const taskData = await createTask(summary, description, login);
            bot.sendMessage(chatId, `Задача успешно создана! ID задачи: ${taskData.key}`, replyKeyboard);
        } catch (error) {
            bot.sendMessage(chatId, 'Ошибка при создании задачи. Пожалуйста, попробуйте снова позже.', replyKeyboard);
        }
        delete states[chatId];
    }
});
