"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initAetramMarketDataService = exports.loginToAetramWithCredentials = exports.getAetramExpiryDates = exports.subscribeToInstruments = exports.resolveOptionStrikeToken = exports.searchInstruments = exports.loginToAetram = exports.isAetramConnected = exports.clearAetramSession = exports.setOnAetramReconnect = void 0;
const axios_1 = __importDefault(require("axios"));
const redisWriteBuffer_1 = require("./redisWriteBuffer");
const socketService_1 = require("./socketService");
const marketDataSessionService_1 = require("./marketDataSessionService");
const marketDataWebSocketService_1 = require("./marketDataWebSocketService");
const marketDataEvents_1 = require("./marketDataEvents");
const marketDataPipelineService_1 = require("./marketDataPipelineService");
const monitoringService_1 = require("./monitoringService");
// Session state (token, userID, expiry) lives in marketDataSessionService.
// The socket connection itself lives ONLY in marketDataWebSocketService
// (Phase 6 consolidation) — this service is a pure consumer of it: it
// registers tick handlers via onRawSocketEvent and reacts to connection
// lifecycle via marketDataEvents. It never creates, destroys, or reconnects
// a socket itself.
let _onReconnectFn = null;
const setOnAetramReconnect = (fn) => {
    _onReconnectFn = fn;
};
exports.setOnAetramReconnect = setOnAetramReconnect;
const clearAetramSession = () => {
    (0, marketDataSessionService_1.markMarketDataSessionExpired)();
    // The session backing the shared socket is gone — tear the connection down
    // too rather than leaving a socket open with a now-invalid token.
    (0, marketDataWebSocketService_1.disconnect)();
};
exports.clearAetramSession = clearAetramSession;
const isAetramConnected = () => {
    const apiKey = getApiKey();
    const apiSecret = getApiSecret();
    const authUrl = getAuthUrl();
    const baseUrl = getBaseUrl();
    if (isPlaceholder(apiKey) || isPlaceholder(apiSecret) || !authUrl || !baseUrl) {
        return "WAITING_FOR_CONFIGURATION";
    }
    if ((0, marketDataSessionService_1.isMarketDataAuthenticated)() && (0, marketDataWebSocketService_1.getStatus)().state === "CONNECTED") {
        return "CONNECTED";
    }
    return "ERROR";
};
exports.isAetramConnected = isAetramConnected;
// Caches for symbol mapping
const symbolToTokenMap = new Map();
const tokenToSymbolMap = new Map(); // key is `segment|token` or just `token`
const isPlaceholder = (value) => !value || value.includes("your-") || value.includes("placeholder");
const getApiKey = () => (process.env.MOD2_API_KEY || "").trim();
const getApiSecret = () => (process.env.MOD2_API_SECRET || "").trim();
const getBaseUrl = () => (process.env.AETRAM_MARKETDATA_API_BASE_URL || "").trim();
const getAuthUrl = () => (process.env.AETRAM_MARKETDATA_AUTH_URL || "").trim();
const parseDateToYMD = (val) => {
    const d = new Date(val);
    if (isNaN(d.getTime()))
        return "";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
};
/**
 * Standard HTTP headers for Aetram requests
 */
const getHeaders = () => {
    const token = (0, marketDataSessionService_1.getMarketDataToken)();
    if (!token)
        return { "Content-Type": "application/json" };
    return {
        "Content-Type": "application/json",
        "authorization": token,
    };
};
/**
 * Perform login to Aetram MarketData API using configured env credentials
 */
const loginToAetram = async () => {
    const apiKey = getApiKey();
    const apiSecret = getApiSecret();
    if (isPlaceholder(apiKey) || isPlaceholder(apiSecret)) {
        console.warn("[AetramMD] Missing or placeholder credentials in env. Skipping Aetram live login.");
        return false;
    }
    const result = await (0, marketDataSessionService_1.loginMarketData)();
    return result.ok;
};
exports.loginToAetram = loginToAetram;
/**
 * Raw instrument search against Aetram's /search/instruments endpoint.
 * Extracted from resolveOptionStrikeToken (Phase 3) so the Instrument Discovery
 * layer can reuse the exact same search call instead of re-implementing it.
 */
