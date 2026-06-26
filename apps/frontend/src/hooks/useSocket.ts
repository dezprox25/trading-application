import { useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { useStore } from "../store/useStore";
import { Tick, Module2Cell, Module2StrikeState } from "@stock/shared";

// In production, Socket.IO must connect to the Render backend, not the Vercel frontend.
// VITE_SOCKET_URL falls back to VITE_API_URL since they share the same server.
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || import.meta.env.VITE_API_URL || "";

export const useSocket = () => {
  const socketRef = useRef<Socket | null>(null);
  const accessToken     = useStore((state) => state.accessToken);
  const updatePrice     = useStore((state) => state.updatePrice);
  const appendTrackerCell = useStore((state) => state.appendTrackerCell);
  const updateFuturesOI   = useStore((state) => state.updateFuturesOI);

  const selectedSymbol  = useStore((state) => state.selectedSymbol);
  const activeSessionId = useStore((state) => state.activeSession?.sessionId);

  // Connect / disconnect on auth state transitions
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

    // Forward raw price ticks into the price cache — no processing
    socket.on("tick", (tick: Tick) => {
      updatePrice(tick.symbol, tick.ltp);
    });

    // Module 2 tracker updates
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

  // Join / leave the selected instrument's tick room when selection changes
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) return;

    socket.emit("join:symbol", selectedSymbol);

    return () => {
      socket.emit("leave:symbol", selectedSymbol);
    };
  }, [selectedSymbol]);

  // Join / leave the Module 2 tracker session room
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
