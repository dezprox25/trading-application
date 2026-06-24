"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateIndicators = exports.getPivotLevels = exports.recalculatePivots = exports.initPivotService = exports.setOnPivotsUpdated = void 0;
const FuturesOHLC_1 = require("../models/FuturesOHLC");
const PivotLevels_1 = require("../models/PivotLevels");
const ohlcAggregator_1 = require("./ohlcAggregator");
const redis_1 = __importDefault(require("../config/redis"));
const pivotEngine_1 = require("../utils/pivotEngine");
// Local cache for the latest computed pivots: latestPivots[symbol][timeframe][method]
const latestPivots = {};
let onPivotsUpdated = null;
const setOnPivotsUpdated = (callback) => {
    onPivotsUpdated = callback;
};
exports.setOnPivotsUpdated = setOnPivotsUpdated;
/**
 * Initialize pivot service and register finalized candle listener
 */
const initPivotService = () => {
    (0, ohlcAggregator_1.setOnCandleFinalized)(async (candle) => {
        console.log(`[PivotService] Finalized candle received for ${candle.symbol} (${candle.timeframe}). Recalculating pivots...`);
        await (0, exports.recalculatePivots)(candle.symbol, candle.timeframe, candle.high, candle.low, candle.close);
    });
};
exports.initPivotService = initPivotService;
/**
 * Recalculates pivots using all 3 methods and saves to DB and cache
 */
const recalculatePivots = async (symbol, timeframe, high, low, close) => {
    const date = new Date();
    const computedAt = date;
    // 1. Compute Classic Pivots
    const classic = (0, pivotEngine_1.calculateClassicPivot)(high, low, close);
    // 2. Compute Camarilla Pivots
    const camarilla = (0, pivotEngine_1.calculateCamarillaPivot)(high, low, close);
    // 3. Compute Fibonacci Pivots
    const fibonacci = (0, pivotEngine_1.calculateFibonacciPivot)(high, low, close);
    const results = {};
    const methods = [
        { name: "classic", levels: classic },
        { name: "camarilla", levels: camarilla },
        { name: "fibonacci", levels: fibonacci },
    ];
    for (const m of methods) {
        const pivotDoc = {
            symbol,
            timeframe,
            method: m.name,
            pivot: "P" in m.levels ? m.levels.P : close,
            r1: m.levels.R1,
            r2: m.levels.R2,
            r3: m.levels.R3,
            r4: "R4" in m.levels ? m.levels.R4 : undefined,
            s1: m.levels.S1,
            s2: m.levels.S2,
            s3: m.levels.S3,
            s4: "S4" in m.levels ? m.levels.S4 : undefined,
            computedAt,
        };
        // Save to Database
        try {
            await PivotLevels_1.PivotLevels.create({
                ...pivotDoc,
                date,
                computed_at: computedAt,
            });
        }
        catch (err) {
            // Suppress database write failure when offline
        }
        // Save to local cache
        if (!latestPivots[symbol])
            latestPivots[symbol] = {};
        if (!latestPivots[symbol][timeframe])
            latestPivots[symbol][timeframe] = {};
        latestPivots[symbol][timeframe][m.name] = pivotDoc;
        results[m.name] = pivotDoc;
    }
    // Notify WebSocket server
    if (onPivotsUpdated) {
        await onPivotsUpdated(results);
    }
    return results;
};
exports.recalculatePivots = recalculatePivots;
/**
 * Gets cached pivot levels or loads them from MongoDB if cache is empty
 */
const getPivotLevels = async (symbol, timeframe, method) => {
    // Check local cache
    if (latestPivots[symbol]?.[timeframe]?.[method]) {
        return latestPivots[symbol][timeframe][method];
    }
    // Fetch from database
    let doc = null;
    try {
        doc = await PivotLevels_1.PivotLevels.findOne({ symbol, timeframe, method }).sort({ computed_at: -1 });
    }
    catch (err) {
        // Suppress warning when offline
    }
    if (doc) {
        const levels = {
            symbol: doc.symbol,
            timeframe: doc.timeframe,
            method: doc.method,
            pivot: doc.pivot,
            r1: doc.r1,
            r2: doc.r2,
            r3: doc.r3,
            r4: doc.r4 ?? undefined,
            s1: doc.s1,
            s2: doc.s2,
            s3: doc.s3,
            s4: doc.s4 ?? undefined,
            computedAt: doc.computed_at,
        };
        if (!latestPivots[symbol])
            latestPivots[symbol] = {};
        if (!latestPivots[symbol][timeframe])
            latestPivots[symbol][timeframe] = {};
        latestPivots[symbol][timeframe][method] = levels;
        return levels;
    }
    // Fallback: If no pivot exists in DB, fetch the last completed candle to calculate pivots
    let lastCandle = null;
    try {
        lastCandle = await FuturesOHLC_1.FuturesOHLC.findOne({ symbol, timeframe }).sort({ bar_time: -1 });
    }
    catch (err) {
        // Suppress warning when offline
    }
    if (lastCandle) {
        const computed = await (0, exports.recalculatePivots)(symbol, timeframe, lastCandle.bar_high, lastCandle.bar_low, lastCandle.bar_close);
        return computed[method];
    }
    else {
        // Fallback: Calculate pivots using the current Redis LTP if DB is offline
        const rawFutLtp = await redis_1.default.get(`ltp:${symbol}`);
        const currentPrice = rawFutLtp ? parseFloat(rawFutLtp) : 22100;
        const computed = await (0, exports.recalculatePivots)(symbol, timeframe, currentPrice + 50, currentPrice - 50, currentPrice);
        return computed[method];
    }
    return null;
};
exports.getPivotLevels = getPivotLevels;
/**
 * Evaluates current indicators (Call/Put states) for a symbol, timeframe and pivot method
 */
const evaluateIndicators = async (symbol, timeframe, method, spotSymbol = "NIFTY-SPOT") => {
    try {
        // 1. Fetch latest prices from Redis cache
        const rawFutLtp = await redis_1.default.get(`ltp:${symbol}`);
        const rawSpotLtp = await redis_1.default.get(`ltp:${spotSymbol}`);
        if (!rawFutLtp || !rawSpotLtp) {
            return null;
        }
        const futLtp = parseFloat(rawFutLtp);
        const spotLtp = parseFloat(rawSpotLtp);
        // 2. Fetch the active pivots
        const pivots = await (0, exports.getPivotLevels)(symbol, timeframe, method);
        if (!pivots) {
            return null;
        }
        // 3. Compute indicators
        const divergencePct = (0, pivotEngine_1.getDivergence)(spotLtp, futLtp);
        const callState = (0, pivotEngine_1.getCallIndicator)(futLtp, { P: pivots.pivot, R1: pivots.r1, S1: pivots.s1 }, spotLtp);
        const putState = (0, pivotEngine_1.getPutIndicator)(futLtp, { P: pivots.pivot, R1: pivots.r1, S1: pivots.s1 }, spotLtp);
        return {
            symbol,
            callState,
            putState,
            divergencePct,
            hasDivergenceWarning: divergencePct > 0.5,
            computedAt: new Date(),
        };
    }
    catch (error) {
        console.error("Error evaluating indicators:", error);
        return null;
    }
};
exports.evaluateIndicators = evaluateIndicators;