const searchInstruments = async (searchString) => {
    const baseUrl = getBaseUrl();
    if (!baseUrl || !(0, marketDataSessionService_1.getMarketDataToken)())
        return [];
    try {
        const searchUrl = `${baseUrl}/search/instruments?searchString=${encodeURIComponent(searchString)}`;
        const response = await axios_1.default.get(searchUrl, { headers: getHeaders(), timeout: 10000 });
        // "type" is the success/failure discriminant per the XTS response envelope
        // (code carries a granular id like "s-response-0001", never "success").
        if (response.data?.type !== "success" || !Array.isArray(response.data.result))
            return [];
        return response.data.result.map((inst) => ({
            exchangeSegment: Number(inst.ExchangeSegment ?? inst.exchangeSegment ?? 2),
            exchangeInstrumentID: String(inst.ExchangeInstrumentID ?? inst.exchangeInstrumentID ?? ""),
            name: String(inst.Name ?? inst.name ?? inst.symbol ?? ""),
            tradingSymbol: String(inst.TradingSymbol ?? inst.tradingSymbol ?? inst.DisplayName ?? inst.displayName ?? ""),
            series: String(inst.Series ?? inst.series ?? ""),
            instrumentType: String(inst.InstrumentType ?? inst.instrumentType ?? inst.Series ?? inst.series ?? ""),
            expiryDate: inst.ContractExpiration || inst.contractExpiration || inst.ExpiryDate || inst.expiryDate || inst.Expiry || inst.expiry || undefined,
            strikePrice: inst.StrikePrice !== undefined ? Number(inst.StrikePrice)
                : inst.strikePrice !== undefined ? Number(inst.strikePrice)
                    : inst.Strike !== undefined ? Number(inst.Strike)
                        : inst.strike !== undefined ? Number(inst.strike) : undefined,
            optionType: inst.OptionType || inst.optionType || inst.Type || inst.type || undefined,
        }));
    }
    catch (error) {
        if (error?.response?.status === 401) {
            console.warn("[AetramMD] Session expired (401) during instrument search.");
            (0, exports.clearAetramSession)();
            (0, socketService_1.broadcastBrokerStatus)("session-expired", "Broker session expired. Please login again.", "module2");
        }
        else {
            console.error(`[AetramMD] Instrument search error for "${searchString}":`, error?.message || error);
        }
        return [];
    }
};
exports.searchInstruments = searchInstruments;
/**
 * Search and resolve an option strike symbol to its instrument token
 */
const resolveOptionStrikeToken = async (index, expiryDate, strikeSymbol) => {
    // If already in cache, return it
    if (symbolToTokenMap.has(strikeSymbol)) {
        return symbolToTokenMap.get(strikeSymbol);
    }
    if (!getBaseUrl() || !(0, marketDataSessionService_1.getMarketDataToken)())
        return null;
    // Extract strike price and option type from strikeSymbol (e.g. "NIFTY22100CE")
    const match = strikeSymbol.match(/(\d+)(CE|PE)$/);
    if (!match)
        return null;
    const strikePrice = Number(match[1]);
    const optionType = match[2].toUpperCase(); // CE or PE
    const indexShort = index.replace("50", "").replace("fifty", "").toUpperCase(); // e.g. "NIFTY"
    const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    const d = new Date(expiryDate);
    const dd = String(d.getDate()).padStart(2, "0");
    const mmm = months[d.getMonth()];
    const yyyy = d.getFullYear();
    const displayExpiry = `${dd}${mmm}${yyyy}`;
    const searchString = `${indexShort} ${displayExpiry} ${optionType} ${strikePrice}`;
    console.log(`[AetramMD] searchString: '${searchString}'`);
    const results = await (0, exports.searchInstruments)(searchString);
    const targetYmd = parseDateToYMD(expiryDate);
    // Filter list in-memory for the closest match
    for (const inst of results) {
        const rawExpiry = inst.expiryDate || "";
        const instExpiryYmd = parseDateToYMD(rawExpiry);
        const instStrike = Math.round(Number(inst.strikePrice ?? 0));
        const instOptType = String(inst.optionType || "").toUpperCase();
        // In XTS, OptionType 3 = CE, 4 = PE
        const isOptCE = instOptType.startsWith("C") || instOptType.includes("CE") || instOptType === "3";
        const targetCE = optionType.startsWith("C");
        if (instExpiryYmd === targetYmd &&
            instStrike === strikePrice &&
            isOptCE === targetCE) {
            const segment = inst.exchangeSegment;
            const token = inst.exchangeInstrumentID;
            const result = { segment, token };
            symbolToTokenMap.set(strikeSymbol, result);
            tokenToSymbolMap.set(`${segment}|${token}`, strikeSymbol);
            tokenToSymbolMap.set(token, strikeSymbol); // Fallback lookup mapping
            console.log(`[AetramMD] Resolved ${strikeSymbol} to Token: ${token} (Seg: ${segment})`);
            return result;
        }
    }
    console.warn(`[AetramMD] Could not find matching Aetram instrument for strike ${strikeSymbol} (${expiryDate})`);
    return null;
};
exports.resolveOptionStrikeToken = resolveOptionStrikeToken;
/**
 * Subscribe to LTP & OI updates for resolved instruments
 */
