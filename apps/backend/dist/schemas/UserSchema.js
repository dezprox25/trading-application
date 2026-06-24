"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserSchema = void 0;
const mongoose_1 = require("mongoose");
exports.UserSchema = new mongoose_1.Schema({
    username: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        index: true,
    },
    password: {
        type: String,
        required: true,
    },
    name: {
        type: String,
        trim: true,
    },
    status: {
        type: String,
        enum: ["active", "inactive"],
        default: "active",
    },
}, {
    timestamps: {
        createdAt: "created_at",
        updatedAt: "updated_at",
    },
});
