"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getActiveCandle = exports.getCachedOHLCBars = exports.aggregateOHLC = exports.getBoundaryTime = exports.setOnCandleFinalized = void 0;
const FuturesOHLC_1 = require("../models/FuturesOHLC");
const redis_1 = __importDefault(require("../config/redis"));
// Local cache for active candles: activeCandles[symbol][timeframe]
const activeCandles = {};
const getTimeframeMinutes = async (tfStr) => {
    if (tfStr === "1m")
        return 1;
    if (tfStr === "3m")
        return 3;
    if (tfStr === "5m")
        return 5;
    if (tfStr === "custom") {
        try {
            const customTf = await redis_1.default.get("config:custom_timeframe");
            if (customTf && customTf.endsWith("m")) {
                const mins = parseInt(customTf);
                if (mins > 0)
                    return mins;
            }
        }
        catch {
            // Ignore Redis offline/read errors
        }
        return 10; // Default fallback for custom
    }
    const mins = parseInt(tfStr);
    return isNaN(mins) || mins <= 0 ? 5 : mins;
};
// Start a proactive checker loop on startup/module load
const startBoundaryChecker = () => {
    setInterval(async () => {
        const now = Date.now();
        for (const symbol of Object.keys(activeCandles)) {
            for (const tfStr of Object.keys(activeCandles[symbol])) {
                const candle = activeCandles[symbol][tfStr];
                if (!candle)
                    continue;
                const tfMins = await getTimeframeMinutes(tfStr);
                const nextBoundary = candle.openTime + tfMins * 60000;
                if (now >= nextBoundary) {
                    console.log(`[OHLC] Proactive finalization for ${symbol} (${tfStr}) on boundary.`);
                    const candleToFinalize = candle;
                    delete activeCandles[symbol][tfStr];
                    await finaliseCandle(candleToFinalize);
                }
            }
        }
    }, 1000);
};
startBoundaryChecker();
let onCandleFinalized = null;
const setOnCandleFinalized = (callback) => {
    onCandleFinalized = callback;
};
exports.setOnCandleFinalized = setOnCandleFinalized;
/**
 * Normalizes time boundary based on timeframe in minutes
 */
const getBoundaryTime = (timestamp, timeframeMinutes) => {
    const timeMs = timestamp.getTime();
    const timeframeMs = timeframeMinutes * 60000;
    return Math.floor(timeMs / timeframeMs) * timeframeMs;
};
exports.getBoundaryTime = getBoundaryTime;
/**
 * Aggregates a raw tick into the corresponding timeframe candles for that symbol
 */
const aggregateOHLC = async (tick, timeframeMinutes, timeframeStr) => {
    const { symbol, ltp, timestamp, volume = 0 } = tick;
    if (!activeCandles[symbol]) {
        activeCandles[symbol] = {};
    }
    const boundary = (0, exports.getBoundaryTime)(timestamp, timeframeMinutes);
    let candle = activeCandles[symbol][timeframeStr];
    if (!candle || candle.openTime < boundary) {
        // If there is an existing active candle, it has crossed the timeframe boundary, so finalize it.
        if (candle) {
            await finaliseCandle(candle);
        }
        // Initialize new candle
        candle = {
            symbol,
            timeframe: timeframeStr,
            open: ltp,
            high: ltp,
            low: ltp,
            close: ltp,
            openTime: boundary,
            volume,
        };
    }
    else {
        // Update existing active candle
        candle.high = Math.max(candle.high, ltp);
        candle.low = Math.min(candle.low, ltp);
        candle.close = ltp;
        candle.volume += volume;
    }
    activeCandles[symbol][timeframeStr] = candle;
    return candle;
};
exports.aggregateOHLC = aggregateOHLC;
const finalizedCandlesCache = {};
/**
 * Saves finalized candle to MongoDB and triggers callback
 */
const finaliseCandle = async (candle) => {
    const { symbol, timeframe } = candle;
    if (!finalizedCandlesCache[symbol])
        finalizedCandlesCache[symbol] = {};
    if (!finalizedCandlesCache[symbol][timeframe])
        finalizedCandlesCache[symbol][timeframe] = [];
    const existingIdx = finalizedCandlesCache[symbol][timeframe].findIndex(c => c.openTime === candle.openTime);
    if (existingIdx >= 0) {
        finalizedCandlesCache[symbol][timeframe][existingIdx] = candle;
    }
    else {
        finalizedCandlesCache[symbol][timeframe].push(candle);
        if (finalizedCandlesCache[symbol][timeframe].length > 15) {
            finalizedCandlesCache[symbol][timeframe].shift();
        }
    }
    try {
        await FuturesOHLC_1.FuturesOHLC.findOneAndUpdate({
            symbol: candle.symbol,
            timeframe: candle.timeframe,
            bar_time: new Date(candle.openTime),
        }, {
            bar_open: candle.open,
            bar_high: candle.high,
            bar_low: candle.low,
            bar_close: candle.close,
            volume: candle.volume,
        }, { upsert: true, new: true });
        console.log(`[OHLC] Finalized/Updated ${candle.timeframe} candle for ${candle.symbol} at ${new Date(candle.openTime).toISOString()}`);
        // Prune the database to keep exactly the latest 15 records
        const oldestToKeep = await FuturesOHLC_1.FuturesOHLC.find({ symbol: candle.symbol, timeframe: candle.timeframe })
            .sort({ bar_time: -1 })
            .skip(14)
            .limit(1);
        if (oldestToKeep.length > 0) {
            const boundaryTime = oldestToKeep[0].bar_time;
            await FuturesOHLC_1.FuturesOHLC.deleteMany({
                symbol: candle.symbol,
                timeframe: candle.timeframe,
                bar_time: { $lt: boundaryTime }
            });
        }
    }
    catch (error) {
        console.error("Failed to finalize candle in database:", error);
    }
    // Trigger callback even if DB save fails
    if (onCandleFinalized) {
        try {
            await onCandleFinalized(candle);
        }
        catch (err) {
            console.error("Error in onCandleFinalized callback:", err);
        }
    }
};
/**
 * Returns latest cached completed candles
 */
const getCachedOHLCBars = (symbol, timeframe, limit = 50) => {
    const list = finalizedCandlesCache[symbol]?.[timeframe] || [];
    return list.slice(-limit);
};
exports.getCachedOHLCBars = getCachedOHLCBars;
/**
 * Gets the current active candle for a symbol and timeframe
 */
const getActiveCandle = (symbol, timeframeStr) => {
    return activeCandles[symbol]?.[timeframeStr] || null;
};
exports.getActiveCandle = getActiveCandle;
