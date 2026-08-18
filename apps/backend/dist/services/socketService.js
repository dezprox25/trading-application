"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.broadcastBrokerStatus = exports.broadcastTrackerUpdate = exports.initSocketServer = exports.resetMarketReady = void 0;
const token_1 = require("../utils/token");
const dataFeed_1 = require("./dataFeed");
const pivotService_1 = require("./pivotService");
const module1OiService_1 = require("./module1OiService");
const zebuMarketDataClient_1 = require("./zebuMarketDataClient");
const instrumentTokenService_1 = require("./instrumentTokenService");
let ioServer = null;
// ── Selected option strikes tracking across active client sockets ─────────────
const socketOptionSelections = new Map();
const syncSelectedOptionSymbols = () => {
    const allSelected = new Set();
    for (const syms of socketOptionSelections.values()) {
        for (const sym of syms) {
            allSelected.add(sym);
        }
    }
    (0, dataFeed_1.setSelectedOptionSymbols)(Array.from(allSelected));
};
// ── Market readiness tracking ─────────────────────────────────────────────────
// Tracks whether the first valid NIFTY-FUT tick has been received this session.
// Used to emit `market_ready` to clients so they can auto-generate without polling.
let _marketReady = false;
let _marketReadyLtp = 0;
let _marketReadyTs = "";
/**
 * Resets the market-ready state. Call this whenever a new broker connection
 * session starts so stale replays from the previous session are not sent to
 * newly connected clients before the first live tick arrives.
 */
const resetMarketReady = () => {
    _marketReady = false;
    _marketReadyLtp = 0;
    _marketReadyTs = "";
};
exports.resetMarketReady = resetMarketReady;
/**
 * Initialize Socket.io server with JWT authentication and room handlers
 */
