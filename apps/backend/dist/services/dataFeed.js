"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.processIncomingTick = exports.stopDataFeed = exports.startDataFeedWithCredentials = exports.setOnTickReceived = void 0;
const redis_1 = __importDefault(require("../config/redis"));
const ohlcAggregator_1 = require("./ohlcAggregator");
const module1OiService_1 = require("./module1OiService");
const monitoringService_1 = require("./monitoringService");
const zebuMarketDataClient_1 = require("./zebuMarketDataClient");
const socketService_1 = require("./socketService");
const instrumentTokenService_1 = require("./instrumentTokenService");
let zebuClient = null;
let onTickReceived = null;
const setOnTickReceived = (callback) => {
    onTickReceived = callback;
};
exports.setOnTickReceived = setOnTickReceived;
// ── Reconnection state ────────────────────────────────────────────────────────
let storedUserId = null;
let storedSessionToken = null;
let reconnectAttempts = 0;
let reconnectTimer = null;
let sessionExpired = false;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY_MS = 4000;
const clearReconnectTimer = () => {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
};
const handleFeedDisconnect = (reason) => {
    zebuClient = null;
    (0, module1OiService_1.setModule1OiDataSource)("SIMULATOR");
    if (sessionExpired)
        return; // don't reconnect on session expiry
    if (!storedUserId || !storedSessionToken) {
        console.warn("[DataFeed] No stored credentials — cannot reconnect.");
        (0, socketService_1.broadcastBrokerStatus)("broker-disconnected", reason);
        return;
    }
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.warn(`[DataFeed] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Stopping.`);
        (0, socketService_1.broadcastBrokerStatus)("broker-disconnected", "Max reconnection attempts exceeded");
        storedUserId = null;
        storedSessionToken = null;
        return;
    }
    const delay = RECONNECT_BASE_DELAY_MS * Math.pow(2, reconnectAttempts);
    reconnectAttempts++;
    console.log(`[DataFeed] Reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})…`);
    (0, socketService_1.broadcastBrokerStatus)("reconnecting", `Attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`);
    reconnectTimer = setTimeout(async () => {
        if (!storedUserId || !storedSessionToken)
            return;
        await (0, exports.startDataFeedWithCredentials)(storedUserId, storedSessionToken);
    }, delay);
};
const handleSessionExpired = () => {
    zebuClient = null;
    sessionExpired = true;
    storedUserId = null;
    storedSessionToken = null;
    clearReconnectTimer();
    (0, module1OiService_1.setModule1OiDataSource)("SIMULATOR");
    console.warn("[DataFeed] Broker session expired — user must re-authenticate.");
    (0, socketService_1.broadcastBrokerStatus)("session-expired", "Broker session expired. Please reconnect.");
};
/**
 * Start the live data feed using credentials obtained from user-initiated broker login.
 * Called by module1BrokerLogin controller after successful Zebu QuickAuth.
 */
const startDataFeedWithCredentials = async (userId, sessionToken) => {
    // Close any existing connection first
    if (zebuClient) {
        try {
            zebuClient.close();
        }
        catch { }
        zebuClient = null;
    }
    clearReconnectTimer();
    // Store credentials for auto-reconnection
    storedUserId = userId;
    storedSessionToken = sessionToken;
    sessionExpired = false;
    reconnectAttempts = 0;
    // Always refresh instrument tokens before connecting (handles weekly/monthly expiry)
    console.log("[DataFeed] Refreshing instrument tokens from NFO master...");
    const freshTokens = await (0, instrumentTokenService_1.refreshInstrumentTokens)().catch(() => null);
    if (freshTokens) {
        (0, zebuMarketDataClient_1.setRuntimeInstrumentTokens)(freshTokens.futToken, freshTokens.ceTokens, freshTokens.peTokens);
        console.log(`[DataFeed] Tokens refreshed — futures expiry: ${freshTokens.futExpiry} | option expiry: ${freshTokens.nearestOptionExpiry}`);
    }
    else {
        console.warn("[DataFeed] NFO token refresh failed — using .env tokens.");
    }
    console.log(`[DataFeed] Starting live feed for user: ${userId}`);
    (0, module1OiService_1.setModule1OiDataSource)("LIVE_MARKET_API");
    (0, socketService_1.broadcastBrokerStatus)("live");
    zebuClient = (0, zebuMarketDataClient_1.startZebuMarketDataFeedWithCredentials)(userId, sessionToken, exports.processIncomingTick, module1OiService_1.setModule1OiDataSource, (reason) => {
        console.warn(`[DataFeed] Feed disconnected: ${reason}`);
        handleFeedDisconnect(reason);
    }, () => handleSessionExpired());
};
exports.startDataFeedWithCredentials = startDataFeedWithCredentials;
/**
 * Stop the live feed and clear credentials (called on explicit logout).
 */
const stopDataFeed = () => {
    clearReconnectTimer();
    storedUserId = null;
    storedSessionToken = null;
    sessionExpired = false;
    reconnectAttempts = 0;
    if (zebuClient) {
        try {
            zebuClient.close();
        }
        catch { }
        zebuClient = null;
    }
    (0, module1OiService_1.setModule1OiDataSource)("SIMULATOR");
};
exports.stopDataFeed = stopDataFeed;
// ── Tick processing ───────────────────────────────────────────────────────────
let _totalTickCount = 0;
let _firstTickLogged = false;
const processIncomingTick = async (tick) => {
    const { symbol, ltp, oi } = tick;
    _totalTickCount++;
    if (!_firstTickLogged) {
        _firstTickLogged = true;
        console.log(`[Feed] First tick — symbol: ${symbol} ltp: ${ltp} oi: ${oi ?? "—"}`);
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
        await (0, ohlcAggregator_1.aggregateOHLC)(tick, 2, "2m");
        await (0, ohlcAggregator_1.aggregateOHLC)(tick, 3, "3m");
        await (0, ohlcAggregator_1.aggregateOHLC)(tick, 5, "5m");
        await (0, ohlcAggregator_1.aggregateOHLC)(tick, 10, "10m");
        await (0, ohlcAggregator_1.aggregateOHLC)(tick, 15, "15m");
        await (0, ohlcAggregator_1.aggregateOHLC)(tick, 30, "30m");
        await (0, ohlcAggregator_1.aggregateOHLC)(tick, 45, "45m");
        await (0, ohlcAggregator_1.aggregateOHLC)(tick, 60, "1h");
        await (0, ohlcAggregator_1.aggregateOHLC)(tick, 120, "2h");
        await (0, ohlcAggregator_1.aggregateOHLC)(tick, 180, "3h");
        await (0, ohlcAggregator_1.aggregateOHLC)(tick, 240, "4h");
    }
    if (onTickReceived) {
        onTickReceived(tick);
    }
};
exports.processIncomingTick = processIncomingTick;
