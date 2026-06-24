"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSessionData = exports.resumeSession = exports.updateTrackerStrikes = exports.startTrackerSession = exports.initTrackerEngine = exports.syncAetramSubscriptions = exports.activeSessions = void 0;
const Module2Session_1 = require("../models/Module2Session");
const Module2StrikeTick_1 = require("../models/Module2StrikeTick");
const redis_1 = __importDefault(require("../config/redis"));
const socketService_1 = require("./socketService");
const module2InteractiveDataService_1 = require("./module2InteractiveDataService");
const aetramMarketDataService_1 = require("./aetramMarketDataService");
// In-memory cache for active tracker sessions to avoid database load
exports.activeSessions = {};
let boundaryTimer = null;
/**
 * Helper to resolve the futures symbol for a given index symbol
 */
const getFuturesSymbol = (index) => {
    if (index === "NIFTY50")
        return "NIFTY-FUT";
    if (index === "BANKNIFTY")
        return "BANKNIFTY-FUT";
    if (index === "FINNIFTY")
        return "FINNIFTY-FUT";
    return `${index}-FUT`;
};
/**
 * Initializes the Module 2 tracking engine and schedules the minute boundary loop
 */
/**
 * Synchronizes active option strike subscriptions with AETRAM MarketData API
 */
const syncAetramSubscriptions = async () => {
    const resolvedInstruments = [];
    for (const session of Object.values(exports.activeSessions)) {
        for (const strike of session.selectedStrikes) {
            try {
                const inst = await (0, aetramMarketDataService_1.resolveOptionStrikeToken)(session.indexSymbol, session.expiryDate, strike);
                if (inst) {
                    resolvedInstruments.push(inst);
                }
            }
            catch (err) {
                console.error(`[Tracker] Error resolving Aetram strike ${strike}:`, err);
            }
        }
    }
    if (resolvedInstruments.length > 0) {
        await (0, aetramMarketDataService_1.subscribeToInstruments)(resolvedInstruments);
    }
};
exports.syncAetramSubscriptions = syncAetramSubscriptions;
/**
 * Initializes the Module 2 tracking engine and schedules the minute boundary loop
 */
const initTrackerEngine = async () => {
    (0, module2InteractiveDataService_1.logModule2InteractiveStatus)();
    // Load any existing active sessions from DB on startup (self-healing)
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const dbSessions = await Module2Session_1.Module2Session.find({
            created_at: { $gte: today }
        });
        for (const session of dbSessions) {
            await (0, exports.resumeSession)(session._id.toString());
        }
        await (0, exports.syncAetramSubscriptions)();
        console.log(`[TrackerEngine] Restored ${dbSessions.length} active sessions from database.`);
    }
    catch (error) {
        console.error("[TrackerEngine] Failed to restore sessions on startup:", error);
    }
    // Schedule the minute boundary checker
    scheduleNextMinuteBoundary();
};
exports.initTrackerEngine = initTrackerEngine;
/**
 * Schedules execution precisely on clock minute boundaries (00 seconds)
 */
const scheduleNextMinuteBoundary = () => {
    const now = Date.now();
    const delay = 60000 - (now % 60000);
    boundaryTimer = setTimeout(async () => {
        try {
            await executeMinuteBoundary();
        }
        catch (error) {
            console.error("[TrackerEngine] Error executing minute boundary:", error);
        }
        // Re-schedule
        scheduleNextMinuteBoundary();
    }, delay);
};
/**
 * Executed on every minute boundary. Captures prices, updates grids, and broadcasts events.
 */
