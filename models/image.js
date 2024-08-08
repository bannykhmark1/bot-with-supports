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
            type: DataTypes.BLOB('long'),
            allowNull: false,
        },
    });

    return Image;
};
