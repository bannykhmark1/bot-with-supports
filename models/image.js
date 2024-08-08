// models/image.js
module.exports = (sequelize, DataTypes) => {
    const Image = sequelize.define('Image', {
        telegramId: {
            type: DataTypes.BIGINT,
            allowNull: false,
        },
        fileName: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        data: {
            type: DataTypes.BYTEA, // Используем BYTEA для PostgreSQL
            allowNull: false,
        },
    });

    return Image;
};