const executeMinuteBoundary = async () => {
    const timestamp = new Date();
    const minutesSinceStart = getMinutesSinceStart();
    const timeString = timestamp.toLocaleTimeString("en-US", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit"
    });
    const sessionIds = Object.keys(exports.activeSessions);
    if (sessionIds.length === 0)
        return;
    console.log(`[TrackerEngine] Boundary trigger at ${timeString}. Processing ${sessionIds.length} sessions...`);
    for (const sessionId of sessionIds) {
        const session = exports.activeSessions[sessionId];
        // 1. Calculate Futures OI Delta
        const futSymbol = getFuturesSymbol(session.indexSymbol);
        const rawFutPrice = await redis_1.default.get(`ltp:${futSymbol}`);
        const rawFutOi = await redis_1.default.get(`oi:${futSymbol}`);
        let futLtp = rawFutPrice ? parseFloat(rawFutPrice) : 0;
        let futOi = rawFutOi ? Math.floor(parseFloat(rawFutOi)) : 0;
        let futuresOI = session.futuresOI;
        if (!futuresOI) {
            futuresOI = {
                symbol: futSymbol,
                oiLatest: futOi,
                oiDelta: 0,
                oiBuy: 0,
                oiSell: 0,
                oiHigh: futOi,
                oiLow: futOi
            };
            session.futuresOI = futuresOI;
        }
        if (futOi === 0) {
            futOi = futuresOI.oiLatest || 0;
        }
        const prevFutOi = futuresOI.oiLatest || 0;
        const futOiDelta = prevFutOi > 0 ? futOi - prevFutOi : 0;
        const futOiBuy = futOiDelta > 0 ? futOiDelta : 0;
        const futOiSell = futOiDelta < 0 ? futOiDelta : 0;
        futuresOI.oiLatest = futOi;
        futuresOI.oiDelta = futOiDelta;
        futuresOI.oiBuy = futOiBuy;
        futuresOI.oiSell = futOiSell;
        futuresOI.oiHigh = futuresOI.oiHigh ? Math.max(futuresOI.oiHigh, futOi) : futOi;
        futuresOI.oiLow = (futuresOI.oiLow && futuresOI.oiLow > 0) ? Math.min(futuresOI.oiLow, futOi) : futOi;
        session.futuresOI = futuresOI;
        try {
            await Module2Session_1.Module2Session.findByIdAndUpdate(sessionId, {
                futures_oi_json: futuresOI
            });
        }
        catch (err) {
            // Ignore DB write errors
        }
        // 2. Process Options Strikes
        for (const strike of session.selectedStrikes) {
            // Fetch latest price & OI from Redis cache
            const rawPrice = await redis_1.default.get(`ltp:${strike}`);
            let ltp = rawPrice ? Math.floor(parseFloat(rawPrice)) : 0;
            const rawOi = await redis_1.default.get(`oi:${strike}`);
            let oi = rawOi ? Math.floor(parseFloat(rawOi)) : 0;
            let strikeState = session.strikes[strike];
            // If strike state doesn't exist, initialize it
            if (!strikeState) {
                const dayOpen = ltp || 0; // Capture Day Open baseline at first observation
                strikeState = {
                    strike,
                    dayOpen,
                    dayHigh: dayOpen || 100,
                    dayLow: dayOpen || 100,
                    grid: [],
                    trendBadge: "FLAT",
                    isDowntrendActive: false,
                    isDeepLoss: false,
                    pctChange: 0,
                    oiLatest: oi,
                    oiBuyLatest: 0,
                    oiSellLatest: 0,
                    oiHigh: oi,
                    oiLow: oi,
                    oiMean: oi,
                    // Internal running totals for mean calculation (not in shared interface)
                    _oiRunningSum: oi,
                    _oiRowCount: 1
                };
                session.strikes[strike] = strikeState;
            }
            // Capture Day Open baseline at first observation!
            if (strikeState.dayOpen === 0 && ltp > 0) {
                strikeState.dayOpen = ltp;
                strikeState.dayHigh = ltp;
                strikeState.dayLow = ltp;
                session.dayOpenPrices[strike] = ltp;
                try {
                    await Module2Session_1.Module2Session.findByIdAndUpdate(sessionId, {
                        day_open_prices_json: session.dayOpenPrices
                    });
                }
                catch (err) {
                    // Ignore DB connection errors in offline mode
                }
            }
            // If price from Redis is 0/missing, fallback to previous price
            if (ltp === 0 && strikeState.grid.length > 0) {
                ltp = strikeState.grid[strikeState.grid.length - 1].ltp;
            }
            else if (ltp === 0) {
                ltp = strikeState.dayOpen || 100;
            }
            // If OI is 0, fallback to previous OI
            if (oi === 0 && strikeState.grid.length > 0) {
                oi = strikeState.grid[strikeState.grid.length - 1].oi || 0;
            }
            else if (oi === 0) {
                oi = strikeState.oiLatest || 0;
            }
            // Calculate OI Delta, Buy, Sell
            // First-row handling: at rowIndex 0 (no previous row), entire opening OI is treated as initial buy
            const isFirstRow = strikeState.grid.length === 0;
            let oiDelta = 0;
            let oiBuy = 0;
            let oiSell = 0;
            if (isFirstRow) {
                // At 9:15 AM first row: no previous to compare — treat all OI as initial buy
                oiBuy = oi;
                oiSell = 0;
                oiDelta = 0;
            }
            else {
                const prevOi = strikeState.grid[strikeState.grid.length - 1].oi || 0;
                oiDelta = prevOi > 0 ? oi - prevOi : 0;
                oiBuy = oiDelta > 0 ? oiDelta : 0;
                oiSell = oiDelta < 0 ? oiDelta : 0;
            }
            // Update High/Low boundaries for Price
            strikeState.dayHigh = Math.max(strikeState.dayHigh || ltp, ltp);
            strikeState.dayLow = Math.min(strikeState.dayLow || ltp, ltp);
            const denominator = strikeState.dayOpen || 100;
            strikeState.pctChange = Number((((ltp - denominator) / denominator) * 100).toFixed(2));
            // Update boundaries for OI
            if (isFirstRow) {
                // First row: seed High and Low from initial OI value
                strikeState.oiHigh = oi;
                strikeState.oiLow = oi;
            }
            else {
                strikeState.oiHigh = strikeState.oiHigh ? Math.max(strikeState.oiHigh, oi) : oi;
                strikeState.oiLow = (strikeState.oiLow && strikeState.oiLow > 0) ? Math.min(strikeState.oiLow, oi) : oi;
            }
            strikeState.oiLatest = oi;
            strikeState.oiBuyLatest = oiBuy;
            strikeState.oiSellLatest = oiSell;
            // Update running OI sum and compute mean
            const s = strikeState;
            if (isFirstRow) {
                // Seed running sum on first row
                s._oiRunningSum = oi;
                s._oiRowCount = 1;
            }
            else {
                s._oiRunningSum = (s._oiRunningSum || 0) + oi;
                s._oiRowCount = (s._oiRowCount || 1) + 1;
            }
            strikeState.oiMean = s._oiRowCount > 0 ? Math.round(s._oiRunningSum / s._oiRowCount) : oi;
            // 3. Evaluate trend badge
            const previousBadge = strikeState.trendBadge;
            const recentLtpList = strikeState.grid.slice(-4).map(c => c.ltp);
            recentLtpList.push(ltp); // Include current tick to form 5-min lookback
            let newBadge = "FLAT";
            if (recentLtpList.length >= 5) {
                let higherHighs = 0;
                let lowerLows = 0;
                for (let i = 1; i < recentLtpList.length; i++) {
                    if (recentLtpList[i] > recentLtpList[i - 1])
                        higherHighs++;
                    if (recentLtpList[i] < recentLtpList[i - 1])
                        lowerLows++;
                }
                if (lowerLows >= 4) {
                    newBadge = "H_TO_L";
                }
                else if (higherHighs >= 4) {
                    newBadge = "L_TO_H";
                }
            }
            // Handle Trend Reversal Detection
            if (previousBadge === "H_TO_L" && newBadge === "FLAT" && recentLtpList.length >= 2 && recentLtpList[recentLtpList.length - 1] > recentLtpList[recentLtpList.length - 2]) {
                newBadge = "REVERSAL";
            }
            else if (previousBadge === "L_TO_H" && newBadge === "FLAT" && recentLtpList.length >= 2 && recentLtpList[recentLtpList.length - 1] < recentLtpList[recentLtpList.length - 2]) {
                newBadge = "REVERSAL";
            }
            strikeState.trendBadge = newBadge;
            // 4. Evaluate Call-Down Advisory Filter (CE options only)
            const isCE = strike.endsWith("CE");
            if (isCE) {
                // Deep Loss Check (>15% drop from baseline)
                if (ltp < strikeState.dayOpen * 0.85) {
                    strikeState.isDeepLoss = true;
                }
                // Downtrend Check (3 consecutive minutes declining)
                const recent3 = strikeState.grid.slice(-2).map(c => c.ltp);
                recent3.push(ltp);
                if (recent3.length >= 3 && recent3[0] > recent3[1] && recent3[1] > recent3[2]) {
                    strikeState.isDowntrendActive = true;
                }
                // Recovery Check (2 consecutive rising minutes clears all alerts)
                if (recent3.length >= 3 && recent3[recent3.length - 1] > recent3[recent3.length - 2] && recent3[recent3.length - 2] > recent3[recent3.length - 3]) {
                    strikeState.isDowntrendActive = false;
                    strikeState.isDeepLoss = false;
                }
            }
            // Create new cell
            const cell = {
                ltp,
                minute: minutesSinceStart,
                timestamp: timeString,
                isHigh: ltp === strikeState.dayHigh,
                isLow: ltp === strikeState.dayLow,
                oi,
                oiDelta,
                oiBuy,
                oiSell
            };
            strikeState.grid.push(cell);
            // Save to Database
            try {
                await Module2StrikeTick_1.Module2StrikeTick.create({
                    session_id: sessionId,
                    strike,
                    minute_timestamp: timestamp,
                    ltp_integer: ltp,
                    is_day_high: cell.isHigh,
                    is_day_low: cell.isLow,
                    pct_from_open: strikeState.pctChange,
                    is_downtrend_flagged: strikeState.isDowntrendActive,
                    oi,
                    oi_delta: oiDelta,
                    oi_buy: oiBuy,
                    oi_sell: oiSell
                });
            }
            catch (err) {
                // Suppress warning to avoid console spamming when DB is offline
            }
            // Broadcast to connected clients
            (0, socketService_1.broadcastTrackerUpdate)(sessionId, {
                strike,
                cell,
                state: {
                    dayHigh: strikeState.dayHigh,
                    dayLow: strikeState.dayLow,
                    trendBadge: strikeState.trendBadge,
                    isDowntrendActive: strikeState.isDowntrendActive,
                    isDeepLoss: strikeState.isDeepLoss,
                    pctChange: strikeState.pctChange,
                    oiLatest: strikeState.oiLatest,
                    oiBuyLatest: strikeState.oiBuyLatest,
                    oiSellLatest: strikeState.oiSellLatest,
                    oiHigh: strikeState.oiHigh,
                    oiLow: strikeState.oiLow,
                    oiMean: strikeState.oiMean
                },
                futuresOI: session.futuresOI
            });
        }
    }
};
/**
 * Starts a new Module 2 tracking session
 */
