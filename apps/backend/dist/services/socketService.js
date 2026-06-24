"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.broadcastTrackerUpdate = exports.initSocketServer = void 0;
const token_1 = require("../utils/token");
const dataFeed_1 = require("./dataFeed");
const pivotService_1 = require("./pivotService");
const module1OiService_1 = require("./module1OiService");
let ioServer = null;
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
        // 1. Join room to receive raw price ticks for a specific symbol
        socket.on("join:symbol", (symbol) => {
            socket.join(`market:${symbol}`);
            console.log(`[Socket] Client ${socket.id} subscribed to market ticks: ${symbol}`);
        });
        socket.on("leave:symbol", (symbol) => {
            socket.leave(`market:${symbol}`);
            console.log(`[Socket] Client ${socket.id} unsubscribed from market ticks: ${symbol}`);
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
        });
    });
    // Wire tick ingestion callback to broadcast raw price updates and trigger real-time indicator updates
    (0, dataFeed_1.setOnTickReceived)(async (tick) => {
        if (!ioServer)
            return;
        // Broadcast raw tick to market room
        ioServer.to(`market:${tick.symbol}`).emit("tick", tick);
        // Broadcast latest computed OI metrics to all clients on every tick ingestion
        ioServer.emit("latest-oi", (0, module1OiService_1.getLatestModule1OiMetrics)());
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
