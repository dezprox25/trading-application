"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpotTicksSchema = void 0;
const mongoose_1 = require("mongoose");
exports.SpotTicksSchema = new mongoose_1.Schema({
    symbol: {
        type: String,
        required: true,
        index: true,
    },
    ltp: {
        type: Number,
        required: true,
    },
    timestamp: {
        type: Date,
        required: true,
        index: true,
    },
    volume: {
        type: Number,
        default: 0,
    },
});
// TTL index to automatically delete records older than 24 hours (86400 seconds)
exports.SpotTicksSchema.index({ timestamp: 1 }, { expireAfterSeconds: 86400 });
