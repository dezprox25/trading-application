import { useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { useStore } from "../store/useStore";
import { Tick, PivotLevels, Module1Indicators, Module2Cell, Module2StrikeState } from "@stock/shared";

// In production, Socket.IO must connect to the Render backend, not the Vercel frontend.
// VITE_SOCKET_URL falls back to VITE_API_URL since they share the same server.
// In development both are undefined and the no-URL form uses Vite's /socket.io proxy.
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || import.meta.env.VITE_API_URL || "";

export const useSocket = () => {
  const socketRef = useRef<Socket | null>(null);
  const accessToken = useStore((state) => state.accessToken);
  const updatePrice = useStore((state) => state.updatePrice);
  const setPivots = useStore((state) => state.setPivots);
  const setIndicators = useStore((state) => state.setIndicators);
  const appendTrackerCell = useStore((state) => state.appendTrackerCell);
  const updateFuturesOI = useStore((state) => state.updateFuturesOI);
  const setLatestOiMetrics = useStore((state) => state.setLatestOiMetrics);

  const selectedSymbol = useStore((state) => state.selectedSymbol);
  const selectedTimeframe = useStore((state) => state.selectedTimeframe);
  const selectedMethod = useStore((state) => state.selectedMethod);
  const activeSessionId = useStore((state) => state.activeSession?.sessionId);

  useEffect(() => {
    if (!accessToken) {
      if (socketRef.current) {
        console.log("[Socket] Disconnecting — no access token");
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      return;
    }

    console.log("[Socket] Connecting to server (token present)...");
    const socketOpts = {
      auth: { token: accessToken },
      reconnectionAttempts: 10,
      reconnectionDelay: 3000,
    };
    const socket = SOCKET_URL ? io(SOCKET_URL, socketOpts) : io(socketOpts);

    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("[Socket] Connected — ID:", socket.id);
      socket.emit("join:symbol", selectedSymbol);
      socket.emit("join:symbol", "NIFTY-SPOT");
      socket.emit("join:indicators", {
        symbol: selectedSymbol,
        timeframe: selectedTimeframe,
        method: selectedMethod,
      });
      if (activeSessionId) {
        socket.emit("join:tracker", activeSessionId);
      }
    });

    socket.on("connect_error", (err) => {
      console.error("[Socket] Connection error:", err.message);
    });

    socket.on("disconnect", (reason) => {
      console.log("[Socket] Disconnected — reason:", reason);
    });

    // Handle raw price ticks
    socket.on("tick", (tick: Tick) => {
      updatePrice(tick.symbol, tick.ltp);
    });

    // Handle pivot updates
    socket.on("pivots", (levels: PivotLevels) => {
      setPivots(levels.symbol, levels.timeframe, levels.method, levels);
    });

    // Handle indicator (Call/Put signal) updates
    socket.on("indicators", (signal: Module1Indicators) => {
      setIndicators(signal.symbol, selectedTimeframe, selectedMethod, signal);
    });

    let latestOiCount = 0;
    socket.on("latest-oi", (metrics: any) => {
      latestOiCount++;
      if (latestOiCount === 1 || latestOiCount % 50 === 0) {
        console.log(`[Socket] latest-oi event #${latestOiCount} received — c_tl: ${metrics?.c_tl} | p_tl: ${metrics?.p_tl}`);
      }
      setLatestOiMetrics(metrics);
    });

    socket.on(
      "tracker_update",
      (data: { strike?: string; cell?: Module2Cell; state?: Partial<Module2StrikeState>; futuresOI?: any }) => {
        if (data.strike && data.cell && data.state) {
          appendTrackerCell(data.strike, data.cell, data.state);
        }
        if (data.futuresOI) {
          updateFuturesOI(data.futuresOI);
        }
      }
    );

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [accessToken]); // Recreate socket instance on auth state transitions

  // React to changes in Module 1 selections and handle room subscriptions
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) return;

    // Join new symbol ticks
    socket.emit("join:symbol", selectedSymbol);
    socket.emit("join:symbol", "NIFTY-SPOT");

    // Join new indicators room
    socket.emit("join:indicators", {
      symbol: selectedSymbol,
      timeframe: selectedTimeframe,
      method: selectedMethod
    });

    return () => {
      socket.emit("leave:symbol", selectedSymbol);
      socket.emit("leave:symbol", "NIFTY-SPOT");
      socket.emit("leave:indicators", {
        symbol: selectedSymbol,
        timeframe: selectedTimeframe,
        method: selectedMethod
      });
    };
  }, [selectedSymbol, selectedTimeframe, selectedMethod]);

  // React to Module 2 session start/change to register tracker rooms
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !socket.connected || !activeSessionId) return;

    socket.emit("join:tracker", activeSessionId);

    return () => {
      socket.emit("leave:tracker", activeSessionId);
    };
  }, [activeSessionId]);

  return socketRef.current;
};
