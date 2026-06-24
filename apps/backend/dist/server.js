"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.io = exports.server = exports.app = void 0;
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const socket_io_1 = require("socket.io");
const dotenv_1 = __importDefault(require("dotenv"));
// Load configuration parameters
dotenv_1.default.config();
const db_1 = require("./config/db");
const redis_1 = __importDefault(require("./config/redis"));
const auth_1 = __importDefault(require("./routes/auth"));
const market_1 = __importDefault(require("./routes/market"));
const tracker_1 = __importDefault(require("./routes/tracker"));
const module2_1 = __importDefault(require("./routes/module2"));
const zebuOAuth_1 = require("./controllers/zebuOAuth");
const pivotService_1 = require("./services/pivotService");
const socketService_1 = require("./services/socketService");
const trackerService_1 = require("./services/trackerService");
const module1OiService_1 = require("./services/module1OiService");
const monitoringService_1 = require("./services/monitoringService");
const app = (0, express_1.default)();
exports.app = app;
const server = http_1.default.createServer(app);
exports.server = server;
// Configure socket server base
const io = new socket_io_1.Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST", "PUT"],
        credentials: true,
    },
    pingTimeout: 60000,
});
exports.io = io;
// Security & utility middlewares
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)({
    origin: "*",
    credentials: true,
}));
app.use(express_1.default.json());
// Global Rate Limiter
const globalLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 200,
    message: { error: "Too many requests, please try again later." },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use("/api/", globalLimiter);
app.get("/api/module1/zebu/oauth/callback", zebuOAuth_1.zebuOAuthCallback);
app.get("/api/module1/zebu/oauth/status", zebuOAuth_1.getZebuOAuthStatusEndpoint);
// Module 1 Config Endpoint
app.get("/module1/config", (_req, res) => {
    res.json({
        symbols: ["NIFTY-FUT", "NIFTY-SPOT"],
        timeframes: ["1m", "3m", "5m"],
        pivotMethods: ["classic", "camarilla", "fibonacci"],
        defaultSymbol: "NIFTY-FUT",
        defaultTimeframe: "5m",
        defaultMethod: "classic",
    });
});
app.get("/api/module1/config", (_req, res) => {
    res.json({
        symbols: ["NIFTY-FUT", "NIFTY-SPOT"],
        timeframes: ["1m", "3m", "5m"],
        pivotMethods: ["classic", "camarilla", "fibonacci"],
        defaultSymbol: "NIFTY-FUT",
        defaultTimeframe: "5m",
        defaultMethod: "classic",
    });
});
// Mount authentication router
app.use("/auth", auth_1.default);
app.use("/api/auth", auth_1.default);
// Mount market and tracker routers
app.use("/api", market_1.default);
app.use("/api/module2", tracker_1.default);
app.use("/api/module2", module2_1.default);
// Health Check Endpoint
app.get("/health", async (_req, res) => {
    const mongoStatus = mongooseConnectionStatus();
    let redisStatus = "disconnected";
    try {
        await redis_1.default.ping();
        redisStatus = "connected";
    }
    catch (err) {
        redisStatus = "error";
    }
    const monitoring = await (0, monitoringService_1.getMonitoringStatus)();
    res.json({
        status: monitoring.status === "OK" ? "healthy" : "warning",
        timestamp: new Date(),
        services: {
            mongodb: mongoStatus,
            redis: redisStatus,
        },
        monitoring,
    });
});
// Mongoose connection status resolver
function mongooseConnectionStatus() {
    const states = {
        0: "disconnected",
        1: "connected",
        2: "connecting",
        3: "disconnecting",
    };
    const mongoose = require("mongoose");
    return states[mongoose.connection.readyState] || "unknown";
}
// Global Error Handler
app.use((err, _req, res, _next) => {
    console.error("Unhandled Application Error:", err);
    res.status(500).json({
        error: "Internal Server Error",
        message: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
});
const PORT = process.env.PORT || 5001;
const startServer = async () => {
    // ── Step 1: Connect databases ─────────────────────────────────────────────
    // All services that use MongoDB or Redis must wait until these are ready.
    let dbReady = false;
    try {
        await (0, db_1.connectDB)();
        dbReady = true;
        console.log("[Server] MongoDB connected.");
    }
    catch (error) {
        if (process.env.NODE_ENV === "production") {
            console.error("Fatal: MongoDB could not be contacted:", error);
            throw error;
        }
        console.warn("[MongoDB] Database unavailable in development mode. Using in-memory fallbacks.");
    }
    try {
        await redis_1.default.ping();
        console.log("[Server] Redis connected.");
    }
    catch (error) {
        if (process.env.NODE_ENV === "production") {
            console.error("Fatal: Redis cache could not be contacted:", error);
            throw new Error("Redis connection failed.");
        }
        console.warn("[Redis] Redis unavailable in development mode.");
    }
    // ── Step 2: Initialize infrastructure (no DB queries here) ───────────────
    (0, pivotService_1.initPivotService)();
    (0, socketService_1.initSocketServer)(io);
    // ── Step 3: Initialize services that depend on DB being ready ────────────
    // Only start these after the DB connection is confirmed.
    if (dbReady) {
        try {
            (0, trackerService_1.initTrackerEngine)();
        }
        catch (err) {
            console.warn("[Server] TrackerEngine init warning:", err);
        }
    }
    else {
        console.warn("[Server] Skipping TrackerEngine init — DB not ready.");
    }
    // Warm up in-memory OI state from Redis (safe to run even if Redis is offline)
    try {
        await (0, module1OiService_1.initModule1OiService)();
    }
    catch (err) {
        console.warn("[Server] Module1OiService init warning:", err);
    }
    // ── Step 4: Start monitoring ──────────────────────────────────────────────
    (0, monitoringService_1.startMonitoringLoop)();
    // ── Step 5: Start HTTP + WebSocket server ────────────────────────────────
    server.listen(PORT, () => {
        console.log(`[Server] TradePro backend ready on port ${PORT} (${process.env.NODE_ENV || "development"}).`);
        console.log("[Server] Broker data feeds will start after user authentication.");
    });
    // ── NOTE: Broker authentication is NOT performed here ────────────────────
    // initDataFeed()              ← REMOVED: starts after Module 1 user login
    // initAetramMarketDataService() ← REMOVED: starts after Module 2 user login
    // Data feeds begin only when the user authenticates via:
    //   POST /auth/module1-broker-login
    //   POST /auth/module2-broker-login
};
startServer().catch((error) => {
    console.error("Fatal: Backend server failed to start:", error);
    process.exit(1);
});
