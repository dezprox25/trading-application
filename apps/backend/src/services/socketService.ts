import { Server, Socket } from "socket.io";
import { verifyAccessToken } from "../utils/token";
import { setOnTickReceived } from "./dataFeed";
import { setOnPivotsUpdated, evaluateIndicators } from "./pivotService";
import { Tick, PivotLevels } from "@stock/shared";
import { getLatestModule1OiMetrics } from "./module1OiService";
import { isZebuLiveConnected } from "./zebuMarketDataClient";

let ioServer: Server | null = null;

/**
 * Initialize Socket.io server with JWT authentication and room handlers
 */
export const initSocketServer = (io: Server) => {
  ioServer = io;

  // Connection authentication middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;

    if (!token || typeof token !== "string") {
      return next(new Error("Authentication failed: Access token missing"));
    }

    try {
      const decoded = verifyAccessToken(token);
      socket.data.userId = decoded.userId;
      next();
    } catch (err) {
      return next(new Error("Authentication failed: Access token invalid or expired"));
    }
  });

  io.on("connection", (socket: Socket) => {
    console.log(`[Socket] Client connected: ${socket.id} (User: ${socket.data.userId})`);

    // Send initial latest OI metrics immediately on connection
    socket.emit("latest-oi", getLatestModule1OiMetrics());

    // Immediately tell this client the current Zebu broker connection state so
    // it doesn't have to wait for the next broadcast event.
    const currentBrokerStatus = isZebuLiveConnected() ? "live" : "broker-disconnected";
    socket.emit("broker_status", { status: currentBrokerStatus, timestamp: new Date().toISOString() });
    console.log(`[Socket] Sent initial broker_status="${currentBrokerStatus}" to ${socket.id}`);

    // 1. Join room to receive raw price ticks for a specific symbol
    socket.on("join:symbol", (symbol: string) => {
      socket.join(`market:${symbol}`);
      console.log(`[Socket] Client ${socket.id} subscribed to market ticks: ${symbol}`);
    });

    socket.on("leave:symbol", (symbol: string) => {
      socket.leave(`market:${symbol}`);
      console.log(`[Socket] Client ${socket.id} unsubscribed from market ticks: ${symbol}`);
    });

    // 2. Join room to receive real-time indicators (Call/Put signals)
    socket.on(
      "join:indicators",
      async (data: { symbol: string; timeframe: string; method: "classic" | "camarilla" | "fibonacci" }) => {
        const { symbol, timeframe, method } = data;
        const roomName = `indicators:${symbol}:${timeframe}:${method}`;
        socket.join(roomName);
        console.log(`[Socket] Client ${socket.id} subscribed to indicators: ${roomName}`);

        // Push initial indicator state immediately on join
        const indicators = await evaluateIndicators(symbol, timeframe, method);
        if (indicators) {
          socket.emit("indicators", indicators);
        }
      }
    );

    socket.on(
      "leave:indicators",
      (data: { symbol: string; timeframe: string; method: "classic" | "camarilla" | "fibonacci" }) => {
        const { symbol, timeframe, method } = data;
        const roomName = `indicators:${symbol}:${timeframe}:${method}`;
        socket.leave(roomName);
        console.log(`[Socket] Client ${socket.id} unsubscribed from indicators: ${roomName}`);
      }
    );

    // 3. Join room to receive option strike per-minute tracker updates
    socket.on("join:tracker", (sessionId: string) => {
      socket.join(`tracker:${sessionId}`);
      console.log(`[Socket] Client ${socket.id} subscribed to option tracker session: ${sessionId}`);
    });

    socket.on("leave:tracker", (sessionId: string) => {
      socket.leave(`tracker:${sessionId}`);
      console.log(`[Socket] Client ${socket.id} unsubscribed from option tracker session: ${sessionId}`);
    });

    socket.on("disconnect", () => {
      console.log(`[Socket] Client disconnected: ${socket.id}`);
    });
  });

  let _socketEmitCount = 0;

  // Wire tick ingestion callback to broadcast raw price updates and trigger real-time indicator updates
  setOnTickReceived(async (tick: Tick) => {
    if (!ioServer) return;

    // Broadcast raw tick to market room
    ioServer.to(`market:${tick.symbol}`).emit("tick", tick);

    // Broadcast latest computed OI metrics to all clients on every tick ingestion
    const oiMetrics = getLatestModule1OiMetrics();
    ioServer.emit("latest-oi", oiMetrics);
    _socketEmitCount++;

    // Log socket emit stats every 100 ticks
    if (_socketEmitCount % 100 === 0) {
      const connectedClients = ioServer.sockets.sockets.size;
      console.log(`[Socket] Emit #${_socketEmitCount} | Event: latest-oi | Clients: ${connectedClients} | c_tl: ${oiMetrics.c_tl} | p_tl: ${oiMetrics.p_tl}`);
    }

    // If this is NIFTY-FUT, trigger indicator evaluations for any active rooms listening to this symbol
    if (tick.symbol === "NIFTY-FUT") {
      const timeframes = ["1m", "3m", "5m", "custom"];
      const methods = ["classic", "camarilla", "fibonacci"] as const;

      for (const tf of timeframes) {
        for (const m of methods) {
          const roomName = `indicators:${tick.symbol}:${tf}:${m}`;
          
          // Only compute and emit if there are active sockets connected to this room
          const clients = ioServer.sockets.adapter.rooms.get(roomName);
          if (clients && clients.size > 0) {
            const indicators = await evaluateIndicators(tick.symbol, tf, m);
            if (indicators) {
              ioServer.to(roomName).emit("indicators", indicators);
            }
          }
        }
      }
    }
  });

  // Wire pivot recalculated callback to broadcast fresh levels
  setOnPivotsUpdated(async (pivots: Record<string, PivotLevels>) => {
    if (!ioServer) return;

    // Broadcast levels for each method
    for (const [method, levels] of Object.entries(pivots)) {
      const roomName = `indicators:${levels.symbol}:${levels.timeframe}:${method}`;
      ioServer.to(roomName).emit("pivots", levels);
    }
  });
};

/**
 * Broadcasts option tracker cell ticks for Module 2 sessions
 */
export const broadcastTrackerUpdate = (sessionId: string, data: any) => {
  if (ioServer) {
    ioServer.to(`tracker:${sessionId}`).emit("tracker_update", data);
  }
};

export type BrokerStatus =
  | "live"
  | "reconnecting"
  | "broker-disconnected"
  | "session-expired";

/**
 * Broadcasts broker connection status to all connected frontend clients.
 * Used by dataFeed to push real-time connection state changes.
 */
export const broadcastBrokerStatus = (status: BrokerStatus, detail?: string) => {
  if (!ioServer) return;
  ioServer.emit("broker_status", { status, detail, timestamp: new Date().toISOString() });
  console.log(`[Socket] Broadcast broker_status: ${status}${detail ? ` (${detail})` : ""}`);
};
