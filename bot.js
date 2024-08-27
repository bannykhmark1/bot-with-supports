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
    } catch (error) {
        console.error('Error sending verification email:', error);
        throw error;
    }
};

// Клавиатура с основной функциональностью (появляется только после авторизации)
const replyKeyboard = {
    reply_markup: {
        keyboard: [['📝 Создать задачу', '❌ Отмена'], ['🔓 Выйти из аккаунта']],
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
            },
        });
        states[chatId] = { state: EMAIL };
    }
});

bot.onText(/\/logout/, async (msg) => {
    const chatId = msg.chat.id;
    await TelegramUser.destroy({ where: { telegramId: chatId } });
    delete states[chatId];
    bot.sendMessage(chatId, 'Вы вышли из аккаунта. Введите вашу корпоративную почту для повторного входа.');
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text || '';

    console.log('Received message:', text);
    console.log('Current state:', states[chatId]);

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
        bot.sendMessage(chatId, 'Действие отменено.');
    } else if (currentState === EMAIL) {
        const email = text.trim();
        const emailParts = email.split('@');
        const domain = emailParts[1] ? emailParts[1].split('.')[0] : '';

        if (!allowedDomains.includes(domain)) {
            bot.sendMessage(chatId, 'Недопустимый домен почты. Пожалуйста, введите корпоративную почту с допустимым доменом (kurganmk, reftp, hobbs-it).');
        } else {
            const code = Math.floor(100000 + Math.random() * 900000);
            emailVerificationCodes[chatId] = code;

            try {
                await sendVerificationEmail(email, code);
                states[chatId] = { state: VERIFICATION, email };
                bot.sendMessage(chatId, 'Код подтверждения отправлен на вашу почту. Пожалуйста, введите его.');
            } catch (error) {
                bot.sendMessage(chatId, 'Ошибка при отправке кода подтверждения. Попробуйте снова позже.');
            }
        }
    } else if (currentState === VERIFICATION) {
        const enteredCode = parseInt(text, 10);
        if (emailVerificationCodes[chatId] === enteredCode) {
            const email = states[chatId].email;
            await TelegramUser.create({ telegramId: chatId, email });
            delete states[chatId];
            delete emailVerificationCodes[chatId];
            bot.sendMessage(chatId, 'Почта успешно подтверждена. Выберите команду для продолжения:', replyKeyboard);
        } else {
            bot.sendMessage(chatId, 'Неверный код подтверждения. Попробуйте снова.');
        }
    } else if (text === '📝 Создать задачу') {
        const user = await TelegramUser.findByPk(chatId);
        if (!user) {
            bot.sendMessage(chatId, 'Пожалуйста, введите вашу корпоративную почту для начала.');
            states[chatId] = { state: EMAIL };
        } else {
            states[chatId] = { state: SUMMARY };
            bot.sendMessage(chatId, 'Введите название задачи.');
        }
    } else if (currentState === SUMMARY) {
        if (text.trim() === '') {
            bot.sendMessage(chatId, 'Название задачи не может быть пустым. Пожалуйста, введите название задачи.');
        } else {
            states[chatId].summary = text;
            states[chatId].state = DESCRIPTION;
            bot.sendMessage(chatId, 'Введите описание задачи.');
        }
    } else if (currentState === DESCRIPTION) {
        if (text.trim() === '') {
            bot.sendMessage(chatId, 'Описание задачи не может быть пустым. Пожалуйста, введите описание задачи.');
        } else {
            states[chatId].description = text;
            states[chatId].state = BUSINESS_UNIT;
            bot.sendMessage(chatId, 'Выберите бизнес-единицу:', businessUnitsKeyboard);
        }
    } else if (currentState === BUSINESS_UNIT) {
        const businessUnit = text.trim();
        const validBusinessUnits = ['Переработка КМК', 'Консервация КМК', 'РПФ', 'СКХП', 'КСК', 'Розница', 'Pervafood', 'Хлебокомбинат №1', 'УАГ'];

        if (!validBusinessUnits.includes(businessUnit)) {
            bot.sendMessage(chatId, 'Выберите бизнес-единицу из предложенного списка.');
        } else {
            const { summary, description } = states[chatId];
            const user = await TelegramUser.findByPk(chatId);

            const formattedDescription = `${description}\n\nБизнес-единица: ${businessUnit}`;

            try {
                const task = await createTask(summary, formattedDescription, user.email);
                bot.sendMessage(chatId, `Задача успешно создана! Номер задачи: ${task.key}`);
            } catch (error) {
                bot.sendMessage(chatId, 'Ошибка при создании задачи. Попробуйте снова позже.');
            }

            delete states[chatId];
        }
    } else if (text === '🔓 Выйти из аккаунта') {
        await TelegramUser.destroy({ where: { telegramId: chatId } });
        delete states[chatId];
        bot.sendMessage(chatId, 'Вы вышли из аккаунта. Введите вашу корпоративную почту для повторного входа.');
    }
});
