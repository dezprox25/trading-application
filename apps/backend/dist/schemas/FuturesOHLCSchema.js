"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FuturesOHLCSchema = void 0;
const mongoose_1 = require("mongoose");
exports.FuturesOHLCSchema = new mongoose_1.Schema({
    symbol: {
        type: String,
        required: true,
        index: true,
    },
    timeframe: {
        type: String,
        required: true,
        index: true,
    },
    bar_open: {
        type: Number,
        required: true,
    },
    bar_high: {
        type: Number,
        required: true,
    },
    bar_low: {
        type: Number,
        required: true,
    },
    bar_close: {
        type: Number,
        required: true,
    },
    bar_time: {
        type: Date,
        required: true,
        index: true,
    },
    volume: {
        type: Number,
        default: 0,
    },
});
// Index to query the latest candles for pivot calculation
exports.FuturesOHLCSchema.index({ symbol: 1, timeframe: 1, bar_time: -1 });
