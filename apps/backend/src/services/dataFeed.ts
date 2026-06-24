import redis from "../config/redis";
import { aggregateOHLC } from "./ohlcAggregator";
import { Tick } from "@stock/shared";
import { ingestModule1OiTick, setModule1OiDataSource } from "./module1OiService";
import { recordTickReceived } from "./monitoringService";
import { startZebuMarketDataFeedWithCredentials } from "./zebuMarketDataClient";

let zebuClient: { close: () => void } | null = null;
let isMockActive = false;

type TickCallback = (tick: Tick) => void;
let onTickReceived: TickCallback | null = null;

export const setOnTickReceived = (callback: TickCallback) => {
  onTickReceived = callback;
};

/**
 * Start the live data feed using credentials obtained from user-initiated broker login.
 * Called by module1BrokerLogin controller after successful Zebu QuickAuth.
 * Never called automatically on server startup.
 */
export const startDataFeedWithCredentials = (userId: string, sessionToken: string) => {
  // Close any existing connection first
  if (zebuClient) {
    try { zebuClient.close(); } catch {}
    zebuClient = null;
  }
  isMockActive = false;

  console.log(`[DataFeed] Starting live feed for user: ${userId}`);
  setModule1OiDataSource("LIVE_MARKET_API");

  zebuClient = startZebuMarketDataFeedWithCredentials(
    userId,
    sessionToken,
    processIncomingTick,
    setModule1OiDataSource,
    (reason) => {
      console.warn(`[DataFeed] Live feed disconnected: ${reason}. No automatic fallback.`);
      zebuClient = null;
      setModule1OiDataSource("SIMULATOR");
    }
  );
};

/**
 * Handles caching and candle aggregation for each incoming tick.
 * Unchanged from original — do not modify this function.
 */
let _totalTickCount = 0;
let _firstTickLogged = false;

export const processIncomingTick = async (tick: Tick) => {
  const { symbol, ltp, oi } = tick;

  _totalTickCount++;

  if (!_firstTickLogged) {
    _firstTickLogged = true;
    console.log(`[Feed] First tick received — symbol: ${symbol} ltp: ${ltp} oi: ${oi ?? "—"}`);
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
    await aggregateOHLC(tick, 1, "1m");
    await aggregateOHLC(tick, 3, "3m");
    await aggregateOHLC(tick, 5, "5m");

    try {
      const customTf = await redis.get("config:custom_timeframe");
      if (customTf && customTf.endsWith("m")) {
        const minutes = parseInt(customTf);
        if (minutes > 0 && minutes !== 1 && minutes !== 3 && minutes !== 5) {
          await aggregateOHLC(tick, minutes, customTf);
        }
      }
    } catch {}
  }

  if (onTickReceived) {
    onTickReceived(tick);
  }
};
