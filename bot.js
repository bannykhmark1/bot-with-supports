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
const PHONE_NUMBER = 'PHONE_NUMBER';

const allowedDomains = ['kurganmk', 'reftp', 'hobbs-it', 'skhp-ural'];
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
            ['🔓 Выйти из аккаунта']
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
        tags: ['tg'],
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
                keyboard: [['🔓 Выйти из аккаунта']],
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
            keyboard: [['🔓 Выйти из аккаунта']],
        }
    });
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text?.trim() || '';

    console.log('Received message:', text);
    console.log('Current state:', states[chatId]);

    try {
        if (text) {
            await MessageLog.create({ telegramId: chatId, message: text });
        }
    } catch (error) {
        console.error('Error logging message:', error);
    }

    const currentState = states[chatId]?.state;

    if (text === '❌ Отмена') {
        delete states[chatId];
        bot.sendMessage(chatId, 'Действие отменено.', replyKeyboard);
        return;
    } 

    if (text === '🔓 Выйти из аккаунта') {
        await TelegramUser.destroy({ where: { telegramId: chatId } });
        delete states[chatId];
        bot.sendMessage(chatId, 'Вы вышли из аккаунта. Введите вашу корпоративную почту для повторного входа:', {
            reply_markup: {
                remove_keyboard: true,
                keyboard: [['🔓 Выйти из аккаунта']],
            }
        });
        return;
    } 

    switch (currentState) {
        case EMAIL:
            handleEmailInput(chatId, text);
            break;
        case VERIFICATION:
            handleVerificationInput(chatId, text);
            break;
        case SUMMARY:
            handleSummaryInput(chatId, text);
            break;
        case DESCRIPTION:
            handleDescriptionInput(chatId, text);
            break;
        case PHONE_NUMBER:
            handlePhoneNumberInput(chatId, text);
            break;
        case BUSINESS_UNIT:
            handleBusinessUnitInput(chatId, text);
            break;
        default:
            if (text === '📝 Создать задачу') {
                startTaskCreation(chatId);
            } else {
                bot.sendMessage(chatId, 'Я вас не понимаю. Пожалуйста, выберите команду из меню.', replyKeyboard);
            }
            break;
    }
});

const handleEmailInput = async (chatId, email) => {
    const emailParts = email.split('@');
    const domain = emailParts[1]?.split('.')[0];

    if (!allowedDomains.includes(domain)) {
        bot.sendMessage(chatId, 'Недопустимый домен почты. Пожалуйста, введите корпоративную почту с допустимым доменом (kurganmk, reftp, hobbs-it).', {
            reply_markup: {
                remove_keyboard: true,
                keyboard: [['🔓 Выйти из аккаунта']],
            }
        });
        return;
    }

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
};

const handleVerificationInput = async (chatId, code) => {
    if (emailVerificationCodes[chatId] === parseInt(code, 10)) {
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
};

const startTaskCreation = async (chatId) => {
    const user = await TelegramUser.findByPk(chatId);
    if (user) {
        states[chatId] = { state: BUSINESS_UNIT };
        bot.sendMessage(chatId, 'Пожалуйста, выберите бизнес-единицу:', businessUnitsKeyboard);
    } else {
        bot.sendMessage(chatId, 'Пожалуйста, сначала войдите в систему, введя свою корпоративную почту.', {
            reply_markup: {
                remove_keyboard: true,
                keyboard: [['🔓 Выйти из аккаунта']],
            }
        });
    }
};

const handleSummaryInput = (chatId, summary) => {
    if (summary.trim() === '') {
        bot.sendMessage(chatId, 'Название задачи не может быть пустым. Пожалуйста, введите название задачи.', {
            reply_markup: {
                remove_keyboard: true,
                keyboard: [['🔓 Выйти из аккаунта']],
            }
        });
    } else {
        states[chatId].summary = summary;
        states[chatId].state = DESCRIPTION;
        bot.sendMessage(chatId, 'Пожалуйста, введите описание задачи.', {
            reply_markup: {
                remove_keyboard: true,
                keyboard: [['🔙 Назад', '❌ Отмена'], ['🔓 Выйти из аккаунта']],
                one_time_keyboard: true,
                resize_keyboard: true,
            }
        });
    }
};

const handleDescriptionInput = (chatId, description) => {
    if (description.trim() === '') {
        bot.sendMessage(chatId, 'Описание задачи не может быть пустым. Пожалуйста, введите описание задачи.', {
            reply_markup: {
                remove_keyboard: true,
                keyboard: [['🔓 Выйти из аккаунта']],
            }
        });
    } else {
        states[chatId].description = description;
        states[chatId].state = PHONE_NUMBER;
        bot.sendMessage(chatId, 'Пожалуйста, введите номер телефона для связи.', {
            reply_markup: {
                remove_keyboard: true,
                keyboard: [['🔙 Назад', '❌ Отмена'], ['🔓 Выйти из аккаунта']],
                one_time_keyboard: true,
                resize_keyboard: true,
            }
        });
    }
};

const handlePhoneNumberInput = async (chatId, phoneNumber) => {
    if (!/^\+?\d{10,15}$/.test(phoneNumber)) {
        bot.sendMessage(chatId, 'Пожалуйста, введите корректный номер телефона (должен содержать от 10 до 15 цифр).', {
            reply_markup: {
                remove_keyboard: true,
                keyboard: [['🔙 Назад', '❌ Отмена'], ['🔓 Выйти из аккаунта']],
                one_time_keyboard: true,
                resize_keyboard: true,
            }
        });
        return;
    }

    const summary = `[${states[chatId].businessUnit}] ${states[chatId].summary}`;
    const description = `${states[chatId].description}\n\nНомер телефона для связи: ${phoneNumber}`;
    const user = await TelegramUser.findByPk(chatId);
    const login = user.email.split('@')[0];

    try {
        const task = await createTask(summary, description, login);
        bot.sendMessage(chatId, `Задача успешно создана с идентификатором: ${task.key}: https://tracker.yandex.ru/${task.key}. Пожалуйста, для дальнейшего диалога по вашему вопросу - пишите в таск в трекере (вначале сообщения ссылка на него). Инструкция по тому, как общаться в Трекере: https://wiki.yandex.ru/users/mbannykh/sapport.-pervaja-linija/instrukcija-po-jandeks-trekeru/`, replyKeyboard);
    } catch (error) {
        bot.sendMessage(chatId, 'Ошибка при создании задачи. Пожалуйста, попробуйте снова.', replyKeyboard);
    }

    delete states[chatId];
};

const handleBusinessUnitInput = (chatId, businessUnit) => {
    states[chatId].businessUnit = businessUnit;
    states[chatId].state = SUMMARY;
    bot.sendMessage(chatId, 'Пожалуйста, введите название задачи.', {
        reply_markup: {
            remove_keyboard: true,
            keyboard: [['🔙 Назад', '❌ Отмена'], ['🔓 Выйти из аккаунта']],
            one_time_keyboard: true,
            resize_keyboard: true,
        }
    });
};
