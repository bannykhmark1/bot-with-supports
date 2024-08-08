module.exports = (sequelize, DataTypes) => {
    const TelegramUser = sequelize.define('TelegramUser', {
        telegramId: {
            type: DataTypes.BIGINT,
            primaryKey: true,
        },
        email: {
            type: DataTypes.STRING,
            allowNull: false,
        },
    });

    return TelegramUser;
};