const initSocketServer = (io) => {
    ioServer = io;
    // Connection authentication middleware
    io.use((socket, next) => {
        const token = socket.handshake.auth?.token || socket.handshake.query?.token;
        if (!token || typeof token !== "string") {
            return next(new Error("Authentication failed: Access token missing"));
        }
        try {
            const decoded = (0, token_1.verifyAccessToken)(token);
            socket.data.userId = decoded.userId;
            next();
        }
        catch (err) {
            return next(new Error("Authentication failed: Access token invalid or expired"));
        }
    });
    io.on("connection", (socket) => {
        console.log(`[Socket] Client connected: ${socket.id} (User: ${socket.data.userId})`);
        // Send initial latest OI metrics immediately on connection
        socket.emit("latest-oi", (0, module1OiService_1.getLatestModule1OiMetrics)());
        // Immediately tell this client the current Zebu (Module 1) broker connection state so
        // it doesn't have to wait for the next broadcast event.
        const currentBrokerStatus = (0, zebuMarketDataClient_1.isZebuLiveConnected)() ? "live" : "broker-disconnected";
        socket.emit("broker_status", { status: currentBrokerStatus, moduleId: "module1", timestamp: new Date().toISOString() });
        console.log(`[Socket] Sent initial broker_status[module1]="${currentBrokerStatus}" to ${socket.id}`);
        // If market data is already ready (first tick already received before this client
        // connected), immediately send market_ready so the client doesn't wait needlessly.
        if (_marketReady) {
            socket.emit("market_ready", { ltp: _marketReadyLtp, symbol: "NIFTY-FUT", timestamp: _marketReadyTs });
            console.log(`[Socket] Sent market_ready replay to ${socket.id} — ltp=${_marketReadyLtp}`);
        }
        // 1. Join room to receive raw price ticks for a specific symbol
        socket.on("join:symbol", (symbol) => {
            socket.join(`market:${symbol}`);
            console.log(`[Socket] Client ${socket.id} subscribed to market ticks: ${symbol}`);
        });
        socket.on("leave:symbol", (symbol) => {
            socket.leave(`market:${symbol}`);
            console.log(`[Socket] Client ${socket.id} unsubscribed from market ticks: ${symbol}`);
        });
        // 1b. On-demand option subscribe: resolves the user's exact selected strikes to NFO
        // tokens, subscribes them on the live Zebu connection, and registers them in dataFeed's
        // activeSelectedOptionSymbols set so ONLY user-selected strikes are buffered/aggregated/persisted.
        socket.on("subscribe:options", async (data) => {
            const { instrument, expiry, callStrike, putStrike, type } = data || {};
            if (!instrument || !expiry) {
                console.warn(`[Socket] subscribe:options from ${socket.id} missing instrument/expiry — ignored: ${JSON.stringify(data)}`);
                return;
            }
            const wants = [];
            if (type !== "Put" && callStrike)
                wants.push({ strike: callStrike, optionType: "CE" });
            if (type !== "Call" && putStrike)
                wants.push({ strike: putStrike, optionType: "PE" });
            const resolvedTokens = [];
            const selectedSymbolsForSocket = new Set();
            for (const w of wants) {
                const letter = w.optionType === "CE" ? "C" : "P";
                const wantedSymbol = `${instrument.toUpperCase()}${expiry}${letter}${w.strike}`;
                const resolved = await (0, instrumentTokenService_1.resolveOptionInstrument)(instrument, expiry, w.strike, w.optionType);
                if (resolved) {
                    console.log(`[Feed:SUB] On-demand resolve OK — ${resolved.symbol} → ${resolved.exchange}|${resolved.token} (requested by ${socket.id})`);
                    resolvedTokens.push(resolved);
                    selectedSymbolsForSocket.add(resolved.symbol);
                }
                else {
                    console.warn(`[Feed:SUB] On-demand resolve FAILED — ${wantedSymbol} not found in NFO master.`);
                }
            }
            socketOptionSelections.set(socket.id, selectedSymbolsForSocket);
            syncSelectedOptionSymbols();
            if (resolvedTokens.length > 0) {
                (0, dataFeed_1.subscribeOptionTokens)(resolvedTokens);
            }
        });
        // 2. Join room to receive real-time indicators (Call/Put signals)
        socket.on("join:indicators", async (data) => {
            const { symbol, timeframe, method } = data;
            const roomName = `indicators:${symbol}:${timeframe}:${method}`;
            socket.join(roomName);
            console.log(`[Socket] Client ${socket.id} subscribed to indicators: ${roomName}`);
            // Push initial indicator state immediately on join
            const indicators = await (0, pivotService_1.evaluateIndicators)(symbol, timeframe, method);
            if (indicators) {
                socket.emit("indicators", indicators);
            }
        });
        socket.on("leave:indicators", (data) => {
            const { symbol, timeframe, method } = data;
            const roomName = `indicators:${symbol}:${timeframe}:${method}`;
            socket.leave(roomName);
            console.log(`[Socket] Client ${socket.id} unsubscribed from indicators: ${roomName}`);
        });
        // 3. Join room to receive option strike per-minute tracker updates
        socket.on("join:tracker", (sessionId) => {
            socket.join(`tracker:${sessionId}`);
            console.log(`[Socket] Client ${socket.id} subscribed to option tracker session: ${sessionId}`);
        });
        socket.on("leave:tracker", (sessionId) => {
            socket.leave(`tracker:${sessionId}`);
            console.log(`[Socket] Client ${socket.id} unsubscribed from option tracker session: ${sessionId}`);
        });
        socket.on("disconnect", () => {
            console.log(`[Socket] Client disconnected: ${socket.id}`);
            socketOptionSelections.delete(socket.id);
            syncSelectedOptionSymbols();
        });
    });
    let _socketEmitCount = 0;
    // Phase 6 throttles: the frontend samples oiMetrics/prices on a 500ms interval,
    // so broadcasting latest-oi on every tick (~300/sec at peak) and re-evaluating
    // indicators per NIFTY-FUT tick did pure redundant work. Emitting at most every
    // 250ms / evaluating at most every 500ms per room is invisible to the UI.
    const OI_EMIT_MIN_INTERVAL_MS = 250;
    const INDICATOR_EVAL_MIN_INTERVAL_MS = 500;
    let _lastOiEmitTs = 0;
    const _lastIndicatorEvalTs = new Map();
    // Wire tick ingestion callback to broadcast raw price updates and trigger real-time indicator updates
    (0, dataFeed_1.setOnTickReceived)(async (tick) => {
        if (!ioServer)
            return;
        // Broadcast raw tick to market room
        const room = `market:${tick.symbol}`;
        ioServer.to(room).emit("tick", tick);
        // Emit market_ready once when the first valid NIFTY-FUT tick arrives.
        // This is the authoritative readiness signal: broker is connected, subscriptions are
        // active, and live prices are flowing. The frontend auto-generates on receipt.
        if (!_marketReady && tick.symbol === "NIFTY-FUT" && tick.ltp > 0) {
            _marketReady = true;
            _marketReadyLtp = tick.ltp;
            _marketReadyTs = new Date().toISOString();
            console.log(`[Socket] ✓ LTP cache populated — first NIFTY-FUT tick: ltp=${tick.ltp} → emitting market_ready`);
            ioServer.emit("market_ready", { ltp: tick.ltp, symbol: "NIFTY-FUT", timestamp: _marketReadyTs });
        }
        // Broadcast latest computed OI metrics — throttled (latest row wins; the
        // frontend samples this on a 500ms interval, so per-tick emits were redundant).
        const nowTs = Date.now();
        if (nowTs - _lastOiEmitTs >= OI_EMIT_MIN_INTERVAL_MS) {
            _lastOiEmitTs = nowTs;
            const oiMetrics = (0, module1OiService_1.getLatestModule1OiMetrics)();
            ioServer.emit("latest-oi", oiMetrics);
            _socketEmitCount++;
            // Log socket emit stats every 100 emits
            if (_socketEmitCount % 100 === 0) {
                const connectedClients = ioServer.sockets.sockets.size;
                console.log(`[Socket] Emit #${_socketEmitCount} | Event: latest-oi | Clients: ${connectedClients} | c_tl: ${oiMetrics.c_tl} | p_tl: ${oiMetrics.p_tl}`);
            }
        }
        // If this is NIFTY-FUT, trigger indicator evaluations for any active rooms listening to this symbol
        if (tick.symbol === "NIFTY-FUT") {
            const timeframes = ["1m", "3m", "5m", "custom"];
            const methods = ["classic", "camarilla", "fibonacci"];
            for (const tf of timeframes) {
                for (const m of methods) {
                    const roomName = `indicators:${tick.symbol}:${tf}:${m}`;
                    // Only compute and emit if there are active sockets connected to this room
                    const clients = ioServer.sockets.adapter.rooms.get(roomName);
                    if (clients && clients.size > 0) {
                        // Per-room throttle — indicator inputs (LTP + pivots) don't change
                        // meaningfully tick-to-tick; 2 evals/sec matches UI refresh rates.
                        const lastEval = _lastIndicatorEvalTs.get(roomName) ?? 0;
                        if (nowTs - lastEval < INDICATOR_EVAL_MIN_INTERVAL_MS)
                            continue;
                        _lastIndicatorEvalTs.set(roomName, nowTs);
                        const indicators = await (0, pivotService_1.evaluateIndicators)(tick.symbol, tf, m);
                        if (indicators) {
                            ioServer.to(roomName).emit("indicators", indicators);
                        }
                    }
                }
            }
        }
    });
    // Wire pivot recalculated callback to broadcast fresh levels
    (0, pivotService_1.setOnPivotsUpdated)(async (pivots) => {
        if (!ioServer)
            return;
        // Broadcast levels for each method
        for (const [method, levels] of Object.entries(pivots)) {
            const roomName = `indicators:${levels.symbol}:${levels.timeframe}:${method}`;
            ioServer.to(roomName).emit("pivots", levels);
        }
    });
};
exports.initSocketServer = initSocketServer;
/**
 * Broadcasts option tracker cell ticks for Module 2 sessions
 */
const broadcastTrackerUpdate = (sessionId, data) => {
    if (ioServer) {
        ioServer.to(`tracker:${sessionId}`).emit("tracker_update", data);
    }
};
exports.broadcastTrackerUpdate = broadcastTrackerUpdate;
/**
 * Broadcasts broker connection status to all connected frontend clients.
 * moduleId distinguishes Module 1 (Zebu) from Module 2 (AETRAM) so the
 * frontend can update each module's status independently. Without this,
 * any AETRAM reconnect loop overwrites Module 1's dashboard feed status.
 */
const broadcastBrokerStatus = (status, detail, moduleId = "module1") => {
    if (!ioServer)
        return;
    ioServer.emit("broker_status", { status, moduleId, detail, timestamp: new Date().toISOString() });
    console.log(`[Socket] Broadcast broker_status[${moduleId}]: ${status}${detail ? ` (${detail})` : ""}`);
};
exports.broadcastBrokerStatus = broadcastBrokerStatus;
