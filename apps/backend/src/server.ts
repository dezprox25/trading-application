import express from "express";
import http from "http";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { Server } from "socket.io";
import dotenv from "dotenv";

// Load configuration parameters
dotenv.config();

import { connectDB } from "./config/db";
import redis from "./config/redis";
import authRouter from "./routes/auth";
import marketRouter from "./routes/market";
import trackerRouter from "./routes/tracker";
import module2Router from "./routes/module2";
import { getZebuOAuthStatusEndpoint, zebuOAuthCallback } from "./controllers/zebuOAuth";
import { initPivotService } from "./services/pivotService";
import { initSocketServer } from "./services/socketService";
import { initTrackerEngine } from "./services/trackerService";
import { initModule1OiService } from "./services/module1OiService";
import { startMonitoringLoop, getMonitoringStatus } from "./services/monitoringService";

const app = express();
const server = http.createServer(app);

// Configure socket server base
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT"],
    credentials: true,
  },
  pingTimeout: 60000,
});

// Security & utility middlewares
app.use(helmet());

app.use(
  cors({
    origin: "*",
    credentials: true,
  })
);

app.use(express.json());

// Global Rate Limiter
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: "Too many requests, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api/", globalLimiter);

app.get("/api/module1/zebu/oauth/callback", zebuOAuthCallback);
app.get("/api/module1/zebu/oauth/status", getZebuOAuthStatusEndpoint);

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
app.use("/auth", authRouter);
app.use("/api/auth", authRouter);

// Mount market and tracker routers
app.use("/api", marketRouter);
app.use("/api/module2", trackerRouter);
app.use("/api/module2", module2Router);

// Health Check Endpoint
app.get("/health", async (_req, res) => {
  const mongoStatus = mongooseConnectionStatus();
  let redisStatus = "disconnected";

  try {
    await redis.ping();
    redisStatus = "connected";
  } catch (err) {
    redisStatus = "error";
  }

  const monitoring = await getMonitoringStatus();

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
  const states: Record<number, string> = {
    0: "disconnected",
    1: "connected",
    2: "connecting",
    3: "disconnecting",
  };

  const mongoose = require("mongoose");
  return states[mongoose.connection.readyState] || "unknown";
}

// Global Error Handler
app.use(
  (
    err: any,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error("Unhandled Application Error:", err);

    res.status(500).json({
      error: "Internal Server Error",
      message: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
);

const PORT = process.env.PORT || 5001;

const startServer = async () => {
  // ── Step 1: Connect databases ─────────────────────────────────────────────
  // All services that use MongoDB or Redis must wait until these are ready.

  let dbReady = false;
  try {
    await connectDB();
    dbReady = true;
    console.log("[Server] MongoDB connected.");
  } catch (error) {
    if (process.env.NODE_ENV === "production") {
      console.error("Fatal: MongoDB could not be contacted:", error);
      throw error;
    }
    console.warn("[MongoDB] Database unavailable in development mode. Using in-memory fallbacks.");
  }

  try {
    await redis.ping();
    console.log("[Server] Redis connected.");
  } catch (error) {
    if (process.env.NODE_ENV === "production") {
      console.error("Fatal: Redis cache could not be contacted:", error);
      throw new Error("Redis connection failed.");
    }
    console.warn("[Redis] Redis unavailable in development mode.");
  }

  // ── Step 2: Initialize infrastructure (no DB queries here) ───────────────
  initPivotService();
  initSocketServer(io);

  // ── Step 3: Initialize services that depend on DB being ready ────────────
  // Only start these after the DB connection is confirmed.
  if (dbReady) {
    try {
      initTrackerEngine();
    } catch (err) {
      console.warn("[Server] TrackerEngine init warning:", err);
    }
  } else {
    console.warn("[Server] Skipping TrackerEngine init — DB not ready.");
  }

  // Warm up in-memory OI state from Redis (safe to run even if Redis is offline)
  try {
    await initModule1OiService();
  } catch (err) {
    console.warn("[Server] Module1OiService init warning:", err);
  }

  // ── Step 4: Start monitoring ──────────────────────────────────────────────
  startMonitoringLoop();

  // ── Step 5: Start HTTP + WebSocket server ────────────────────────────────
  server.listen(PORT, () => {
    console.log(
      `[Server] TradePro backend ready on port ${PORT} (${process.env.NODE_ENV || "development"}).`
    );
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

export { app, server, io };
