"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startZebuMarketDataFeed = exports.isZebuMarketDataConfigured = exports.getZebuMissingConfig = exports.isZebuLiveConnected = void 0;
const ws_1 = __importDefault(require("ws"));
const zebuOAuthService_1 = require("./zebuOAuthService");
let wsConnected = false;
const isZebuLiveConnected = () => wsConnected;
exports.isZebuLiveConnected = isZebuLiveConnected;
const isPlaceholder = (value) => !value || value.includes("your-") || value.includes("placeholder");
const getZebuWsUrl = () => process.env.ZEBU_WS_URL || process.env.CLIENT_API_URL || "";
const getZebuUserId = () => process.env.ZEBU_CLIENT_ID || process.env.ZEBU_USER_ID || "";
const getZebuAccountId = () => process.env.ZEBU_ACCOUNT_ID || getZebuUserId();
const getZebuSessionToken = () => process.env.ZEBU_SUSERTOKEN || process.env.ZEBU_SESSION_TOKEN || "";
const sanitizeFeedUrl = (url) => {
    try {
        const parsed = new URL(url);
        parsed.username = "";
        parsed.password = "";
        parsed.search = "";
        return parsed.toString();
    }
    catch {
        return url ? "[configured]" : "[missing]";
    }
};
const parseInstrumentEnv = (value) => {
    if (!value || isPlaceholder(value))
        return [];
    return value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
        const [exchangeToken, symbolFromEnv] = part.split(":");
        const [exchange, token] = exchangeToken.split("|");
        if (!exchange || !token || !symbolFromEnv)
            return null;
        return {
            key: `${exchange}|${token}`,
            exchange,
            token,
            symbol: symbolFromEnv,
        };
    })
        .filter((instrument) => instrument !== null);
};
const getModule1ZebuInstruments = () => [
    ...parseInstrumentEnv(process.env.ZEBU_NIFTY_SPOT_TOKEN || "NSE|26000:NIFTY-SPOT"),
    ...parseInstrumentEnv(process.env.ZEBU_NIFTY_FUT_TOKEN),
    ...parseInstrumentEnv(process.env.ZEBU_NIFTY_CE_TOKENS),
    ...parseInstrumentEnv(process.env.ZEBU_NIFTY_PE_TOKENS),
];
const getZebuMissingConfig = () => {
    const missing = [];
    const wsUrl = getZebuWsUrl();
    const instruments = getModule1ZebuInstruments();
    if (!/^wss?:\/\//.test(wsUrl) || isPlaceholder(wsUrl))
        missing.push("ZEBU_WS_URL or CLIENT_API_URL");
    if (isPlaceholder(getZebuUserId()))
        missing.push("ZEBU_CLIENT_ID or ZEBU_USER_ID");
    const hasDirectAuth = !isPlaceholder(process.env.ZEBU_PASSWORD) &&
        !isPlaceholder(process.env.ZEBU_FACTOR2) &&
        !isPlaceholder(process.env.ZEBU_VENDOR_CODE) &&
        !isPlaceholder(process.env.ZEBU_LOGIN_URL);
    const hasToken = !isPlaceholder(getZebuSessionToken());
    const hasOAuth = (0, zebuOAuthService_1.getZebuOAuthMissingConfig)().length === 0;
    if (!hasToken && !hasDirectAuth && !hasOAuth) {
        missing.push("ZEBU_SUSERTOKEN/ZEBU_SESSION_TOKEN, QuickAuth credentials, or complete Zebu OAuth config");
    }
    if (isPlaceholder(process.env.MOD1_API_KEY))
        missing.push("MOD1_API_KEY");
    if (isPlaceholder(process.env.MOD1_API_SECRET))
        missing.push("MOD1_API_SECRET");
    if (instruments.length === 0) {
        missing.push("ZEBU_NIFTY_FUT_TOKEN, ZEBU_NIFTY_CE_TOKENS, ZEBU_NIFTY_PE_TOKENS");
    }
    return missing;
};
exports.getZebuMissingConfig = getZebuMissingConfig;
const isZebuMarketDataConfigured = () => (0, exports.getZebuMissingConfig)().length === 0;
exports.isZebuMarketDataConfigured = isZebuMarketDataConfigured;
const buildInstrumentMap = (instruments) => {
    const symbolByKey = new Map();
    for (const instrument of instruments) {
        symbolByKey.set(instrument.key, instrument.symbol);
        symbolByKey.set(instrument.token, instrument.symbol);
    }
    return symbolByKey;
};
const toTick = (payload, symbolByKey) => {
    const exchange = payload.e || payload.exch || payload.exchange;
    const token = payload.tk || payload.token || payload.instrumentToken;
    const mappedSymbol = symbolByKey.get(`${exchange}|${token}`) || symbolByKey.get(String(token));
    const symbol = mappedSymbol || payload.tsym || payload.tradingSymbol || payload.symbol;
    const rawLtp = payload.lp ?? payload.ltp ?? payload.lastPrice ?? payload.last_price ?? payload.price;
    const rawOi = payload.oi ?? payload.openInterest ?? payload.open_interest;
    const ltp = Number(rawLtp);
    if (!symbol || Number.isNaN(ltp))
        return null;
    return {
        symbol: String(symbol),
        ltp,
        timestamp: payload.ft ? new Date(Number(payload.ft) * 1000) : new Date(),
        volume: payload.v ? Number(payload.v) : payload.volume ? Number(payload.volume) : 0,
        oi: rawOi !== undefined ? Number(rawOi) : undefined,
    };
};
const startZebuMarketDataFeed = (onTick, onDataSource, onFallback) => {
    const wsUrl = getZebuWsUrl();
    const instruments = getModule1ZebuInstruments();
    const symbolByKey = buildInstrumentMap(instruments);
    const subscribeKeys = instruments.map((instrument) => instrument.key).join("#");
    console.log(`[Module1/Zebu] Connecting to live feed: ${sanitizeFeedUrl(wsUrl)}`);
    const ws = new ws_1.default(wsUrl);
    let liveConnected = false;
    ws.on("open", async () => {
        wsConnected = true;
        let sessionToken = null;
        try {
            sessionToken = await (0, zebuOAuthService_1.resolveZebuSessionToken)();
        }
        catch (error) {
            ws.close();
            onFallback("Zebu OAuth token exchange failed");
            return;
        }
        if (!sessionToken) {
            ws.close();
            onFallback("missing Zebu session token and OAuth token exchange config");
            return;
        }
        const connectMessage = {
            t: "c",
            uid: getZebuUserId(),
            actid: getZebuAccountId(),
            susertoken: sessionToken,
            source: process.env.ZEBU_SOURCE || "API",
        };
        ws.send(JSON.stringify(connectMessage));
        ws.send(JSON.stringify({ t: "t", k: subscribeKeys }));
        liveConnected = true;
        onDataSource("LIVE_MARKET_API");
        console.log("[Module1/Zebu] Live feed connected");
    });
    ws.on("message", async (raw) => {
        try {
            const payload = JSON.parse(raw.toString());
            const records = Array.isArray(payload) ? payload : [payload];
            for (const record of records) {
                const tick = toTick(record, symbolByKey);
                if (tick)
                    await onTick(tick);
            }
        }
        catch (error) {
            console.warn("[Module1/Zebu] Ignored malformed market tick payload.");
        }
    });
    ws.on("close", () => {
        wsConnected = false;
        const reason = liveConnected ? "live feed closed" : "live feed closed before connection";
        onDataSource("SIMULATOR");
        onFallback(reason);
    });
    ws.on("error", () => {
        wsConnected = false;
        onDataSource("SIMULATOR");
        onFallback("live feed connection error");
    });
    return {
        close: () => ws.close(),
    };
};
exports.startZebuMarketDataFeed = startZebuMarketDataFeed;
