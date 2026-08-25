"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initAetramMarketDataService = exports.loginToAetramWithCredentials = exports.getAetramExpiryDates = exports.unsubscribeFromInstruments = exports.subscribeToInstruments = exports.getActiveSubscribedInstruments = exports.resolveOptionStrikeToken = exports.searchInstruments = exports.loginToAetram = exports.parseDateToYMD = exports.isAetramConnected = exports.clearAetramSession = exports.setOnAetramReconnect = void 0;
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
    if (!val)
        return "";
    if (typeof val === "string") {
        const isoMatch = val.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (isoMatch) {
            return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
        }
    }
    const d = new Date(val);
    if (isNaN(d.getTime()))
        return "";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
};
exports.parseDateToYMD = parseDateToYMD;
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
const searchCache = new Map();
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const searchInstruments = async (searchString) => {
    const cacheKey = searchString.trim().toUpperCase();
    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < SEARCH_CACHE_TTL_MS) {
        return cached.data;
    }
    const baseUrl = getBaseUrl();
    if (!baseUrl)
        return [];
    // Ensure authenticated session
    if (!(0, marketDataSessionService_1.getMarketDataToken)()) {
        await (0, exports.loginToAetram)();
    }
    if (!(0, marketDataSessionService_1.getMarketDataToken)())
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
/**
 * Search and resolve an option strike symbol to its instrument token
 */
const resolveOptionStrikeToken = async (index, expiryDate, strikeSymbol) => {
    // If already in cache, return it
    if (symbolToTokenMap.has(strikeSymbol)) {
        const cached = symbolToTokenMap.get(strikeSymbol);
        console.log(`[INSTRUMENT][RESOLVED] symbol=${strikeSymbol} segment=${cached.segment} token=${cached.token} (cached)`);
        return cached;
    }
    // Auto-login check if not authenticated
    if (!(0, marketDataSessionService_1.getMarketDataToken)()) {
        console.log("[AetramMD] Market Data token missing. Attempting auto-login...");
        const loggedIn = await (0, exports.loginToAetram)();
        if (!loggedIn || !(0, marketDataSessionService_1.getMarketDataToken)()) {
            console.warn(`[INSTRUMENT][FAILED] symbol=${strikeSymbol} reason=Not authenticated to Aetram Market Data API`);
            return null;
        }
    }
    // Extract strike price and option type from strikeSymbol (e.g. "NIFTY22100CE")
    const match = strikeSymbol.match(/(\d+)(CE|PE)$/);
    if (!match) {
        console.warn(`[INSTRUMENT][FAILED] symbol=${strikeSymbol} reason=Invalid strike symbol format`);
        return null;
    }
    const strikePrice = Number(match[1]);
    const optionType = match[2].toUpperCase(); // CE or PE
    const indexShort = index.replace("50", "").replace("fifty", "").toUpperCase(); // e.g. "NIFTY"
    // Search by "NIFTY 22000" first, fallback to "NIFTY"
    const primarySearch = `${indexShort} ${strikePrice}`;
    console.log(`[AetramMD] Searching Aetram instruments with query: '${primarySearch}'`);
    let results = await (0, exports.searchInstruments)(primarySearch);
    if (results.length === 0) {
        console.log(`[AetramMD] Search '${primarySearch}' yielded 0 results. Trying index query: '${indexShort}'`);
        results = await (0, exports.searchInstruments)(indexShort);
    }
    if (results.length === 0) {
        console.warn(`[INSTRUMENT][FAILED] symbol=${strikeSymbol} reason=No instruments returned from Aetram search query`);
        return null;
    }
    const targetYmd = (0, exports.parseDateToYMD)(expiryDate);
    const candidateMatches = [];
    for (const inst of results) {
        const rawExpiry = inst.expiryDate || "";
        const instExpiryYmd = (0, exports.parseDateToYMD)(rawExpiry);
        const instStrike = Math.round(Number(inst.strikePrice ?? 0));
        const instOptType = String(inst.optionType || "").toUpperCase();
        // In XTS, OptionType 3 = CE, 4 = PE (or string "CE"/"PE")
        const isOptCE = instOptType === "3" || instOptType.includes("CE") || instOptType.includes("CALL");
        const isOptPE = instOptType === "4" || instOptType.includes("PE") || instOptType.includes("PUT");
        const isTargetCE = optionType === "CE";
        const optTypeMatches = isTargetCE ? isOptCE : isOptPE;
        if (instStrike === strikePrice && optTypeMatches) {
            candidateMatches.push({ inst, ymd: instExpiryYmd });
        }
    }
    if (candidateMatches.length === 0) {
        console.warn(`[INSTRUMENT][FAILED] symbol=${strikeSymbol} reason=No matching strike ${strikePrice} ${optionType} found in search results (${results.length} records scanned)`);
        return null;
    }
    // 1. Try exact expiry match first
    let matchInst = candidateMatches.find(c => c.ymd === targetYmd);
    if (!matchInst) {
        const availableExpiries = Array.from(new Set(candidateMatches.map(c => c.ymd).filter(Boolean))).sort();
        console.log(`[INSTRUMENT][EXPIRY] Requested: ${targetYmd}, Available: ${availableExpiries.join(", ")}`);
        // Select closest available expiry
        matchInst = candidateMatches.sort((a, b) => {
            const diffA = Math.abs(new Date(a.ymd).getTime() - new Date(targetYmd).getTime());
            const diffB = Math.abs(new Date(b.ymd).getTime() - new Date(targetYmd).getTime());
            return diffA - diffB;
        })[0];
        if (matchInst) {
            console.log(`[INSTRUMENT][EXPIRY] Matched nearest available expiry: ${matchInst.ymd} for requested ${targetYmd}`);
        }
    }
    if (matchInst) {
        const inst = matchInst.inst;
        const segment = inst.exchangeSegment;
        const token = inst.exchangeInstrumentID;
        const result = { segment, token };
        symbolToTokenMap.set(strikeSymbol, result);
        tokenToSymbolMap.set(`${segment}|${token}`, strikeSymbol);
        tokenToSymbolMap.set(token, strikeSymbol);
        console.log(`[INSTRUMENT][RESOLVED] symbol=${strikeSymbol} segment=${segment} token=${token} expiry=${matchInst.ymd} strike=${strikePrice} optionType=${optionType}`);
        return result;
    }
    console.warn(`[INSTRUMENT][FAILED] symbol=${strikeSymbol} reason=No valid contract expiry matched`);
    return null;
};
exports.resolveOptionStrikeToken = resolveOptionStrikeToken;
const activeSubscribedMap = new Map();
const getActiveSubscribedInstruments = () => {
    return Array.from(activeSubscribedMap.values());
};
exports.getActiveSubscribedInstruments = getActiveSubscribedInstruments;
/**
 * Subscribe to LTP & OI updates for resolved instruments (deduplicated)
 */