const startTrackerSession = async (userId, sessionType, indexSymbol, expiryDate, selectedStrikes) => {
    // Capture Day Open prices and OI for each selected strike from Redis
    const dayOpenPrices = {};
    const strikes = {};
    for (const strike of selectedStrikes) {
        const rawPrice = await redis_1.default.get(`ltp:${strike}`);
        const ltp = rawPrice ? Math.floor(parseFloat(rawPrice)) : 0; // Capture baseline at first observation
        const rawOi = await redis_1.default.get(`oi:${strike}`);
        const oi = rawOi ? Math.floor(parseFloat(rawOi)) : 0;
        dayOpenPrices[strike] = ltp;
        strikes[strike] = {
            strike,
            dayOpen: ltp,
            dayHigh: ltp || 100,
            dayLow: ltp || 100,
            grid: [],
            trendBadge: "FLAT",
            isDowntrendActive: false,
            isDeepLoss: false,
            pctChange: 0,
            oiLatest: oi,
            oiBuyLatest: 0,
            oiSellLatest: 0,
            oiHigh: oi,
            oiLow: oi,
            oiMean: oi,
            _oiRunningSum: oi,
            _oiRowCount: 1
        };
    }
    // Resolve Futures symbols and fetch details
    const futSymbol = getFuturesSymbol(indexSymbol);
    const rawFutPrice = await redis_1.default.get(`ltp:${futSymbol}`);
    const rawFutOi = await redis_1.default.get(`oi:${futSymbol}`);
    const futPrice = rawFutPrice ? parseFloat(rawFutPrice) : 0;
    const futOi = rawFutOi ? Math.floor(parseFloat(rawFutOi)) : 0;
    const futuresOI = {
        symbol: futSymbol,
        oiLatest: futOi,
        oiDelta: 0,
        oiBuy: 0,
        oiSell: 0,
        oiHigh: futOi,
        oiLow: futOi
    };
    // Create session record in DB
    let sessionId;
    let createdAt;
    try {
        const doc = await Module2Session_1.Module2Session.create({
            user_id: userId,
            session_type: sessionType,
            index_symbol: indexSymbol,
            expiry_date: expiryDate,
            selected_strikes_json: selectedStrikes,
            day_open_prices_json: dayOpenPrices,
            futures_oi_json: futuresOI
        });
        sessionId = doc._id.toString();
        createdAt = doc.created_at;
    }
    catch (dbErr) {
        console.warn("[TrackerEngine] MongoDB offline. Creating tracker session in-memory only.");
        sessionId = "mock-session-" + Date.now() + "-" + Math.random().toString(36).substring(2, 9);
        createdAt = new Date();
    }
    const sessionData = {
        sessionId,
        userId,
        dataSource: (0, module2InteractiveDataService_1.getModule2DataSource)(),
        sessionType,
        indexSymbol,
        expiryDate,
        selectedStrikes,
        dayOpenPrices,
        strikes,
        createdAt,
        futuresOI
    };
    // Add to local active sessions cache
    exports.activeSessions[sessionId] = sessionData;
    // Trigger Aetram subscription synchronization in the background
    (0, exports.syncAetramSubscriptions)().catch((err) => console.error("[TrackerEngine] Aetram subscription sync failed:", err));
    return sessionData;
};
exports.startTrackerSession = startTrackerSession;
/**
 * Swaps strikes dynamically within an active tracking session without losing history for others
 */
