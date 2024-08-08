const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const dotenv = require('dotenv');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const { sequelize, TelegramUser, MessageLog, Image } = require('./models'); // Импортируем модели

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

// Функция для сохранения изображения в базу данных
const saveImageToDatabase = async (telegramId, fileName, filePath) => {
    try {
        const data = fs.readFileSync(filePath);

        await Image.create({
            telegramId,
            fileName,
            data,
        });

        fs.unlinkSync(filePath);
    } catch (error) {
        console.error('Error saving image to database:', error);
        throw error;
    }
};

// Функция для извлечения изображения из базы данных
const getImageFromDatabase = async (telegramId, fileName) => {
    try {
        const image = await Image.findOne({
            where: {
                telegramId,
                fileName,
            },
        });

        if (image) {
            return image.data; // Возвращаем бинарные данные изображения
        } else {
            throw new Error('Image not found');
        }
    } catch (error) {
        console.error('Error retrieving image from database:', error);
        throw error;
    }
};

// Функция для удаления изображения из базы данных
const deleteImageFromDatabase = async (telegramId, fileName) => {
    try {
        await Image.destroy({
            where: {
                telegramId,
                fileName,
            },
        });
    } catch (error) {
        console.error('Error deleting image from database:', error);
        throw error;
    }
};

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
                bot.sendMessage(chatId, 'Код подтверждения отправлен на вашу почту. Введите его здесь:', removeKeyboard);
            } catch (error) {
                bot.sendMessage(chatId, 'Ошибка при отправке письма. Пожалуйста, попробуйте еще раз.', removeKeyboard);
            }
        }
    } else if (states[chatId] && states[chatId].state === VERIFICATION) {
        const code = parseInt(text, 10);
        if (code === emailVerificationCodes[chatId]) {
            delete emailVerificationCodes[chatId];
            states[chatId].state = SUMMARY;
            bot.sendMessage(chatId, 'Почта подтверждена. Введите краткое описание задачи:', removeKeyboard);
        } else {
            bot.sendMessage(chatId, 'Неверный код. Пожалуйста, попробуйте снова.');
        }
    } else if (states[chatId] && states[chatId].state === SUMMARY) {
        states[chatId].summary = text;
        states[chatId].state = DESCRIPTION;
        bot.sendMessage(chatId, 'Введите подробное описание задачи:');
    } else if (states[chatId] && states[chatId].state === DESCRIPTION) {
        states[chatId].description = text;
        states[chatId].state = IMAGE;
        bot.sendMessage(chatId, 'Прикрепите изображение для задачи:');
    } else if (states[chatId] && states[chatId].state === IMAGE) {
        if (msg.photo) {
            const fileId = msg.photo[msg.photo.length - 1].file_id;
            const file = await bot.getFile(fileId);
            const filePath = file.file_path;
            const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`;
            const localFilePath = path.join(__dirname, 'uploads', file.file_id + '.jpg');

            try {
                const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
                fs.writeFileSync(localFilePath, response.data);

                await saveImageToDatabase(chatId, file.file_id + '.jpg', localFilePath);

                const { summary, description } = states[chatId];
                await createTask(summary, description, states[chatId].email, response.data);

                await deleteImageFromDatabase(chatId, file.file_id + '.jpg');
                bot.sendMessage(chatId, 'Задача успешно создана!', replyKeyboard);
                delete states[chatId];
            } catch (error) {
                console.error('Error handling image:', error);
                bot.sendMessage(chatId, 'Ошибка при обработке изображения. Попробуйте снова.', replyKeyboard);
            }
        } else {
            bot.sendMessage(chatId, 'Пожалуйста, отправьте изображение.');
        }
    } else {
        bot.sendMessage(chatId, 'Пожалуйста, выберите действие из меню или введите команду.');
    }
});
