"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Module2StrikeTickSchema = void 0;
const mongoose_1 = require("mongoose");
exports.Module2StrikeTickSchema = new mongoose_1.Schema({
    session_id: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "Module2Session",
        required: true,
        index: true,
    },
    strike: {
        type: String,
        required: true,
        index: true,
    },
    minute_timestamp: {
        type: Date,
        required: true,
    },
    ltp_integer: {
        type: Number,
        required: true,
    },
    is_day_high: {
        type: Boolean,
        default: false,
    },
    is_day_low: {
        type: Boolean,
        default: false,
    },
    pct_from_open: {
        type: Number,
        required: true,
    },
    is_downtrend_flagged: {
        type: Boolean,
        default: false,
    },
    oi: {
        type: Number,
        default: 0,
    },
    oi_delta: {
        type: Number,
        default: 0,
    },
    oi_buy: {
        type: Number,
        default: 0,
    },
    oi_sell: {
        type: Number,
        default: 0,
    },
});
// Compound Index to retrieve session ticks quickly ordered by time
exports.Module2StrikeTickSchema.index({ session_id: 1, strike: 1, minute_timestamp: -1 });
// TTL index to automatically purge old tracker records after 24 hours (86400 seconds)
exports.Module2StrikeTickSchema.index({ minute_timestamp: 1 }, { expireAfterSeconds: 86400 });
