const { Sequelize } = require('sequelize');
const dotenv = require('dotenv');

dotenv.config();

const sequelize = new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASSWORD, {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    dialect: 'postgres',
    logging: false, // Отключить логирование SQL-запросов в консоли
});

const TelegramUser = require('./telegramUser')(sequelize, Sequelize.DataTypes);
const MessageLog = require('./messageLog')(sequelize, Sequelize.DataTypes);

sequelize.sync();

module.exports = {
    sequelize,
    TelegramUser,
    MessageLog,
};