const subscribeToInstruments = async (instruments) => {
    const baseUrl = getBaseUrl();
    if (!baseUrl || !(0, marketDataSessionService_1.getMarketDataToken)() || instruments.length === 0)
        return;
    try {
        const payload = {
            instruments: instruments.map((inst) => ({
                exchangeSegment: inst.segment,
                exchangeInstrumentID: Number(inst.token),
            })),
            xtsMessageCode: 1512, // LTP updates
        };
        const payloadOI = {
            ...payload,
            xtsMessageCode: 1510, // OI updates
        };
        console.log(`[AetramMD] Subscribing to LTP/OI for ${instruments.length} instruments...`);
        await axios_1.default.post(`${baseUrl}/instruments/subscription`, payload, { headers: getHeaders(), timeout: 10000 });
        await axios_1.default.post(`${baseUrl}/instruments/subscription`, payloadOI, { headers: getHeaders(), timeout: 10000 });
    }
    catch (error) {
        if (error?.response?.status === 401) {
            console.warn("[AetramMD] Session expired (401) during subscription.");
            (0, exports.clearAetramSession)();
            (0, socketService_1.broadcastBrokerStatus)("session-expired", "Broker session expired. Please login again.", "module2");
        }
        else {
            console.error("[AetramMD] Subscription request failed:", error?.message || error);
        }
    }
};
exports.subscribeToInstruments = subscribeToInstruments;
/**
 * Persists normalized LTP/OI events to the in-process live store (Module 2's
 * tracker reads these via readLive — same process, zero Redis commands).
 * Previously each tick issued a direct Redis SET; per-tick REST calls were a
 * major contributor to the monthly command quota blowout.
 *
 * This is business logic (what to do with a tick), kept separate from
 * transport/decoding — see marketDataPipelineService.ts (Phase 7), which
 * decodes the raw packet and publishes LTP_UPDATED/OI_UPDATED. This service
 * only reacts to those normalized events; it no longer parses raw packets.
 */
marketDataEvents_1.marketDataEvents.on("MARKET_DATA", (event) => {
    (0, monitoringService_1.recordTickReceived)("module2");
});
marketDataEvents_1.marketDataEvents.on("LTP_UPDATED", (event) => {
    if (!event.exchangeInstrumentID || event.lastPrice === null)
        return;
    const symbol = tokenToSymbolMap.get(event.exchangeInstrumentID);
    if (symbol)
        (0, redisWriteBuffer_1.bufferSet)(`ltp:${symbol}`, String(event.lastPrice));
});
marketDataEvents_1.marketDataEvents.on("OI_UPDATED", (event) => {
    if (!event.exchangeInstrumentID || event.openInterest === null)
        return;
    const symbol = tokenToSymbolMap.get(event.exchangeInstrumentID);
    if (symbol)
        (0, redisWriteBuffer_1.bufferSet)(`oi:${symbol}`, String(event.openInterest));
});
/**
 * WebSocket lifecycle wiring (Phase 6 consolidation).
 *
 * marketDataWebSocketService is the ONLY owner of the socket. This service
 * only registers what it needs on top of that shared connection:
 *   - raw packet routing into the Phase 7 pipeline, re-attached to every
 *     socket instance the manager creates (including across reconnects) via
 *     onRawSocketEvent
 *   - a reaction to CONNECTED/RECONNECTED/DISCONNECTED lifecycle events to
 *     preserve the exact same business behavior the old inline socket
 *     handlers had (frontend broker-status broadcast + the tracker resync
 *     callback), without owning the socket itself.
 *
 * "-json-full"/"-json-partial" are Aetram/XTS's own event-name suffixes for a
 * full snapshot vs. an incremental update of the same message code; both route
 * to the same decoder since the pipeline normalizes either shape identically.
 * 1501/1502 are wired defensively even though nothing currently requests those
 * message codes via subscribeToInstruments — the pipeline is meant to be
 * reusable for whatever future subsystems start requesting them.
 */
