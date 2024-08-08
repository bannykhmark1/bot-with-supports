module.exports = (sequelize, DataTypes) => {
    const MessageLog = sequelize.define('MessageLog', {
        telegramId: {
            type: DataTypes.BIGINT,
            allowNull: false,
        },
        message: {
            type: DataTypes.TEXT,
            allowNull: false,
        },
    });

    return MessageLog;
};