const updateTrackerStrikes = async (sessionId, newStrikes) => {
    const session = exports.activeSessions[sessionId];
    if (!session) {
        throw new Error("Active session not found");
    }
    // Identify new strikes to initialize baselines
    for (const strike of newStrikes) {
        if (!session.selectedStrikes.includes(strike)) {
            const rawPrice = await redis_1.default.get(`ltp:${strike}`);
            const ltp = rawPrice ? Math.floor(parseFloat(rawPrice)) : 0; // Capture baseline at first observation
            const rawOi = await redis_1.default.get(`oi:${strike}`);
            const oi = rawOi ? Math.floor(parseFloat(rawOi)) : 0;
            session.dayOpenPrices[strike] = ltp;
            session.strikes[strike] = {
                strike,
                dayOpen: ltp,
                dayHigh: ltp || 100,
                dayLow: ltp || 100,
                grid: [],
                trendBadge: "FLAT",
                isDowntrendActive: false,
                isDeepLoss: false,
                pctChange: 0,
                oiLatest: oi,
                oiBuyLatest: 0,
                oiSellLatest: 0,
                oiHigh: oi,
                oiLow: oi,
                oiMean: oi,
                _oiRunningSum: oi,
                _oiRowCount: 1
            };
        }
    }
    // Remove retired strikes from the active selection
    session.selectedStrikes = newStrikes;
    // Trigger Aetram subscription synchronization in the background
    (0, exports.syncAetramSubscriptions)().catch((err) => console.error("[TrackerEngine] Aetram subscription sync failed:", err));
    // Update Database session configuration
    try {
        await Module2Session_1.Module2Session.findByIdAndUpdate(sessionId, {
            selected_strikes_json: newStrikes,
            day_open_prices_json: session.dayOpenPrices
        });
    }
    catch (dbErr) {
        console.warn("[TrackerEngine] MongoDB offline. Skipping DB update in updateTrackerStrikes.");
    }
    return session;
};
exports.updateTrackerStrikes = updateTrackerStrikes;
/**
 * Resumes an active session from the database (e.g. on server restart)
 */