const subscribeToInstruments = async (instruments) => {
    const baseUrl = getBaseUrl();
    if (!(0, marketDataSessionService_1.getMarketDataToken)()) {
        await (0, exports.loginToAetram)();
    }
    if (!baseUrl || !(0, marketDataSessionService_1.getMarketDataToken)() || instruments.length === 0) {
        console.warn("[AetramMD] Cannot subscribe — unauthenticated or empty instrument list.");
        return;
    }
    // Deduplicate instruments by segment|token to avoid XTS HTTP 400 Bad Request
    const uniqueMap = new Map();
    for (const inst of instruments) {
        if (inst && inst.token) {
            const key = `${inst.segment}|${inst.token}`;
            if (!uniqueMap.has(key)) {
                uniqueMap.set(key, inst);
            }
        }
    }
    const uniqueInstruments = Array.from(uniqueMap.values());
    console.log(`[AETRAM][SUBSCRIBE] requested=${instruments.length} unique=${uniqueInstruments.length}`);
    try {
        const payload = {
            instruments: uniqueInstruments.map((inst) => ({
                exchangeSegment: inst.segment,
                exchangeInstrumentID: Number(inst.token),
            })),
            xtsMessageCode: 1512, // LTP updates
        };
        const payloadOI = {
            ...payload,
            xtsMessageCode: 1510, // OI updates
        };
        console.log(`[AETRAM][SUBSCRIBE][REQUEST] count=${uniqueInstruments.length}`);
        const respLTP = await axios_1.default.post(`${baseUrl}/instruments/subscription`, payload, { headers: getHeaders(), timeout: 10000 });
        const respOI = await axios_1.default.post(`${baseUrl}/instruments/subscription`, payloadOI, { headers: getHeaders(), timeout: 10000 });
        if (respLTP.data?.type === "success" || respLTP.status === 200) {
            for (const inst of uniqueInstruments) {
                activeSubscribedMap.set(`${inst.segment}|${inst.token}`, inst);
            }
            console.log(`[AETRAM][SUBSCRIBE][SUCCESS] count=${uniqueInstruments.length}`);
        }
        else {
            console.warn(`[AETRAM][SUBSCRIBE][WARNING] LTP response:`, JSON.stringify(respLTP.data));
        }
    }
    catch (error) {
        const status = error?.response?.status;
        const respBody = error?.response?.data;
        console.error(`[AETRAM][SUBSCRIBE][FAILED] status=${status || 'N/A'} response=${JSON.stringify(respBody || error?.message || error)}`);
        if (status === 401) {
            console.warn("[AetramMD] Session expired (401) during subscription.");
            (0, exports.clearAetramSession)();
            (0, socketService_1.broadcastBrokerStatus)("session-expired", "Broker session expired. Please login again.", "module2");
        }
    }
};
exports.subscribeToInstruments = subscribeToInstruments;
/**
 * Unsubscribe from LTP & OI updates for instruments no longer required by any active session
 */
