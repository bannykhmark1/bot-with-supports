module.exports = (sequelize, DataTypes) => {
    const TelegramUser = sequelize.define('TelegramUser', {
        telegramId: {
            type: DataTypes.BIGINT,
            primaryKey: true,
            allowNull: false,
        },
        email: {
            type: DataTypes.STRING,
            allowNull: false,
            validate: {
                isEmail: true, // Проверка на правильный формат email
            },
        },
    });

    return TelegramUser;
};
