"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.processIncomingTick = exports.startDataFeedWithCredentials = exports.setOnTickReceived = void 0;
const redis_1 = __importDefault(require("../config/redis"));
const ohlcAggregator_1 = require("./ohlcAggregator");
const module1OiService_1 = require("./module1OiService");
const monitoringService_1 = require("./monitoringService");
const zebuMarketDataClient_1 = require("./zebuMarketDataClient");
let zebuClient = null;
let isMockActive = false;
let onTickReceived = null;
const setOnTickReceived = (callback) => {
    onTickReceived = callback;
};
exports.setOnTickReceived = setOnTickReceived;
/**
 * Start the live data feed using credentials obtained from user-initiated broker login.
 * Called by module1BrokerLogin controller after successful Zebu QuickAuth.
 * Never called automatically on server startup.
 */
const startDataFeedWithCredentials = (userId, sessionToken) => {
    // Close any existing connection first
    if (zebuClient) {
        try {
            zebuClient.close();
        }
        catch { }
        zebuClient = null;
    }
    isMockActive = false;
    console.log(`[DataFeed] Starting live feed for user: ${userId}`);
    (0, module1OiService_1.setModule1OiDataSource)("LIVE_MARKET_API");
    zebuClient = (0, zebuMarketDataClient_1.startZebuMarketDataFeedWithCredentials)(userId, sessionToken, exports.processIncomingTick, module1OiService_1.setModule1OiDataSource, (reason) => {
        console.warn(`[DataFeed] Live feed disconnected: ${reason}. No automatic fallback.`);
        zebuClient = null;
        (0, module1OiService_1.setModule1OiDataSource)("SIMULATOR");
    });
};
exports.startDataFeedWithCredentials = startDataFeedWithCredentials;
/**
 * Handles caching and candle aggregation for each incoming tick.
 * Unchanged from original — do not modify this function.
 */
let _totalTickCount = 0;
let _firstTickLogged = false;
const processIncomingTick = async (tick) => {
    const { symbol, ltp, oi } = tick;
    _totalTickCount++;
    if (!_firstTickLogged) {
        _firstTickLogged = true;
        console.log(`[Feed] First tick received — symbol: ${symbol} ltp: ${ltp} oi: ${oi ?? "—"}`);
    }
    if (_totalTickCount % 100 === 0) {
        console.log(`[Feed] Tick #${_totalTickCount} | symbol: ${symbol} ltp: ${ltp} oi: ${oi ?? "—"}`);
    }
    (0, monitoringService_1.recordTickReceived)();
    await redis_1.default.set(`ltp:${symbol}`, ltp.toString());
    if (oi !== undefined) {
        await redis_1.default.set(`oi:${symbol}`, oi.toString());
    }
    (0, module1OiService_1.ingestModule1OiTick)(tick);
    if (symbol.endsWith("-FUT") || symbol.includes("FUT")) {
        await (0, ohlcAggregator_1.aggregateOHLC)(tick, 1, "1m");
        await (0, ohlcAggregator_1.aggregateOHLC)(tick, 3, "3m");
        await (0, ohlcAggregator_1.aggregateOHLC)(tick, 5, "5m");
        try {
            const customTf = await redis_1.default.get("config:custom_timeframe");
            if (customTf && customTf.endsWith("m")) {
                const minutes = parseInt(customTf);
                if (minutes > 0 && minutes !== 1 && minutes !== 3 && minutes !== 5) {
                    await (0, ohlcAggregator_1.aggregateOHLC)(tick, minutes, customTf);
                }
            }
        }
        catch { }
    }
    if (onTickReceived) {
        onTickReceived(tick);
    }
};
exports.processIncomingTick = processIncomingTick;
