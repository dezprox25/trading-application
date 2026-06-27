"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startZebuMarketDataFeedWithCredentials = exports.startZebuMarketDataFeed = exports.isZebuMarketDataConfigured = exports.getZebuMissingConfig = exports.setRuntimeInstrumentTokens = exports.isZebuLiveConnected = void 0;
const ws_1 = __importDefault(require("ws"));
const zebuOAuthService_1 = require("./zebuOAuthService");
let wsConnected = false;
const isZebuLiveConnected = () => wsConnected;
exports.isZebuLiveConnected = isZebuLiveConnected;
// Runtime token overrides (set by instrumentTokenService after NFO refresh)
let runtimeFutToken = null;
let runtimeCeTokens = null;
let runtimePeTokens = null;
const setRuntimeInstrumentTokens = (futToken, ceTokens, peTokens) => {
    runtimeFutToken = futToken || null;
    runtimeCeTokens = ceTokens.length > 0 ? ceTokens.join(",") : null;
    runtimePeTokens = peTokens.length > 0 ? peTokens.join(",") : null;
    console.log(`[Zebu] Runtime tokens updated — FUT: ${futToken ? "set" : "null"} | CE: ${ceTokens.length} | PE: ${peTokens.length}`);
};
exports.setRuntimeInstrumentTokens = setRuntimeInstrumentTokens;
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
    ...parseInstrumentEnv(runtimeFutToken || process.env.ZEBU_NIFTY_FUT_TOKEN),
    ...parseInstrumentEnv(runtimeCeTokens || process.env.ZEBU_NIFTY_CE_TOKENS),
    ...parseInstrumentEnv(runtimePeTokens || process.env.ZEBU_NIFTY_PE_TOKENS),
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
/**
 * Start Zebu feed using runtime credentials (from user-initiated broker login).
 * Instruments remain env-configured (they are configuration, not credentials).
 */
