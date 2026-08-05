"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const module2_1 = require("../controllers/module2");
const module2Auth_1 = require("../controllers/module2Auth");
const module2Instruments_1 = require("../controllers/module2Instruments");
const module2Subscriptions_1 = require("../controllers/module2Subscriptions");
const module2WebSocket_1 = require("../controllers/module2WebSocket");
const module2Cache_1 = require("../controllers/module2Cache");
const module2Candles_1 = require("../controllers/module2Candles");
const module2History_1 = require("../controllers/module2History");
const module2Archive_1 = require("../controllers/module2Archive");
const module2Socket_1 = require("../controllers/module2Socket");
const router = (0, express_1.Router)();
// Same policy as routes/auth.ts — credential endpoints are brute-force targets.
const authRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 15,
    message: { error: "Too many authentication requests. Please try again after 15 minutes." },
    standardHeaders: true,
    legacyHeaders: false,
});
router.get("/status", module2_1.getModule2Status);
router.get("/expiries", module2_1.getModule2Expiries);
// Market Data authentication & session management
router.post("/auth/login", authRateLimiter, module2Auth_1.module2AuthLogin);
router.post("/auth/logout", authRateLimiter, module2Auth_1.module2AuthLogout);
router.get("/auth/status", module2Auth_1.module2AuthStatus);
// Instrument Discovery layer (Phase 3)
router.get("/instruments/search", module2Instruments_1.module2SearchInstruments);
router.get("/instruments/expiry", module2Instruments_1.module2GetExpiry);
router.post("/instruments/resolve", module2Instruments_1.module2ResolveInstrument);
// Subscription Management layer (Phase 4)
router.post("/subscriptions", module2Subscriptions_1.module2Subscribe);
router.post("/subscriptions/bulk", module2Subscriptions_1.module2BulkSubscribe);
router.delete("/subscriptions", module2Subscriptions_1.module2Unsubscribe);
router.get("/subscriptions", module2Subscriptions_1.module2GetSubscriptions);
// WebSocket Connection Manager (Phase 5)
router.post("/ws/connect", module2WebSocket_1.module2WsConnect);
router.post("/ws/disconnect", module2WebSocket_1.module2WsDisconnect);
router.post("/ws/reconnect", module2WebSocket_1.module2WsReconnect);
router.get("/ws/status", module2WebSocket_1.module2WsStatus);
// Market Data Cache layer (Phase 8)
// /cache/stats is registered before /cache/:instrumentId so "stats" is never
// swallowed as an instrument ID by the param route.
router.get("/cache/stats", module2Cache_1.module2GetCacheStats);
router.get("/cache/:instrumentId", module2Cache_1.module2GetCacheEntry);
router.get("/cache", module2Cache_1.module2GetCache);
router.delete("/cache", module2Cache_1.module2ClearCache);
// Minute Aggregation Engine (Phase 9)
// /candles/current and /candles/stats are registered before /candles/:instrumentId
// for the same reason as the cache routes above.
router.get("/candles/current", module2Candles_1.module2GetCurrentCandles);
router.get("/candles/stats", module2Candles_1.module2GetCandleStats);
router.get("/candles/:instrumentId", module2Candles_1.module2GetCandleForInstrument);
router.delete("/candles", module2Candles_1.module2ClearCandles);
// Redis Persistence Layer (Phase 10)
// /history/stats is registered before /history/:instrumentId for the same
// reason as the cache/candle routes above; /history/:instrumentId/latest has
// an extra path segment so it never collides with either.
router.get("/history/stats", module2History_1.module2GetHistoryStats);
router.get("/history/:instrumentId/latest", module2History_1.module2GetLatestHistoryCandle);
router.get("/history/:instrumentId", module2History_1.module2GetHistory);
router.delete("/history/:instrumentId", module2History_1.module2DeleteHistory);
// MongoDB Historical Storage (Phase 11)
// /archive/stats is registered before /archive/:instrumentId for the same
// reason as the routes above; /archive/:instrumentId/latest and
// /archive/:instrumentId/range each have an extra path segment so neither
// collides with the single-segment routes.
router.get("/archive/stats", module2Archive_1.module2GetArchiveStats);
router.get("/archive/:instrumentId/latest", module2Archive_1.module2GetLatestArchivedCandle);
router.get("/archive/:instrumentId/range", module2Archive_1.module2GetArchiveRange);
router.get("/archive/:instrumentId", module2Archive_1.module2GetArchive);
router.delete("/archive/:instrumentId", module2Archive_1.module2DeleteArchive);
// Socket.IO Broadcast Layer (Phase 12)
router.get("/socket/stats", module2Socket_1.module2GetSocketStats);
router.get("/socket/clients", module2Socket_1.module2GetSocketClients);
exports.default = router;
