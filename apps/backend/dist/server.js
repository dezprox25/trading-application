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
const dataFeed_1 = require("./services/dataFeed");
const socketService_1 = require("./services/socketService");
const trackerService_1 = require("./services/trackerService");
const aetramMarketDataService_1 = require("./services/aetramMarketDataService");
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
    // Establish MongoDB Atlas Connection
    try {
        await (0, db_1.connectDB)();
    }
    catch (error) {
        if (process.env.NODE_ENV === "production") {
            console.error("Fatal: MongoDB could not be contacted:", error);
            throw error;
        }
        console.warn("[MongoDB] Warning: database unavailable in development mode. Continuing with in-memory/demo flows.");
    }
    // Validate Redis Connection
    try {
        const redisPingResult = await redis_1.default.ping();
        console.log("Redis cache ping successful:", redisPingResult);
    }
    catch (error) {
        if (process.env.NODE_ENV === "production") {
            console.error("Fatal: Redis cache could not be contacted:", error);
            throw new Error("Redis connection failed. Redis is a hard dependency in production.");
        }
        else {
            console.warn("[Redis] Warning: Redis cache could not be contacted in development mode. Continuing server startup.");
        }
    }
    // Initialize core trading services
    (0, pivotService_1.initPivotService)();
    (0, socketService_1.initSocketServer)(io);
    (0, trackerService_1.initTrackerEngine)();
    (0, aetramMarketDataService_1.initAetramMarketDataService)();
    // Warm up OI cache from Redis before launching live data feed listeners
    await (0, module1OiService_1.initModule1OiService)();
    (0, dataFeed_1.initDataFeed)();
    // Start feed validation and monitoring check loop
    (0, monitoringService_1.startMonitoringLoop)();
    // Start HTTP / WebSocket Server
    server.listen(PORT, () => {
        console.log(`[Server] Live Trading Display Dashboard listening on port ${PORT} in ${process.env.NODE_ENV || "development"} mode.`);
    });
};
startServer().catch((error) => {
    console.error("Fatal: Backend server failed to start:", error);
    process.exit(1);
});