const resumeSession = async (sessionId) => {
    let doc = null;
    try {
        doc = await Module2Session_1.Module2Session.findById(sessionId);
    }
    catch (dbErr) {
        console.warn("[TrackerEngine] MongoDB offline. Cannot resume session from DB.");
        return null;
    }
    if (!doc)
        return null;
    const strikes = {};
    const dayOpenPrices = doc.day_open_prices_json;
    // Load per-minute tick history from database to reconstruct the grid
    for (const strike of doc.selected_strikes_json) {
        const ticks = await Module2StrikeTick_1.Module2StrikeTick.find({ session_id: sessionId, strike }).sort({ minute_timestamp: 1 });
        const grid = ticks.map((t, idx) => ({
            ltp: t.ltp_integer,
            minute: idx,
            timestamp: t.minute_timestamp.toLocaleTimeString("en-US", {
                hour12: false,
                hour: "2-digit",
                minute: "2-digit"
            }),
            isHigh: t.is_day_high,
            isLow: t.is_day_low,
            oi: t.oi || 0,
            oiDelta: t.oi_delta || 0,
            oiBuy: t.oi_buy || 0,
            oiSell: t.oi_sell || 0
        }));
        const ltp = grid.length > 0 ? grid[grid.length - 1].ltp : (dayOpenPrices[strike] || 100);
        const dayHigh = ticks.reduce((max, t) => Math.max(max, t.ltp_integer), dayOpenPrices[strike] || 100);
        const dayLow = ticks.reduce((min, t) => Math.min(min, t.ltp_integer), dayOpenPrices[strike] || 100);
        const isDowntrendActive = grid.length > 0 ? ticks[ticks.length - 1].is_downtrend_flagged : false;
        const isDeepLoss = ltp < (dayOpenPrices[strike] || 100) * 0.85;
        // Estimate trend badge from reconstructed grid
        let trendBadge = "FLAT";
        if (grid.length >= 5) {
            const recent = grid.slice(-5).map(c => c.ltp);
            let up = 0, down = 0;
            for (let i = 1; i < recent.length; i++) {
                if (recent[i] > recent[i - 1])
                    up++;
                if (recent[i] < recent[i - 1])
                    down++;
            }
            if (down >= 4)
                trendBadge = "H_TO_L";
            else if (up >= 4)
                trendBadge = "L_TO_H";
        }
        const oiLatest = grid.length > 0 ? grid[grid.length - 1].oi : 0;
        const oiBuyLatest = grid.length > 0 ? grid[grid.length - 1].oiBuy : 0;
        const oiSellLatest = grid.length > 0 ? grid[grid.length - 1].oiSell : 0;
        const oiHigh = ticks.reduce((max, t) => Math.max(max, t.oi || 0), 0);
        const oiLow = ticks.reduce((min, t) => {
            const val = t.oi || 0;
            if (val === 0)
                return min;
            return min === 0 ? val : Math.min(min, val);
        }, 0);
        // Reconstruct running sum for mean calculation
        const oiRunningSum = ticks.reduce((sum, t) => sum + (t.oi || 0), 0);
        const oiRowCount = ticks.length;
        const oiMean = oiRowCount > 0 ? Math.round(oiRunningSum / oiRowCount) : oiLatest;
        strikes[strike] = {
            strike,
            dayOpen: dayOpenPrices[strike] || 100,
            dayHigh,
            dayLow,
            grid,
            trendBadge,
            isDowntrendActive,
            isDeepLoss,
            pctChange: Number((((ltp - (dayOpenPrices[strike] || 100)) / (dayOpenPrices[strike] || 100)) * 100).toFixed(2)),
            oiLatest,
            oiBuyLatest,
            oiSellLatest,
            oiHigh: oiHigh || oiLatest,
            oiLow: oiLow || oiLatest,
            oiMean,
            _oiRunningSum: oiRunningSum,
            _oiRowCount: oiRowCount
        };
    }
    // Restore futures details
    const futuresOI = doc.futures_oi_json || {
        symbol: getFuturesSymbol(doc.index_symbol),
        oiLatest: 0,
        oiDelta: 0,
        oiBuy: 0,
        oiSell: 0,
        oiHigh: 0,
        oiLow: 0
    };
    const sessionData = {
        sessionId: doc._id.toString(),
        userId: doc.user_id.toString(),
        dataSource: (0, module2InteractiveDataService_1.getModule2DataSource)(),
        sessionType: doc.session_type,
        indexSymbol: doc.index_symbol,
        expiryDate: doc.expiry_date,
        selectedStrikes: doc.selected_strikes_json,
        dayOpenPrices,
        strikes,
        createdAt: doc.created_at,
        futuresOI
    };
    exports.activeSessions[sessionId] = sessionData;
    return sessionData;
};
exports.resumeSession = resumeSession;
/**
 * Gets session data from cache or loads it from DB
 */
const getSessionData = async (sessionId) => {
    if (exports.activeSessions[sessionId]) {
        return exports.activeSessions[sessionId];
    }
    return await (0, exports.resumeSession)(sessionId);
};
exports.getSessionData = getSessionData;
/**
 * Helper to compute elapsed minutes since the baseline 9:15 AM (or session start)
 */
const getMinutesSinceStart = () => {
    const now = new Date();
    const start = new Date();
    start.setHours(9, 15, 0, 0);
    // If before 9:15 AM, return 0 (grid starts index 0)
    if (now.getTime() < start.getTime())
        return 0;
    return Math.floor((now.getTime() - start.getTime()) / 60000);
};
