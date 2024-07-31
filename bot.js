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
    service: 'yandex', // или другой сервис
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

const sendVerificationEmail = (email, code) => {
    return transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'Код верификации',
        text: `Ваш код верификации: ${code}. Введите его в Телеграм боте, чтобы создать задачу.`
    });
};

// ... остальной код

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