const routeToPipeline = (packetType) => (raw) => (0, marketDataPipelineService_1.processRawPacket)(packetType, raw);
(0, marketDataWebSocketService_1.onRawSocketEvent)("1512-json-full", routeToPipeline("1512"));
(0, marketDataWebSocketService_1.onRawSocketEvent)("1512-json-partial", routeToPipeline("1512"));
(0, marketDataWebSocketService_1.onRawSocketEvent)("1510-json-full", routeToPipeline("1510"));
(0, marketDataWebSocketService_1.onRawSocketEvent)("1510-json-partial", routeToPipeline("1510"));
(0, marketDataWebSocketService_1.onRawSocketEvent)("1501-json-full", routeToPipeline("1501"));
(0, marketDataWebSocketService_1.onRawSocketEvent)("1501-json-partial", routeToPipeline("1501"));
(0, marketDataWebSocketService_1.onRawSocketEvent)("1502-json-full", routeToPipeline("1502"));
(0, marketDataWebSocketService_1.onRawSocketEvent)("1502-json-partial", routeToPipeline("1502"));
const triggerReconnectCallback = () => {
    if (_onReconnectFn) {
        _onReconnectFn().catch((err) => {
            console.error("[AetramMD] Reconnect callback error:", err?.message || err);
        });
    }
};
marketDataEvents_1.marketDataEvents.on("CONNECTED", () => {
    console.log("[AetramMD] Socket connected.");
    (0, socketService_1.broadcastBrokerStatus)("live", undefined, "module2");
    triggerReconnectCallback();
});
marketDataEvents_1.marketDataEvents.on("RECONNECTED", () => {
    console.log("[AetramMD] Socket reconnected.");
    (0, socketService_1.broadcastBrokerStatus)("live", undefined, "module2");
    triggerReconnectCallback();
});
marketDataEvents_1.marketDataEvents.on("DISCONNECTED", ({ reason, manual }) => {
    console.warn(`[AetramMD] Socket disconnected: ${reason}`);
    if (!manual) {
        (0, socketService_1.broadcastBrokerStatus)("broker-disconnected", "Lost connection to broker. Reconnecting...", "module2");
    }
});
/**
 * Compute the next N upcoming Thursdays (NSE weekly expiry pattern, last resort fallback)
 */
const computeUpcomingThursdays = (count) => {
    const result = [];
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    const dayOfWeek = d.getDay();
    const daysToThursday = (4 - dayOfWeek + 7) % 7;
    d.setDate(d.getDate() + daysToThursday);
    for (let i = 0; i < count; i++) {
        result.push(parseDateToYMD(new Date(d)));
        d.setDate(d.getDate() + 7);
    }
    return result;
};
/**
 * Fetch available expiry dates for options on the given index.
 * Priority: Aetram API → MOD2_EXPIRY_DATES env → computed Thursdays
 *
 * `exchangeSegment` defaults to 2 (NSEFO) to preserve existing NIFTY/BANKNIFTY/
 * FINNIFTY behavior. Pass 12 (BSEFO) for SENSEX — the only supported BSE index.
 */
const getAetramExpiryDates = async (indexSymbol, exchangeSegment = 2) => {
    const baseUrl = getBaseUrl();
    if (baseUrl && (0, marketDataSessionService_1.getMarketDataToken)()) {
        try {
            const name = indexSymbol.replace(/50$/i, "").replace(/FIFTY$/i, "").toUpperCase();
            // Aetram's Market Data API returns 404 for /instruments/expiry.
            // Instead, we fetch the instruments for the index and extract the unique expiries.
            const results = await (0, exports.searchInstruments)(name);
            const uniqueExpiries = new Set();
            for (const inst of results) {
                // Only look at options (OptionType 3 = CE, 4 = PE, or strings like "CE"/"PE")
                const optType = String(inst.optionType || "");
                if (!optType || (optType !== "3" && optType !== "4" && !optType.toUpperCase().includes("E"))) {
                    continue;
                }
                const expiry = inst.expiryDate || "";
                const expiryDateObj = new Date(expiry);
                if (!isNaN(expiryDateObj.getTime())) {
                    uniqueExpiries.add(expiryDateObj.toISOString().slice(0, 10));
                }
            }
            if (uniqueExpiries.size > 0) {
                return Array.from(uniqueExpiries).sort();
            }
        }
        catch (e) {
            console.warn(`[AetramMD] Failed to fetch real expiries for ${indexSymbol}: ${e.message}. Falling back.`);
        }
    }
    const configDates = (process.env.MOD2_EXPIRY_DATES || "").trim();
    if (configDates) {
        return configDates.split(",").map((d) => d.trim()).filter(Boolean).sort();
    }
    return computeUpcomingThursdays(5);
};
exports.getAetramExpiryDates = getAetramExpiryDates;
/**
 * Login using credentials provided at runtime by the user.
 * Called by module2BrokerLogin controller — never called on server startup.
 */
const loginToAetramWithCredentials = async (appKey, secretKey) => {
    return await (0, marketDataSessionService_1.loginMarketData)(appKey, secretKey);
};
exports.loginToAetramWithCredentials = loginToAetramWithCredentials;
/**
 * Legacy env-based startup — NOT called anymore. Kept for reference only.
 */
const initAetramMarketDataService = async () => {
    // Removed from startup. Module 2 connects only after user broker login.
    console.log("[AetramMD] initAetramMarketDataService: deferred — awaiting user login.");
};
exports.initAetramMarketDataService = initAetramMarketDataService;
