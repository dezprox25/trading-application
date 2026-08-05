"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getModuleStatus = exports.getMarketStatus = exports.isMarketOpenTime = exports.updateCustomTimeframe = exports.getModule1Strikes = exports.getModule1Expiries = exports.getModule1Symbols = exports.getModule1Instruments = exports.getModule1Exchanges = exports.getOptionChain = exports.getModule1LatestOi = exports.getIndicatorsEndpoint = exports.getPivotLevelsEndpoint = exports.getHistoricalOHLCBars = exports.getWarmupOHLCBars = exports.getOHLCBars = exports.getFuturesData = exports.getSpotPrice = exports.updateWatchlist = exports.getWatchlist = void 0;
const Watchlist_1 = require("../models/Watchlist");
const FuturesOHLC_1 = require("../models/FuturesOHLC");
const redis_1 = __importDefault(require("../config/redis"));
const redisWriteBuffer_1 = require("../services/redisWriteBuffer");
const shared_1 = require("@stock/shared");
const ohlcAggregator_1 = require("../services/ohlcAggregator");
const pivotService_1 = require("../services/pivotService");
const module1OiService_1 = require("../services/module1OiService");
const zebuMarketDataClient_1 = require("../services/zebuMarketDataClient");
const aetramMarketDataService_1 = require("../services/aetramMarketDataService");
const instrumentTokenService_1 = require("../services/instrumentTokenService");
// Returns the start of the current NSE trading session in UTC.
// NSE opens at 09:15 IST = 03:45 UTC. If it's currently before 03:45 UTC,
// the active session is from the previous calendar day.
const getTodaySessionOpenUTC = () => {
    const now = new Date();
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 3, 45, 0, 0));
    if (now.getTime() < d.getTime())
        d.setUTCDate(d.getUTCDate() - 1);
    return d;
};
// Local in-memory watchlists store for when MongoDB is offline
const inMemoryWatchlists = new Map();
// Seed default watchlists for guest users
inMemoryWatchlists.set("60c72b2f9b1d8a0015f8e567", {
    symbols: ["NIFTY-SPOT", "NIFTY-FUT"],
    columnPrefs: { pivots: true, indicators: true }
});
// Fetch User Watchlist
const getWatchlist = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        let symbols = ["NIFTY-SPOT", "NIFTY-FUT"];
        let columnPrefs = { pivots: true, indicators: true };
        try {
            let list = await Watchlist_1.Watchlist.findOne({ user_id: userId });
            if (!list) {
                list = await Watchlist_1.Watchlist.create({
                    user_id: userId,
                    symbols_json: symbols,
                    column_prefs_json: columnPrefs
                });
            }
            symbols = list.symbols_json;
            columnPrefs = list.column_prefs_json;
        }
        catch (err) {
            console.warn("[Market] MongoDB offline. Loading watchlist from in-memory cache.");
            if (!inMemoryWatchlists.has(userId)) {
                inMemoryWatchlists.set(userId, { symbols, columnPrefs });
            }
            const cached = inMemoryWatchlists.get(userId);
            symbols = cached.symbols;
            columnPrefs = cached.columnPrefs;
        }
        return res.status(200).json({
            symbols,
            columnPrefs
        });
    }
    catch (error) {
        console.error("Fetch Watchlist Error:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
};
exports.getWatchlist = getWatchlist;
// Update User Watchlist
const updateWatchlist = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        const parseResult = shared_1.WatchlistSchema.safeParse(req.body);
        if (!parseResult.success) {
            return res.status(400).json({ error: "Validation failed", details: parseResult.error.errors });
        }
        const { symbols, columnPrefs } = parseResult.data;
        try {
            await Watchlist_1.Watchlist.findOneAndUpdate({ user_id: userId }, { symbols_json: symbols, column_prefs_json: columnPrefs || {} }, { new: true, upsert: true });
        }
        catch (err) {
            console.warn("[Market] MongoDB offline. Updating watchlist in memory.");
        }
        inMemoryWatchlists.set(userId, { symbols, columnPrefs: columnPrefs || {} });
        return res.status(200).json({
            message: "Watchlist updated successfully",
            symbols,
            columnPrefs: columnPrefs || {}
        });
    }
    catch (error) {
        console.error("Update Watchlist Error:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
};
exports.updateWatchlist = updateWatchlist;
// Get Spot Price
const getSpotPrice = async (req, res) => {
    try {
        const { symbol } = req.params;
        const price = await (0, redisWriteBuffer_1.readLive)(`ltp:${symbol}`);
        if (!price) {
            return res.status(404).json({ error: `Price for symbol ${symbol} not found` });
        }
        return res.status(200).json({
            symbol,
            ltp: parseFloat(price),
            timestamp: new Date()
        });
    }
    catch (error) {
        console.error("Get Spot Price Error:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
};
exports.getSpotPrice = getSpotPrice;
// Get Futures LTP and current active Candle
const getFuturesData = async (req, res) => {
    try {
        const { symbol } = req.params;
        const timeframe = req.query.timeframe || "5m";
        const price = await (0, redisWriteBuffer_1.readLive)(`ltp:${symbol}`);
        const candle = (0, ohlcAggregator_1.getActiveCandle)(symbol, timeframe);
        return res.status(200).json({
            symbol,
            ltp: price ? parseFloat(price) : 0,
            activeCandle: candle
        });
    }
    catch (error) {
        console.error("Get Futures Data Error:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
};
exports.getFuturesData = getFuturesData;
// Get completed OHLC candles from Database
const getOHLCBars = async (req, res) => {
    const { symbol, tf } = req.params;
    const limit = req.query.limit ? parseInt(req.query.limit) : 400;
    const fetchLimit = limit;
    let bars = [];
    // Step 1: Try MongoDB for finalized candles — scoped to today's session only
    try {
        const sessionOpen = getTodaySessionOpenUTC();
        const dbBars = await FuturesOHLC_1.FuturesOHLC.find({ symbol, timeframe: tf, bar_time: { $gte: sessionOpen } })
            .sort({ bar_time: -1 })
            .limit(fetchLimit);
        const seenTimes = new Set();
        const uniqueBars = [];
        for (const b of dbBars) {
            const timeMs = new Date(b.bar_time).getTime();
            if (!seenTimes.has(timeMs)) {
                seenTimes.add(timeMs);
                uniqueBars.push(b);
            }
            if (uniqueBars.length >= fetchLimit) {
                break;
            }
        }
        bars = uniqueBars.reverse().map((b) => ({
            symbol: b.symbol,
            timeframe: b.timeframe,
            open: b.bar_open,
            high: b.bar_high,
            low: b.bar_low,
            close: b.bar_close,
            openTime: new Date(b.bar_time).getTime(),
            volume: b.volume
        }));
    }
    catch (error) {
        console.error("[OHLC] MongoDB error, trying in-memory finalized cache:", error);
    }
    // Step 2: Fall back to in-memory finalized candle cache if MongoDB returned nothing
    if (bars.length === 0) {
        const cached = (0, ohlcAggregator_1.getCachedOHLCBars)(symbol, tf, fetchLimit);
        if (cached.length > 0) {
            console.log(`[OHLC] MongoDB empty for ${symbol}/${tf} — serving ${cached.length} in-memory finalized bars.`);
            bars = cached;
        }
    }
    // Step 3: Include the active (currently building) candle as the most recent data point.
    // This ensures the matrix populates even when no candle has closed yet in this session.
    const activeCandle = (0, ohlcAggregator_1.getActiveCandle)(symbol, tf);
    if (activeCandle) {
        if (bars.length === 0) {
            console.log(`[OHLC] No finalized bars for ${symbol}/${tf} — seeding with active candle (ltp=${activeCandle.close}).`);
            bars = [activeCandle];
        }
        else if (activeCandle.openTime > bars[bars.length - 1].openTime) {
            bars = [...bars, activeCandle];
        }
    }
    if (bars.length === 0) {
        console.warn(`[OHLC] No data at all for ${symbol}/${tf} — live feed may not have started yet.`);
    }
    return res.status(200).json(bars);
};
exports.getOHLCBars = getOHLCBars;
// Get up to `count` finalized candles strictly BEFORE today's session open —
// used only to seed indicator warm-up (e.g. EMA200) on connect, never for
// worksheet display. Ascending order (oldest first) so callers can prepend
// directly to today's series. Backed by the 45-day retention window in
// FuturesOHLCSchema.ts / ohlcAggregator.ts; on a fresh symbol or before that
// history has accumulated, this may return fewer than `count` bars — callers
// must treat the result as best-effort, not a guaranteed full window.
const getWarmupOHLCBars = async (req, res) => {
    const { symbol, tf } = req.params;
    const count = req.query.count ? parseInt(req.query.count) : 200;
    try {
        const sessionOpen = getTodaySessionOpenUTC();
        const dbBars = await FuturesOHLC_1.FuturesOHLC.find({ symbol, timeframe: tf, bar_time: { $lt: sessionOpen } })
            .sort({ bar_time: -1 })
            .limit(count);
        const bars = dbBars.reverse().map((b) => ({
            symbol: b.symbol,
            timeframe: b.timeframe,
            open: b.bar_open,
            high: b.bar_high,
            low: b.bar_low,
            close: b.bar_close,
            openTime: new Date(b.bar_time).getTime(),
            volume: b.volume,
        }));
        return res.status(200).json(bars);
    }
    catch (error) {
        console.error("[OHLC Warmup] Query error:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
};
exports.getWarmupOHLCBars = getWarmupOHLCBars;
// Get historical OHLC candles within a date/time range.
// Accepts either:
//   ?date=YYYY-MM-DD           — returns bars for that trading day (NSE market hours)
//   ?from=ISO&to=ISO           — returns bars between two arbitrary UTC datetimes
const getHistoricalOHLCBars = async (req, res) => {
    const { symbol, tf } = req.params;
    const { date, from, to } = req.query;
    let startUtc;
    let endUtc;
    if (from && to) {
        startUtc = new Date(from);
        endUtc = new Date(to);
        if (isNaN(startUtc.getTime()) || isNaN(endUtc.getTime())) {
            return res.status(400).json({ error: "Invalid from/to datetime — use ISO 8601 format" });
        }
        if (startUtc >= endUtc) {
            return res.status(400).json({ error: "from must be before to" });
        }
    }
    else if (date) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return res.status(400).json({ error: "date query param required in YYYY-MM-DD format" });
        }
        // NSE market window in UTC: 09:15 IST = 03:45 UTC, 15:30 IST = 10:00 UTC
        startUtc = new Date(`${date}T03:44:00.000Z`);
        endUtc = new Date(`${date}T10:01:00.000Z`);
    }
    else {
        return res.status(400).json({ error: "Provide either ?date=YYYY-MM-DD or ?from=ISO&to=ISO" });
    }
    try {
        const dbBars = await FuturesOHLC_1.FuturesOHLC.find({
            symbol,
            timeframe: tf,
            bar_time: { $gte: startUtc, $lte: endUtc },
        }).sort({ bar_time: 1 });
        const bars = dbBars.map((b) => ({
            symbol: b.symbol,
            timeframe: b.timeframe,
            open: b.bar_open,
            high: b.bar_high,
            low: b.bar_low,
            close: b.bar_close,
            openTime: new Date(b.bar_time).getTime(),
            volume: b.volume,
        }));
        return res.status(200).json(bars);
    }
    catch (error) {
        console.error("[Historical OHLC] Query error:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
};
exports.getHistoricalOHLCBars = getHistoricalOHLCBars;
// Get computed pivots (all 3 methods)
const getPivotLevelsEndpoint = async (req, res) => {
    try {
        const { symbol, tf } = req.params;
        const classic = await (0, pivotService_1.getPivotLevels)(symbol, tf, "classic");
        const camarilla = await (0, pivotService_1.getPivotLevels)(symbol, tf, "camarilla");
        const fibonacci = await (0, pivotService_1.getPivotLevels)(symbol, tf, "fibonacci");
        return res.status(200).json({
            symbol,
            timeframe: tf,
            classic,
            camarilla,
            fibonacci
        });
    }
    catch (error) {
        console.error("Get Pivot Levels Error:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
};
exports.getPivotLevelsEndpoint = getPivotLevelsEndpoint;
// Evaluate Indicators
const getIndicatorsEndpoint = async (req, res) => {
    try {
        const { symbol } = req.params;
        const timeframe = req.query.timeframe || "5m";
        const method = req.query.method || "classic";
        const indicators = await (0, pivotService_1.evaluateIndicators)(symbol, timeframe, method);
        if (!indicators) {
            return res.status(404).json({ error: "Failed to compute indicators. Make sure market feeds are running." });
        }
        return res.status(200).json(indicators);
    }
    catch (error) {
        console.error("Get Indicators Error:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
};
exports.getIndicatorsEndpoint = getIndicatorsEndpoint;
const getModule1LatestOi = async (_req, res) => {
    try {
        return res.status(200).json((0, module1OiService_1.getLatestModule1OiMetrics)());
    }
    catch (error) {
        console.error("Get Module1 Latest OI Error:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
};
exports.getModule1LatestOi = getModule1LatestOi;
// Generate options chain based on current NIFTY spot index
const getOptionChain = async (req, res) => {
    try {
        const { index } = req.params; // e.g., "NIFTY50"
        const rawSpot = await (0, redisWriteBuffer_1.readLive)("ltp:NIFTY-SPOT");
        const spot = rawSpot ? parseFloat(rawSpot) : 22100.0;
        // Standard strike step for NIFTY is 50 points
        const strikeStep = 50;
        const atmStrike = Math.round(spot / strikeStep) * strikeStep;
        const strikes = [];
        // Generate 5 ITM and 5 OTM strikes for both CE and PE
        for (let i = -5; i <= 5; i++) {
            const strikePrice = atmStrike + i * strikeStep;
            strikes.push({
                strikePrice,
                CE: `NIFTY${strikePrice}CE`,
                PE: `NIFTY${strikePrice}PE`
            });
        }
        return res.status(200).json({
            index,
            spotPrice: spot,
            atmStrike,
            strikes
        });
    }
    catch (error) {
        console.error("Get Option Chain Error:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
};
exports.getOptionChain = getOptionChain;
const MONTHS_TITLE = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// ── Module 1 dropdown discovery: Exchange → Instrument → Symbol → Expiry → Strike ──────────────
// Every endpoint below is a thin pass-through over instrumentTokenService's cachedRows (the
// broker's own instrument masters, downloaded once and cached — see instrumentTokenService.ts).
// Each level is filtered by the levels selected above it; none of them assume a particular
// exchange or instrument type.
// GET /module1/exchanges
// Every distinct exchange present in the live instrument masters Zebu has
// already provided — a straight pass-through of the broker's own `Exchange`
// column, nothing hardcoded or inferred. First selector in the chain.
const getModule1Exchanges = async (_req, res) => {
    try {
        const exchanges = await (0, instrumentTokenService_1.getAvailableExchanges)();
        return res.status(200).json({ exchanges });
    }
    catch (error) {
        console.error("Get Module1 Exchanges Error:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
};
exports.getModule1Exchanges = getModule1Exchanges;
// GET /module1/instruments?exchange=NSE
// Every distinct instrumentType (OPTIDX, FUTCOM, EQ, INDEX, ...) the broker has
// under the given exchange.
const getModule1Instruments = async (req, res) => {
    try {
        const exchange = String(req.query.exchange || "").trim();
        if (!exchange)
            return res.status(400).json({ error: "exchange query parameter is required" });
        const instruments = await (0, instrumentTokenService_1.getAvailableInstrumentTypes)(exchange);
        return res.status(200).json({ exchange: exchange.toUpperCase(), instruments });
    }
    catch (error) {
        console.error("Get Module1 Instruments Error:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
};
exports.getModule1Instruments = getModule1Instruments;
// GET /module1/symbols?exchange=NSE&instrument=EQ
// Every distinct symbol the broker has under the given exchange + instrument type.
const getModule1Symbols = async (req, res) => {
    try {
        const exchange = String(req.query.exchange || "").trim();
        const instrument = String(req.query.instrument || "").trim();
        if (!exchange || !instrument) {
            return res.status(400).json({ error: "exchange and instrument query parameters are required" });
        }
        const symbols = await (0, instrumentTokenService_1.getAvailableSymbols)(exchange, instrument);
        return res.status(200).json({ exchange: exchange.toUpperCase(), instrument: instrument.toUpperCase(), symbols });
    }
    catch (error) {
        console.error("Get Module1 Symbols Error:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
};
exports.getModule1Symbols = getModule1Symbols;
// GET /module1/expiries?exchange=NFO&instrument=OPTIDX&symbol=NIFTY
// Real expiry dates from the live instrument master — not a synthetic
// count-limited generator. Every active expiry, ascending, for the given
// exchange + instrument type + symbol. Naturally empty for cash instruments
// (e.g. NSE EQ/INDEX) since those rows carry no expiry.
const getModule1Expiries = async (req, res) => {
    try {
        const exchange = String(req.query.exchange || "").trim();
        const instrument = String(req.query.instrument || "").trim();
        const symbol = String(req.query.symbol || "").trim();
        if (!exchange || !instrument || !symbol) {
            return res.status(400).json({ error: "exchange, instrument and symbol query parameters are required" });
        }
        const isoDates = await (0, instrumentTokenService_1.getAvailableExpiries)(exchange, instrument, symbol);
        const expiries = isoDates.map((iso) => {
            const d = new Date(`${iso}T00:00:00.000Z`);
            const expiry = `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS_TITLE[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
            return { id: iso, expiry };
        });
        return res.status(200).json({
            exchange: exchange.toUpperCase(), instrument: instrument.toUpperCase(), symbol: symbol.toUpperCase(),
            expiries,
        });
    }
    catch (error) {
        console.error("Get Module1 Expiries Error:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
};
exports.getModule1Expiries = getModule1Expiries;
// GET /module1/strikes?exchange=NFO&instrument=OPTIDX&symbol=NIFTY&expiryId=2026-07-30
// Real strike prices for the given exchange + instrument type + symbol + expiry
// (ISO YYYY-MM-DD) from the live instrument master — full chain, no ATM-band limiting.
const getModule1Strikes = async (req, res) => {
    try {
        const exchange = String(req.query.exchange || "").trim();
        const instrument = String(req.query.instrument || "").trim();
        const symbol = String(req.query.symbol || "").trim();
        const expiryId = String(req.query.expiryId || "").trim();
        if (!exchange || !instrument || !symbol || !expiryId) {
            return res.status(400).json({ error: "exchange, instrument, symbol and expiryId query parameters are required" });
        }
        const values = await (0, instrumentTokenService_1.getAvailableStrikes)(exchange, instrument, symbol, expiryId);
        const strikes = values.map((value) => ({ value }));
        return res.status(200).json({
            exchange: exchange.toUpperCase(), instrument: instrument.toUpperCase(), symbol: symbol.toUpperCase(), expiryId,
            strikes,
        });
    }
    catch (error) {
        console.error("Get Module1 Strikes Error:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
};
exports.getModule1Strikes = getModule1Strikes;
// Update custom timeframe config
const updateCustomTimeframe = async (req, res) => {
    try {
        const { timeframe } = req.body; // e.g. "10m"
        if (!timeframe || typeof timeframe !== "string" || !timeframe.endsWith("m")) {
            return res.status(400).json({ error: "Invalid timeframe format. Expected e.g. '10m'" });
        }
        const minutes = parseInt(timeframe);
        if (isNaN(minutes) || minutes <= 0) {
            return res.status(400).json({ error: "Invalid timeframe duration" });
        }
        // Save custom timeframe: Redis for durability across restarts (user config,
        // not market data — no TTL), and the in-process mirror so the aggregator's
        // reads are memory-hits.
        await redis_1.default.set("config:custom_timeframe", timeframe);
        (0, redisWriteBuffer_1.bufferSet)("config:custom_timeframe", timeframe);
        // Clear old custom timeframe database records so they restart cleanly
        try {
            await FuturesOHLC_1.FuturesOHLC.deleteMany({ timeframe });
            console.log(`[Market] Cleared old OHLC bars for custom timeframe: ${timeframe}`);
        }
        catch (dbErr) {
            // ignore db errors in offline mode
        }
        return res.status(200).json({
            message: "Custom timeframe updated successfully",
            timeframe,
            minutes
        });
    }
    catch (error) {
        console.error("Update Custom Timeframe Error:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
};
exports.updateCustomTimeframe = updateCustomTimeframe;
/**
 * Helper to check if the current time falls within Indian Standard Time (IST) market hours:
 * Monday to Friday, 9:00 AM to 3:45 PM IST.
 */
const isMarketOpenTime = (now = new Date()) => {
    const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Kolkata",
        hour12: false,
        weekday: "long",
        hour: "numeric",
        minute: "numeric",
    });
    const parts = formatter.formatToParts(now);
    const partMap = {};
    for (const part of parts) {
        partMap[part.type] = part.value;
    }
    const weekday = partMap.weekday;
    const hour = parseInt(partMap.hour, 10);
    const minute = parseInt(partMap.minute, 10);
    if (weekday === "Saturday" || weekday === "Sunday") {
        return false;
    }
    const minutesSinceMidnight = hour * 60 + minute;
    const marketOpenMinutes = 9 * 60; // 9:00 AM
    const marketCloseMinutes = 15 * 60 + 45; // 3:45 PM
    return minutesSinceMidnight >= marketOpenMinutes && minutesSinceMidnight <= marketCloseMinutes;
};
exports.isMarketOpenTime = isMarketOpenTime;
// Get current live market connection status
const getMarketStatus = async (req, res) => {
    try {
        // Market open/closed is a time-based check (IST 9:00 AM – 3:45 PM, Mon–Fri).
        // Broker connection is reported separately via /api/module/status.
        const isOpen = (0, exports.isMarketOpenTime)();
        return res.status(200).json({
            status: isOpen ? "LIVE" : "CLOSED",
            zebuConnected: (0, zebuMarketDataClient_1.isZebuLiveConnected)(),
        });
    }
    catch (error) {
        console.error("Get Market Status Error:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
};
exports.getMarketStatus = getMarketStatus;
// Get connection statuses for both Module 1 (Zebu) and Module 2 (Aetram)
const getModuleStatus = async (req, res) => {
    try {
        const m1Connected = (0, zebuMarketDataClient_1.isZebuLiveConnected)();
        const m2Status = (0, aetramMarketDataService_1.isAetramConnected)();
        return res.status(200).json({
            module1: m1Connected ? "CONNECTED" : "DISCONNECTED",
            module2: m2Status,
        });
    }
    catch (error) {
        console.error("Get Module Status Error:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
};
exports.getModuleStatus = getModuleStatus;
