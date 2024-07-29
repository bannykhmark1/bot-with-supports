const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config();

// Load environment variables
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

const allowedDomains = ['kurganmk', 'reftp', 'hobbs-it'];

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
                const { summary, description } = states[chatId];
                const updatedDescription = `${description}\n\nКорпоративная почта: ${email}`;

                try {
                    const task = await createTask(summary, updatedDescription, login);
                    const taskId = task.id || 'Неизвестно';
                    const responseMessage = `Задача создана: ${task.key || 'Нет ключа'} - https://tracker.yandex.ru/${task.key}. Пожалуйста, для дальнейшего диалога по вашему вопросу - пишите в таск в трекере (вначале сообщения ссылка на него). Инструкция по тому, как общаться в Трекере: https://wiki.yandex.ru/users/mbannykh/sapport.-pervaja-linija/instrukcija-po-jandeks-trekeru/`;
                    bot.sendMessage(chatId, responseMessage, replyKeyboard);
                } catch (error) {
                    const errorMessage = error.response && error.response.data && error.response.data.errors && error.response.data.errors.followers ? 'пользователь не существует' : 'Неизвестная ошибка';
                    if (errorMessage === 'пользователь не существует') {
                        bot.sendMessage(chatId, `Ошибка создания задачи: Введенный email не существует. Пожалуйста, введите корректную корпоративную почту.`, {
                            reply_markup: {
                                keyboard: [['🔙 Назад', '❌ Отмена']],
                                one_time_keyboard: true,
                                resize_keyboard: true,
                            },
                        });
                    } else {
                        bot.sendMessage(chatId, `Ошибка создания задачи: ${errorMessage}`, replyKeyboard);
                    }
                }

                states[chatId].state = EMAIL;
            }
        }
    }
});