const unsubscribeFromInstruments = async (instruments) => {
    const baseUrl = getBaseUrl();
    if (!baseUrl || !(0, marketDataSessionService_1.getMarketDataToken)() || instruments.length === 0)
        return;
    const uniqueMap = new Map();
    for (const inst of instruments) {
        if (inst && inst.token) {
            const key = `${inst.segment}|${inst.token}`;
            uniqueMap.set(key, inst);
        }
    }
    const uniqueInstruments = Array.from(uniqueMap.values());
    console.log(`[AETRAM][UNSUBSCRIBE] requested=${instruments.length} unique=${uniqueInstruments.length}`);
    try {
        const payload = {
            instruments: uniqueInstruments.map((inst) => ({
                exchangeSegment: inst.segment,
                exchangeInstrumentID: Number(inst.token),
            })),
            xtsMessageCode: 1512,
        };
        const payloadOI = { ...payload, xtsMessageCode: 1510 };
        await axios_1.default.put(`${baseUrl}/instruments/subscription`, payload, { headers: getHeaders(), timeout: 10000 }).catch(() => { });
        await axios_1.default.put(`${baseUrl}/instruments/subscription`, payloadOI, { headers: getHeaders(), timeout: 10000 }).catch(() => { });
        for (const inst of uniqueInstruments) {
            const key = `${inst.segment}|${inst.token}`;
            activeSubscribedMap.delete(key);
        }
        console.log(`[AETRAM][UNSUBSCRIBE][SUCCESS] count=${uniqueInstruments.length}`);
    }
    catch (error) {
        console.warn(`[AETRAM][UNSUBSCRIBE][FAILED]`, error?.message || error);
    }
};
exports.unsubscribeFromInstruments = unsubscribeFromInstruments;
const trackerService_1 = require("./trackerService");
marketDataEvents_1.marketDataEvents.on("MARKET_DATA", (event) => {
    (0, monitoringService_1.recordTickReceived)("module2");
});
marketDataEvents_1.marketDataEvents.on("LTP_UPDATED", (event) => {
    if (!event.exchangeInstrumentID || event.lastPrice === null)
        return;
    const symbol = (event.exchangeSegment ? tokenToSymbolMap.get(`${event.exchangeSegment}|${event.exchangeInstrumentID}`) : null) || tokenToSymbolMap.get(event.exchangeInstrumentID);
    if (symbol) {
        (0, redisWriteBuffer_1.bufferSet)(`ltp:${symbol}`, String(event.lastPrice));
        console.log(`[AETRAM][TICK] token=${event.exchangeInstrumentID} symbol=${symbol} ltp=${event.lastPrice}`);
        console.log(`[REDIS][LIVE] key=ltp:${symbol} value=${event.lastPrice}`);
        (0, trackerService_1.onLiveTickReceived)(symbol, event.lastPrice);
    }
});
marketDataEvents_1.marketDataEvents.on("OI_UPDATED", (event) => {
    if (!event.exchangeInstrumentID || event.openInterest === null)
        return;
    const symbol = (event.exchangeSegment ? tokenToSymbolMap.get(`${event.exchangeSegment}|${event.exchangeInstrumentID}`) : null) || tokenToSymbolMap.get(event.exchangeInstrumentID);
    if (symbol) {
        (0, redisWriteBuffer_1.bufferSet)(`oi:${symbol}`, String(event.openInterest));
        console.log(`[REDIS][LIVE] key=oi:${symbol} value=${event.openInterest}`);
    }
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
        result.push((0, exports.parseDateToYMD)(new Date(d)));
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
    if (baseUrl) {
        if (!(0, marketDataSessionService_1.getMarketDataToken)()) {
            await (0, exports.loginToAetram)();
        }
        if ((0, marketDataSessionService_1.getMarketDataToken)()) {
            try {
                const name = indexSymbol.replace(/50$/i, "").replace(/FIFTY$/i, "").toUpperCase();
                // Aetram's Market Data API returns 404 for /instruments/expiry.
                // Instead, we fetch the instruments for the index and extract the unique expiries.
                const results = await (0, exports.searchInstruments)(name);
                const todayYmd = new Date().toISOString().slice(0, 10);
                const uniqueExpiries = new Set();
                for (const inst of results) {
                    // Only look at options (OptionType 3 = CE, 4 = PE, or strings like "CE"/"PE")
                    const optType = String(inst.optionType || "");
                    if (!optType || (optType !== "3" && optType !== "4" && !optType.toUpperCase().includes("E"))) {
                        continue;
                    }
                    const rawExp = inst.expiryDate || "";
                    const ymd = (0, exports.parseDateToYMD)(rawExp);
                    if (ymd && ymd >= todayYmd) {
                        uniqueExpiries.add(ymd);
                    }
                }
                if (uniqueExpiries.size > 0) {
                    const sorted = Array.from(uniqueExpiries).sort();
                    console.log(`[AetramMD] Dynamic expiries found for ${indexSymbol}: ${sorted.length} dates [${sorted.slice(0, 5).join(", ")}...]`);
                    return sorted;
                }
            }
            catch (e) {
                console.warn(`[AetramMD] Failed to fetch real expiries for ${indexSymbol}: ${e.message}. Falling back.`);
            }
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
