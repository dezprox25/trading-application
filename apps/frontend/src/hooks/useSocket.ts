import { useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { useStore } from "../store/useStore";
import { useDashStore } from "../modules/dashboard/store";
import { Tick, Module2Cell, Module2StrikeState } from "@stock/shared";
import type { Module1OiMetrics, Module1IndicatorState } from "../store/useStore";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || import.meta.env.VITE_API_URL || "";

function parseIndicatorRoom(room: string): { symbol: string; timeframe: string; method: string } | null {
  const parts = room.split(":");
  if (parts.length < 4) return null;
  return { symbol: parts[1], timeframe: parts[2], method: parts[3] };
}

export const useSocket = () => {
  const socketRef = useRef<Socket | null>(null);

  const accessToken        = useStore((s) => s.accessToken);
  const updatePrice        = useStore((s) => s.updatePrice);
  const appendTrackerCell  = useStore((s) => s.appendTrackerCell);
  const updateFuturesOI    = useStore((s) => s.updateFuturesOI);
  const setOiMetrics       = useStore((s) => s.setOiMetrics);
  const setModule1IndicatorState = useStore((s) => s.setModule1IndicatorState);

  const selectedSymbol     = useStore((s) => s.selectedSymbol);
  const activeSessionId    = useStore((s) => s.activeSession?.sessionId);
  const module1IndicatorRoom = useStore((s) => s.module1IndicatorRoom);

  const prevIndicatorRoomRef = useRef<string | null>(null);

  // ── Connect / disconnect on auth state change ──────────────────────────────
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
      // Update dashboard status to live on successful (re)connect
      const dash = useDashStore.getState();
      if (dash.feedStatus === "reconnecting" || dash.feedStatus === "no-network") {
        // Don't override — let broker_status event set the final state
      }

      // Always subscribe to core instruments for live Spot/Future display.
      // These are permanent — independent of Generate or any config selection.
      socket.emit("join:symbol", "NIFTY-SPOT");
      socket.emit("join:symbol", "NIFTY-FUT");

      // Re-subscribe to all active rooms on reconnect
      socket.emit("join:symbol", selectedSymbol);
      if (activeSessionId) socket.emit("join:tracker", activeSessionId);

      const room = module1IndicatorRoom;
      if (room) {
        const parsed = parseIndicatorRoom(room);
        if (parsed) socket.emit("join:indicators", parsed);
      }
    });

    socket.on("connect_error", (err) => {
      console.error("[Socket] Connection error:", err.message);
    });

    socket.on("disconnect", (reason) => {
      console.log("[Socket] Disconnected — reason:", reason);
      // Only update to no-network for transport-level disconnects
      if (reason === "transport close" || reason === "transport error") {
        const dash = useDashStore.getState();
        if (dash.feedStatus === "live") {
          useDashStore.getState().setFeedStatus("no-network");
        }
      }
    });

    // Raw price ticks → price cache
    socket.on("tick", (tick: Tick) => {
      updatePrice(tick.symbol, tick.ltp);
    });

    // Module 1 OI matrix
    socket.on("latest-oi", (data: Module1OiMetrics) => {
      setOiMetrics(data);
    });

    // Module 1 indicator state
    socket.on("indicators", (data: Module1IndicatorState) => {
      setModule1IndicatorState(data);
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

    // Broker connection status from backend
    socket.on("broker_status", (data: { status: string; detail?: string }) => {
      console.log("[Socket] broker_status:", data.status, data.detail || "");

      // Update Module 2 broker status in store
      const { setModule2BrokerStatus } = useStore.getState();
      const s = data.status as "live" | "broker-disconnected" | "session-expired" | "reconnecting";
      setModule2BrokerStatus(s === "live" ? null : s);

      // Update Module 1 dashboard feed status.
      // Always propagate so the status indicator is accurate regardless of
      // whether Generate has been clicked.
      const dash = useDashStore.getState();
      switch (data.status) {
        case "live":
          if (
            dash.feedStatus === "reconnecting" ||
            dash.feedStatus === "broker-disconnected" ||
            dash.feedStatus === "idle"
          ) {
            dash.setFeedStatus("live");
          }
          break;
        case "reconnecting":
          dash.setFeedStatus("reconnecting");
          break;
        case "broker-disconnected":
          dash.setFeedStatus("broker-disconnected");
          break;
        case "session-expired":
          dash.setFeedStatus("session-expired");
          break;
      }
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [accessToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Join / leave selected instrument tick room ─────────────────────────────
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) return;

    socket.emit("join:symbol", selectedSymbol);
    return () => {
      socket.emit("leave:symbol", selectedSymbol);
    };
  }, [selectedSymbol]);

  // ── Re-subscribe core instruments after any symbol change ──────────────────
  // The selectedSymbol cleanup above may have sent a leave for NIFTY-FUT if
  // the user changed away from it. Re-join both core symbols to ensure the
  // Spot/Future live display is never interrupted by config changes.
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket?.connected) return;
    socket.emit("join:symbol", "NIFTY-SPOT");
    socket.emit("join:symbol", "NIFTY-FUT");
  }, [selectedSymbol]);

  // ── Join / leave Module 1 indicator room ──────────────────────────────────
  useEffect(() => {
    const socket = socketRef.current;
    const prev = prevIndicatorRoomRef.current;
    const next = module1IndicatorRoom;

    if (socket?.connected) {
      if (prev && prev !== next) {
        const parsed = parseIndicatorRoom(prev);
        if (parsed) socket.emit("leave:indicators", parsed);
      }
      if (next && next !== prev) {
        const parsed = parseIndicatorRoom(next);
        if (parsed) socket.emit("join:indicators", parsed);
      }
    }

    prevIndicatorRoomRef.current = next;
  }, [module1IndicatorRoom]);

  // ── Join / leave Module 2 tracker session room ────────────────────────────
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
