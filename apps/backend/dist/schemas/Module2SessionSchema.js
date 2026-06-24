"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Module2SessionSchema = void 0;
const mongoose_1 = require("mongoose");
exports.Module2SessionSchema = new mongoose_1.Schema({
    user_id: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true,
    },
    session_type: {
        type: String,
        enum: ["CE", "PE", "mixed"],
        required: true,
    },
    index_symbol: {
        type: String,
        required: true,
    },
    expiry_date: {
        type: String,
        required: true,
    },
    selected_strikes_json: {
        type: [String],
        default: [],
    },
    day_open_prices_json: {
        type: Object, // Map of strike -> baseline price
        default: {},
    },
    futures_oi_json: {
        type: Object,
        default: {},
    },
}, {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
});
