import redis from "../config/redis";
import { aggregateOHLC } from "./ohlcAggregator";
import { Tick } from "@stock/shared";
import { ingestModule1OiTick, setModule1OiDataSource } from "./module1OiService";
import { recordTickReceived } from "./monitoringService";
import { startZebuMarketDataFeedWithCredentials, setRuntimeInstrumentTokens } from "./zebuMarketDataClient";
import { broadcastBrokerStatus } from "./socketService";
import { refreshInstrumentTokens } from "./instrumentTokenService";

let zebuClient: { close: () => void } | null = null;

type TickCallback = (tick: Tick) => void;
let onTickReceived: TickCallback | null = null;

export const setOnTickReceived = (callback: TickCallback) => {
  onTickReceived = callback;
};

// ── Reconnection state ────────────────────────────────────────────────────────

let storedUserId: string | null = null;
let storedSessionToken: string | null = null;
let reconnectAttempts = 0;
let reconnectTimer: NodeJS.Timeout | null = null;
let sessionExpired = false;

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY_MS = 4000;

const clearReconnectTimer = () => {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
};

const handleFeedDisconnect = (reason: string) => {
  zebuClient = null;
  setModule1OiDataSource("SIMULATOR");

  if (sessionExpired) return; // don't reconnect on session expiry

  if (!storedUserId || !storedSessionToken) {
    console.warn("[DataFeed] No stored credentials — cannot reconnect.");
    broadcastBrokerStatus("broker-disconnected", reason);
    return;
  }

  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.warn(`[DataFeed] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Stopping.`);
    broadcastBrokerStatus("broker-disconnected", "Max reconnection attempts exceeded");
    storedUserId = null;
    storedSessionToken = null;
    return;
  }

  const delay = RECONNECT_BASE_DELAY_MS * Math.pow(2, reconnectAttempts);
  reconnectAttempts++;
  console.log(`[DataFeed] Reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})…`);
  broadcastBrokerStatus("reconnecting", `Attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`);

  reconnectTimer = setTimeout(async () => {
    if (!storedUserId || !storedSessionToken) return;
    await startDataFeedWithCredentials(storedUserId!, storedSessionToken!);
  }, delay);
};

const handleSessionExpired = () => {
  zebuClient = null;
  sessionExpired = true;
  storedUserId = null;
  storedSessionToken = null;
  clearReconnectTimer();
  setModule1OiDataSource("SIMULATOR");
  console.warn("[DataFeed] Broker session expired — user must re-authenticate.");
  broadcastBrokerStatus("session-expired", "Broker session expired. Please reconnect.");
};

/**
 * Start the live data feed using credentials obtained from user-initiated broker login.
 * Called by module1BrokerLogin controller after successful Zebu QuickAuth.
 */
export const startDataFeedWithCredentials = async (userId: string, sessionToken: string) => {
  // Close any existing connection first
  if (zebuClient) {
    try { zebuClient.close(); } catch {}
    zebuClient = null;
  }
  clearReconnectTimer();

  // Store credentials for auto-reconnection
  storedUserId = userId;
  storedSessionToken = sessionToken;
  sessionExpired = false;
  reconnectAttempts = 0;

  // Always refresh instrument tokens before connecting (handles weekly/monthly expiry)
  console.log("[DataFeed] Refreshing instrument tokens from NFO master...");
  const freshTokens = await refreshInstrumentTokens().catch(() => null);
  if (freshTokens) {
    setRuntimeInstrumentTokens(freshTokens.futToken, freshTokens.ceTokens, freshTokens.peTokens);
    console.log(`[DataFeed] Tokens refreshed — futures expiry: ${freshTokens.futExpiry} | option expiry: ${freshTokens.nearestOptionExpiry}`);
  } else {
    console.warn("[DataFeed] NFO token refresh failed — using .env tokens.");
  }

  console.log(`[DataFeed] Starting live feed for user: ${userId}`);
  setModule1OiDataSource("LIVE_MARKET_API");
  broadcastBrokerStatus("live");

  zebuClient = startZebuMarketDataFeedWithCredentials(
    userId,
    sessionToken,
    processIncomingTick,
    setModule1OiDataSource,
    (reason) => {
      console.warn(`[DataFeed] Feed disconnected: ${reason}`);
      handleFeedDisconnect(reason);
    },
    () => handleSessionExpired(),
  );
};

/**
 * Stop the live feed and clear credentials (called on explicit logout).
 */
export const stopDataFeed = () => {
  clearReconnectTimer();
  storedUserId = null;
  storedSessionToken = null;
  sessionExpired = false;
  reconnectAttempts = 0;
  if (zebuClient) {
    try { zebuClient.close(); } catch {}
    zebuClient = null;
  }
  setModule1OiDataSource("SIMULATOR");
};

// ── Tick processing ───────────────────────────────────────────────────────────

let _totalTickCount = 0;
let _firstTickLogged = false;

export const processIncomingTick = async (tick: Tick) => {
  const { symbol, ltp, oi } = tick;

  _totalTickCount++;

  if (!_firstTickLogged) {
    _firstTickLogged = true;
    console.log(`[Feed] First tick — symbol: ${symbol} ltp: ${ltp} oi: ${oi ?? "—"}`);
  }

  if (_totalTickCount % 100 === 0) {
    console.log(`[Feed] Tick #${_totalTickCount} | symbol: ${symbol} ltp: ${ltp} oi: ${oi ?? "—"}`);
  }

  recordTickReceived();

  await redis.set(`ltp:${symbol}`, ltp.toString());

  if (oi !== undefined) {
    await redis.set(`oi:${symbol}`, oi.toString());
  }

  ingestModule1OiTick(tick);

  if (symbol.endsWith("-FUT") || symbol.includes("FUT")) {
    await aggregateOHLC(tick,   1,   "1m");
    await aggregateOHLC(tick,   2,   "2m");
    await aggregateOHLC(tick,   3,   "3m");
    await aggregateOHLC(tick,   5,   "5m");
    await aggregateOHLC(tick,  10,  "10m");
    await aggregateOHLC(tick,  15,  "15m");
    await aggregateOHLC(tick,  30,  "30m");
    await aggregateOHLC(tick,  45,  "45m");
    await aggregateOHLC(tick,  60,   "1h");
    await aggregateOHLC(tick, 120,   "2h");
    await aggregateOHLC(tick, 180,   "3h");
    await aggregateOHLC(tick, 240,   "4h");
  }

  if (onTickReceived) {
    onTickReceived(tick);
  }
};
