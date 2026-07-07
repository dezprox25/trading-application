"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initAetramMarketDataService = exports.loginToAetramWithCredentials = exports.getAetramExpiryDates = exports.connectToAetramWebSocket = exports.subscribeToInstruments = exports.resolveOptionStrikeToken = exports.loginToAetram = exports.isAetramConnected = exports.clearAetramSession = exports.setOnAetramReconnect = void 0;
const axios_1 = __importDefault(require("axios"));
const socket_io_client_1 = require("socket.io-client");
const redis_1 = __importDefault(require("../config/redis"));
const socketService_1 = require("./socketService");
const marketDataSessionService_1 = require("./marketDataSessionService");
// Session state (token, userID, expiry) lives in marketDataSessionService —
// this service only owns the market-data transport (REST lookups + WebSocket).
let socket = null;
let socketConnected = false;
let _onReconnectFn = null;
const setOnAetramReconnect = (fn) => {
    _onReconnectFn = fn;
};
exports.setOnAetramReconnect = setOnAetramReconnect;
const clearAetramSession = () => {
    (0, marketDataSessionService_1.markMarketDataSessionExpired)();
    socketConnected = false;
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
    if ((0, marketDataSessionService_1.isMarketDataAuthenticated)() && socketConnected) {
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
 * Search and resolve an option strike symbol to its instrument token
 */
const resolveOptionStrikeToken = async (index, expiryDate, strikeSymbol) => {
    // If already in cache, return it
    if (symbolToTokenMap.has(strikeSymbol)) {
        return symbolToTokenMap.get(strikeSymbol);
    }
    const baseUrl = getBaseUrl();
    if (!baseUrl || !(0, marketDataSessionService_1.getMarketDataToken)())
        return null;
    // Extract strike price and option type from strikeSymbol (e.g. "NIFTY22100CE")
    const match = strikeSymbol.match(/(\d+)(CE|PE)$/);
    if (!match)
        return null;
    const strikePrice = Number(match[1]);
    const optionType = match[2].toUpperCase(); // CE or PE
    const indexShort = index.replace("50", "").replace("fifty", "").toUpperCase(); // e.g. "NIFTY"
    try {
        // Search using searchString
        const searchString = `${indexShort} ${strikePrice} ${optionType}`;
        const searchUrl = `${baseUrl}/search/instruments?searchString=${encodeURIComponent(searchString)}`;
        const response = await axios_1.default.get(searchUrl, { headers: getHeaders(), timeout: 10000 });
        if (response.data && response.data.code === "success" && Array.isArray(response.data.result)) {
            const targetYmd = parseDateToYMD(expiryDate);
            // Filter list in-memory for the closest match
            for (const inst of response.data.result) {
                const instExpiryYmd = parseDateToYMD(inst.expiryDate || inst.expiry || "");
                const instStrike = Math.round(Number(inst.strikePrice || inst.strike || 0));
                const instOptType = String(inst.optionType || inst.type || "").toUpperCase();
                const isOptCE = instOptType.startsWith("C") || instOptType.includes("CE");
                const targetCE = optionType.startsWith("C");
                if (instExpiryYmd === targetYmd &&
                    instStrike === strikePrice &&
                    isOptCE === targetCE) {
                    const segment = Number(inst.exchangeSegment || 2);
                    const token = String(inst.exchangeInstrumentID);
                    const result = { segment, token };
                    symbolToTokenMap.set(strikeSymbol, result);
                    tokenToSymbolMap.set(`${segment}|${token}`, strikeSymbol);
                    tokenToSymbolMap.set(token, strikeSymbol); // Fallback lookup mapping
                    console.log(`[AetramMD] Resolved ${strikeSymbol} to Token: ${token} (Seg: ${segment})`);
                    return result;
                }
            }
        }
        console.warn(`[AetramMD] Could not find matching Aetram instrument for strike ${strikeSymbol} (${expiryDate})`);
        return null;
    }
    catch (error) {
        if (error?.response?.status === 401) {
            console.warn("[AetramMD] Session expired (401) during instrument lookup.");
            (0, exports.clearAetramSession)();
            (0, socketService_1.broadcastBrokerStatus)("session-expired", "Broker session expired. Please login again.", "module2");
        }
        else {
            console.error(`[AetramMD] Instrument lookup error for ${strikeSymbol}:`, error?.message || error);
        }
        return null;
    }
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
 * Handles incoming ticks and updates Redis
 */
const handleLtpTick = async (tick) => {
    const token = String(tick.exchangeInstrumentID || tick.ExchangeInstrumentID);
    const ltp = tick.lastTradedPrice || tick.lastPrice || tick.ltp || tick.close;
    if (token && ltp !== undefined) {
        const symbol = tokenToSymbolMap.get(token);
        if (symbol) {
            await redis_1.default.set(`ltp:${symbol}`, ltp.toString());
        }
    }
};
const handleOiTick = async (tick) => {
    const token = String(tick.exchangeInstrumentID || tick.ExchangeInstrumentID);
    const oi = tick.openInterest || tick.oi;
    if (token && oi !== undefined) {
        const symbol = tokenToSymbolMap.get(token);
        if (symbol) {
            await redis_1.default.set(`oi:${symbol}`, oi.toString());
        }
    }
};
/**
 * Establish WebSocket / Socket.IO connection.
 * Disconnects any existing socket before creating a new one.
 * Returns true if the socket connected within the 12-second timeout,
 * false if the initial attempt timed out (reconnection still runs in background).
 */
const connectToAetramWebSocket = async () => {
    const sessionToken = (0, marketDataSessionService_1.getMarketDataToken)();
    const userID = (0, marketDataSessionService_1.getMarketDataUser)();
    if (!sessionToken || !userID) {
        console.warn("[AetramMD] No active session. Cannot connect socket.");
        return false;
    }
    // Disconnect stale socket before creating new one
    if (socket) {
        socket.removeAllListeners();
        socket.disconnect();
        socket = null;
        socketConnected = false;
    }
    const baseUrl = getBaseUrl();
    let host = "";
    try {
        const parsed = new URL(baseUrl);
        host = `${parsed.protocol}//${parsed.host}`;
    }
    catch {
        console.error("[AetramMD] Invalid MarketData Base URL.");
        return false;
    }
    console.log(`[AetramMD] Connecting Socket.IO client to ${host}...`);
    // Use polling first so the connection can be established through proxies and
    // load-balancers that may not support direct WebSocket upgrades. Once the
    // handshake succeeds over polling, Socket.IO upgrades to WebSocket automatically.
    socket = (0, socket_io_client_1.io)(host, {
        path: "/apibinarymarketdata/socket.io",
        query: {
            token: sessionToken,
            userID: userID,
            apiType: "MARKETDATA",
            publishFormat: "JSON",
        },
        transports: ["polling", "websocket"],
        reconnection: true,
        reconnectionDelay: 3000,
        reconnectionAttempts: 10,
    });
    // Persistent connect handler — fires on initial connect AND every reconnect.
    socket.on("connect", async () => {
        socketConnected = true;
        console.log("[AetramMD] Socket connected.");
        (0, socketService_1.broadcastBrokerStatus)("live", undefined, "module2");
        if (_onReconnectFn) {
            try {
                await _onReconnectFn();
            }
            catch (err) {
                console.error("[AetramMD] Reconnect callback error:", err?.message || err);
            }
        }
    });
    socket.on("connect_error", (error) => {
        socketConnected = false;
        console.error("[AetramMD] Socket connection error:", error.message);
        (0, socketService_1.broadcastBrokerStatus)("reconnecting", "Lost connection to broker. Reconnecting...", "module2");
    });
    socket.on("1512-json-full", handleLtpTick);
    socket.on("1512-json-partial", handleLtpTick);
    socket.on("1510-json-full", handleOiTick);
    socket.on("1510-json-partial", handleOiTick);
    socket.on("disconnect", (reason) => {
        socketConnected = false;
        console.warn(`[AetramMD] Socket disconnected: ${reason}`);
        if (reason !== "io client disconnect") {
            // Only broadcast disconnected for unintentional disconnects — not when we
            // call socket.disconnect() ourselves (e.g. on re-login).
            (0, socketService_1.broadcastBrokerStatus)("broker-disconnected", "Lost connection to broker. Reconnecting...", "module2");
        }
    });
    // Wait up to 12 seconds for the initial connection to be established.
    // The persistent handlers above remain active for the lifetime of the socket.
    const connected = await new Promise((resolve) => {
        const timer = setTimeout(() => {
            console.warn("[AetramMD] Initial connection timed out — socket reconnection running in background.");
            resolve(false);
        }, 12000);
        socket.once("connect", () => {
            clearTimeout(timer);
            resolve(true);
        });
        // connect_error is handled by the persistent handler above.
        // The timer will resolve(false) after 12 seconds if no connection is made.
    });
    return connected;
};
exports.connectToAetramWebSocket = connectToAetramWebSocket;
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
 */
const getAetramExpiryDates = async (indexSymbol) => {
    const baseUrl = getBaseUrl();
    if (baseUrl && (0, marketDataSessionService_1.getMarketDataToken)()) {
        try {
            const name = indexSymbol.replace(/50$/i, "").replace(/FIFTY$/i, "").toUpperCase();
            const url = `${baseUrl}/instruments/expiry?exchangeSegment=2&series=OPT&name=${encodeURIComponent(name)}`;
            const response = await axios_1.default.get(url, { headers: getHeaders(), timeout: 8000 });
            if (response.data?.code === "success" && Array.isArray(response.data.result)) {
                const dates = response.data.result
                    .map((r) => parseDateToYMD(r.expiryDate || r.expiry || ""))
                    .filter(Boolean)
                    .sort();
                if (dates.length > 0)
                    return dates;
            }
        }
        catch {
            // Fall through to config fallback
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
    const result = await (0, marketDataSessionService_1.loginMarketData)(appKey, secretKey);
    return result.ok;
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
