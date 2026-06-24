"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WatchlistSchema = void 0;
const mongoose_1 = require("mongoose");
exports.WatchlistSchema = new mongoose_1.Schema({
    user_id: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true,
    },
    symbols_json: {
        type: [String],
        default: [],
    },
    column_prefs_json: {
        type: Object,
        default: {},
    },
}, {
    timestamps: { createdAt: false, updatedAt: "updated_at" },
});
