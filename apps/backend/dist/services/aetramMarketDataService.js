"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initAetramMarketDataService = exports.connectToAetramWebSocket = exports.subscribeToInstruments = exports.resolveOptionStrikeToken = exports.loginToAetram = exports.isAetramConnected = void 0;
const axios_1 = __importDefault(require("axios"));
const socket_io_client_1 = require("socket.io-client");
const redis_1 = __importDefault(require("../config/redis"));
let sessionToken = null;
let userID = null;
let socket = null;
let socketConnected = false;
const isAetramConnected = () => {
    const apiKey = getApiKey();
    const apiSecret = getApiSecret();
    const authUrl = getAuthUrl();
    const baseUrl = getBaseUrl();
    if (isPlaceholder(apiKey) || isPlaceholder(apiSecret) || !authUrl || !baseUrl) {
        return "WAITING_FOR_CONFIGURATION";
    }
    if (sessionToken && socketConnected) {
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
    if (!sessionToken)
        return { "Content-Type": "application/json" };
    return {
        "Content-Type": "application/json",
        "authorization": sessionToken,
    };
};
/**
 * Perform login to Aetram MarketData API
 */
const loginToAetram = async () => {
    const apiKey = getApiKey();
    const apiSecret = getApiSecret();
    const authUrl = getAuthUrl();
    if (isPlaceholder(apiKey) || isPlaceholder(apiSecret) || !authUrl) {
        console.warn("[AetramMD] Missing or placeholder credentials in env. Skipping Aetram live login.");
        return false;
    }
    try {
        console.log("[AetramMD] Logging in to Aetram MarketData API...");
        const response = await axios_1.default.post(authUrl, {
            secretKey: apiSecret,
            appKey: apiKey,
            source: "WEBAPI",
        }, {
            headers: { "Content-Type": "application/json" },
        });
        if (response.data && response.data.code === "success" && response.data.result) {
            sessionToken = response.data.result.token;
            userID = response.data.result.userID;
            console.log(`[AetramMD] Login successful. User ID: ${userID}`);
            return true;
        }
        else {
            console.error("[AetramMD] Login failed. Response:", response.data);
            return false;
        }
    }
    catch (error) {
        console.error("[AetramMD] Login request exception:", error?.message || error);
        if (error.response?.data) {
            console.error("[AetramMD] Login request error response body:", JSON.stringify(error.response.data, null, 2));
        }
        return false;
    }
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
    if (!baseUrl || !sessionToken)
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
        const response = await axios_1.default.get(searchUrl, { headers: getHeaders() });
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
        console.error(`[AetramMD] Instrument lookup error for ${strikeSymbol}:`, error?.message || error);
        return null;
    }
};
exports.resolveOptionStrikeToken = resolveOptionStrikeToken;
/**
 * Subscribe to LTP & OI updates for resolved instruments
 */
const subscribeToInstruments = async (instruments) => {
    const baseUrl = getBaseUrl();
    if (!baseUrl || !sessionToken || instruments.length === 0)
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
        await axios_1.default.post(`${baseUrl}/instruments/subscription`, payload, { headers: getHeaders() });
        await axios_1.default.post(`${baseUrl}/instruments/subscription`, payloadOI, { headers: getHeaders() });
    }
    catch (error) {
        console.error("[AetramMD] Subscription request failed:", error?.message || error);
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
 * Establish WebSocket / Socket.IO connection
 */
const connectToAetramWebSocket = async () => {
    if (!sessionToken || !userID) {
        console.warn("[AetramMD] No active session. Cannot connect socket.");
        return false;
    }
    // Extract base host URL
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
    socket = (0, socket_io_client_1.io)(host, {
        path: "/apibinarymarketdata/socket.io",
        query: {
            token: sessionToken,
            userID: userID,
            apiType: "MARKETDATA",
            publishFormat: "JSON",
        },
        transports: ["websocket"],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: Infinity,
    });
    socket.on("connect", () => {
        socketConnected = true;
        console.log("[AetramMD] Socket.IO feed connected successfully.");
    });
    socket.on("connect_error", (error) => {
        socketConnected = false;
        console.error("[AetramMD] Socket connection error:", error);
    });
    // Attach handlers for LTP and OI
    socket.on("1512-json-full", handleLtpTick);
    socket.on("1512-json-partial", handleLtpTick);
    socket.on("1510-json-full", handleOiTick);
    socket.on("1510-json-partial", handleOiTick);
    socket.on("disconnect", (reason) => {
        socketConnected = false;
        console.warn(`[AetramMD] Socket disconnected: ${reason}`);
    });
    return true;
};
exports.connectToAetramWebSocket = connectToAetramWebSocket;
/**
 * Start the Aetram Service lifecycle
 */
const initAetramMarketDataService = async () => {
    const success = await (0, exports.loginToAetram)();
    if (success) {
        await (0, exports.connectToAetramWebSocket)();
    }
};
exports.initAetramMarketDataService = initAetramMarketDataService;
