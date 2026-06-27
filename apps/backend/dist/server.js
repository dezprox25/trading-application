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
// Load configuration parameters — must be first so all subsequent imports see env vars.
// On Render (production) there is no .env file; env vars are injected by the platform.
dotenv_1.default.config();
const startupCheck_1 = require("./utils/startupCheck");
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
const dataFeed_1 = require("./services/dataFeed");
const app = (0, express_1.default)();
exports.app = app;
const server = http_1.default.createServer(app);
exports.server = server;
// Trust reverse proxy headers (required for express-rate-limit on Render / Heroku / etc.)
app.set("trust proxy", 1);
// CORS allowed origin: restrict to frontend domain in production
const allowedOrigin = process.env.FRONTEND_URL || "*";
// Configure socket server base.
// transports: start with polling so the Render proxy can establish the connection,
// then upgrade to WebSocket. pingInterval/pingTimeout keep the connection alive
// through Render's 60-second idle proxy timeout.
const io = new socket_io_1.Server(server, {
    cors: {
        origin: allowedOrigin,
        methods: ["GET", "POST", "PUT"],
        credentials: true,
    },
    transports: ["polling", "websocket"],
    pingInterval: 25000,
    pingTimeout: 60000,
});
exports.io = io;
// Security & utility middlewares
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)({
    origin: allowedOrigin,
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
    // ── Step 0: Startup validation ────────────────────────────────────────────
    // Validates all required environment variables and logs structured startup
    // status for each service. Exits with code 1 in production if critical
    // variables are missing (JWT_SECRET, FRONTEND_URL).
    (0, startupCheck_1.runStartupCheck)();
    // ── Step 1: Connect databases ─────────────────────────────────────────────
    // All services that use MongoDB or Redis must wait until these are ready.
    let dbReady = false;
    try {
        await (0, db_1.connectDB)();
        dbReady = true;
        console.log("[Server] MongoDB connected.");
    }
    catch (error) {
        console.error("[Server] MongoDB connection failed:", error?.message || error);
        if (process.env.NODE_ENV === "production") {
            // In production crash fast — Render will restart the service.
            // A running server with no database is worse than a clean restart.
            console.error("[Server] Aborting: MongoDB is required in production.");
            throw error;
        }
        console.warn("[Server] Running in development mode — continuing with in-memory fallbacks.");
    }
    try {
        await redis_1.default.ping();
        console.log("[Server] Redis connected.");
    }
    catch (error) {
        if (process.env.NODE_ENV === "production") {
            // Redis uses an in-memory fallback (see config/redis.ts) — log but continue.
            // The fallback loses data on restart; all ltp/oi prices must be re-populated
            // from live ticks. This is acceptable for market-hours operation.
            console.warn("[Server] Redis unreachable — continuing with in-memory fallback. LTP/OI data will not persist across restarts.");
        }
        else {
            console.warn("[Server] Redis unavailable in development mode — using in-memory fallback.");
        }
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
        console.log(`[Server] CORS origin: ${allowedOrigin}`);
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
// ── Graceful shutdown ─────────────────────────────────────────────────────────
// Render sends SIGTERM before terminating containers. Close cleanly so in-flight
// requests finish and connections drain before the process exits.
const shutdown = (signal) => {
    console.log(`[Server] Received ${signal}. Shutting down gracefully…`);
    server.close(async () => {
        console.log("[Server] HTTP server closed.");
        (0, monitoringService_1.stopMonitoringLoop)();
        (0, dataFeed_1.stopDataFeed)();
        try {
            const mongoose = require("mongoose");
            await mongoose.connection.close();
            console.log("[Server] MongoDB connection closed.");
        }
        catch { }
        console.log("[Server] Shutdown complete.");
        process.exit(0);
    });
    // Force-kill if graceful shutdown takes more than 15 seconds
    setTimeout(() => {
        console.error("[Server] Graceful shutdown timed out — forcing exit.");
        process.exit(1);
    }, 15000);
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