const SESSION_EXPIRY_PATTERNS = [
    "session expired", "sessionexpired", "invalid session", "token expired",
    "susertoken", "not_ok", "login", "unauthorized", "invalid user"
];
const isSessionExpiredMessage = (emsg, stat) => {
    const combined = `${emsg || ""} ${stat || ""}`.toLowerCase();
    return SESSION_EXPIRY_PATTERNS.some(p => combined.includes(p));
};
const startZebuMarketDataFeedWithCredentials = (userId, sessionToken, onTick, onDataSource, onFallback, onSessionExpired) => {
    const wsUrl = getZebuWsUrl();
    const instruments = getModule1ZebuInstruments();
    const symbolByKey = buildInstrumentMap(instruments);
    const subscribeKeys = instruments.map((i) => i.key).join("#");
    if (!wsUrl || !/^wss?:\/\//.test(wsUrl)) {
        console.warn("[Feed] ZEBU_WS_URL not configured — cannot start live feed.");
        onFallback("ZEBU_WS_URL not configured");
        return { close: () => { } };
    }
    let tickCount = 0;
    let lastPayload = null;
    let liveConnected = false;
    let subscriptionSent = false;
    // Per-minute message statistics (all message types, not just ticks)
    let msgCountThisMinute = 0;
    let totalMsgCount = 0;
    const statsInterval = setInterval(() => {
        console.log(`[Feed:STATS] Messages/min: ${msgCountThisMinute} | Total messages: ${totalMsgCount} | Ticks: ${tickCount} | Instruments: ${instruments.length}`);
        if (lastPayload) {
            console.log(`[Feed:STATS] Last tick — symbol=${lastPayload.symbol} ltp=${lastPayload.ltp} oi=${lastPayload.oi ?? "—"} ts=${lastPayload.timestamp?.toISOString?.() ?? "—"}`);
        }
        else {
            console.warn("[Feed:STATS] No ticks received yet — waiting for Zebu to stream data.");
        }
        msgCountThisMinute = 0;
    }, 60000);
    console.log(`[Feed] Connecting with session for user: ${userId} | URL: ${sanitizeFeedUrl(wsUrl)}`);
    console.log(`[Feed] Instrument list (${instruments.length}):`);
    for (const inst of instruments) {
        console.log(`  [Feed]   ${inst.key} → ${inst.symbol}`);
    }
    if (instruments.length === 0) {
        console.error("[Feed] FATAL: No instruments configured. Set ZEBU_NIFTY_FUT_TOKEN, ZEBU_NIFTY_CE_TOKENS, ZEBU_NIFTY_PE_TOKENS in .env");
    }
    const ws = new ws_1.default(wsUrl);
    ws.on("open", () => {
        wsConnected = true;
        // Send connection handshake. Do NOT send subscription here.
        // Per Zebu NorenWS protocol, subscription (t:"t") must wait for the
        // server's connection ack (t:"ck", s:"OK") — see message handler below.
        const connectMsg = {
            t: "c",
            uid: userId,
            actid: userId,
            susertoken: sessionToken,
            source: process.env.ZEBU_SOURCE || "API",
        };
        console.log(`[Feed] WS open — sending connect handshake for user: ${userId}`);
        ws.send(JSON.stringify(connectMsg));
        liveConnected = true;
        onDataSource("LIVE_MARKET_API");
    });
    ws.on("message", async (raw) => {
        const rawStr = raw.toString();
        msgCountThisMinute++;
        totalMsgCount++;
        // Log every raw message — truncate only if very long
        const preview = rawStr.length > 300 ? rawStr.substring(0, 300) + `…(+${rawStr.length - 300}b)` : rawStr;
        console.log(`[Feed:RAW] #${totalMsgCount} (${rawStr.length}b): ${preview}`);
        let payload;
        try {
            payload = JSON.parse(rawStr);
        }
        catch {
            console.warn(`[Feed:RAW] Non-JSON message received: ${preview}`);
            return;
        }
        const records = Array.isArray(payload) ? payload : [payload];
        for (const record of records) {
            const t = record.t;
            // ── Connection acknowledgement ─────────────────────────────────────────
            if (t === "ck") {
                if (record.s === "OK" || record.s === "Ok") {
                    console.log(`[Feed:ACK] Connection acknowledged by Zebu (s=${record.s}). Sending subscriptions...`);
                    if (subscribeKeys && !subscriptionSent) {
                        subscriptionSent = true;
                        ws.send(JSON.stringify({ t: "t", k: subscribeKeys }));
                        console.log(`[Feed:SUB] Subscription sent — ${instruments.length} instruments: ${subscribeKeys.substring(0, 120)}${subscribeKeys.length > 120 ? "…" : ""}`);
                    }
                    else if (!subscribeKeys) {
                        console.error("[Feed:SUB] No subscribe keys — no instruments configured in .env");
                    }
                }
                else {
                    console.error(`[Feed:ACK] Connection REJECTED by Zebu — s="${record.s}" emsg="${record.emsg ?? "(none)"}" | Full: ${JSON.stringify(record)}`);
                    if (isSessionExpiredMessage(record.emsg, record.s) && onSessionExpired) {
                        console.warn("[Feed:ACK] Session token rejected — likely expired. Triggering session expiry handler.");
                        onSessionExpired();
                    }
                    else {
                        onFallback(`Zebu rejected connection: ${record.emsg || record.s}`);
                    }
                }
                continue;
            }
            // ── Subscription acknowledgement ───────────────────────────────────────
            if (t === "tk") {
                const accepted = record.s === "OK" || record.s === "Ok";
                if (accepted) {
                    console.log(`[Feed:ACK] Subscription acknowledged — instruments confirmed by Zebu: ${JSON.stringify(record).substring(0, 300)}`);
                }
                else {
                    console.error(`[Feed:ACK] Subscription REJECTED by Zebu — s="${record.s}" emsg="${record.emsg ?? "(none)"}" | Full: ${JSON.stringify(record)}`);
                }
                continue;
            }
            // ── Heartbeat / ping ───────────────────────────────────────────────────
            if (t === "h") {
                console.log(`[Feed:PING] Heartbeat from Zebu (msg #${totalMsgCount})`);
                continue;
            }
            // ── Broker-level error ─────────────────────────────────────────────────
            if (record.s === "Not_Ok" || (record.emsg && !t)) {
                console.error(`[Feed:ERROR] Broker error — emsg="${record.emsg ?? "(none)"}" | Full: ${JSON.stringify(record)}`);
                continue;
            }
            // ── Market tick (tf = tick feed update) ───────────────────────────────
            const tick = toTick(record, symbolByKey);
            if (tick) {
                tickCount++;
                lastPayload = tick;
                await onTick(tick);
            }
            else {
                // Log unrecognized frames so we can see what Zebu is actually sending
                console.log(`[Feed:SKIP] Unrecognized record (t="${t ?? "(none)"}"): ${JSON.stringify(record).substring(0, 200)}`);
            }
        }
    });
    ws.on("close", () => {
        wsConnected = false;
        clearInterval(statsInterval);
        const reason = liveConnected ? "live feed closed" : "connection closed before handshake";
        console.log(`[Feed] Disconnected — ${reason}. Total messages received: ${totalMsgCount} | Total ticks: ${tickCount}`);
        onDataSource("SIMULATOR");
        onFallback(reason);
    });
    ws.on("error", (err) => {
        wsConnected = false;
        clearInterval(statsInterval);
        console.error("[Feed] WebSocket error:", err.message);
        onDataSource("SIMULATOR");
        onFallback("WebSocket error");
    });
    return {
        close: () => {
            clearInterval(statsInterval);
            ws.close();
        }
    };
};
exports.startZebuMarketDataFeedWithCredentials = startZebuMarketDataFeedWithCredentials;
