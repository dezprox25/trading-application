import { FuturesOHLC } from "../models/FuturesOHLC";
import { Tick, Candle } from "@stock/shared";
import redis from "../config/redis";

// Local cache for active candles: activeCandles[symbol][timeframe]
const activeCandles: Record<string, Record<string, Candle>> = {};

const getTimeframeMinutes = async (tfStr: string): Promise<number> => {
  if (tfStr === "1m") return 1;
  if (tfStr === "3m") return 3;
  if (tfStr === "5m") return 5;
  if (tfStr === "custom") {
    try {
      const customTf = await redis.get("config:custom_timeframe");
      if (customTf && customTf.endsWith("m")) {
        const mins = parseInt(customTf);
        if (mins > 0) return mins;
      }
    } catch {
      // Ignore Redis offline/read errors
    }
    return 10; // Default fallback for custom
  }
  const mins = parseInt(tfStr);
  return isNaN(mins) || mins <= 0 ? 5 : mins;
};

// Start a proactive checker loop on startup/module load
const startBoundaryChecker = () => {
  setInterval(async () => {
    const now = Date.now();
    for (const symbol of Object.keys(activeCandles)) {
      for (const tfStr of Object.keys(activeCandles[symbol])) {
        const candle = activeCandles[symbol][tfStr];
        if (!candle) continue;

        const tfMins = await getTimeframeMinutes(tfStr);
        const nextBoundary = candle.openTime + tfMins * 60000;

        if (now >= nextBoundary) {
          console.log(`[OHLC] Proactive finalization for ${symbol} (${tfStr}) on boundary.`);
          const candleToFinalize = candle;
          delete activeCandles[symbol][tfStr];
          await finaliseCandle(candleToFinalize);
        }
      }
    }
  }, 1000);
};

startBoundaryChecker();

// Callback to trigger pivot calculations when a candle is finalized
type CandleFinalizedCallback = (candle: Candle) => Promise<void> | void;
let onCandleFinalized: CandleFinalizedCallback | null = null;

export const setOnCandleFinalized = (callback: CandleFinalizedCallback) => {
  onCandleFinalized = callback;
};

/**
 * Normalizes time boundary based on timeframe in minutes
 */
export const getBoundaryTime = (timestamp: Date, timeframeMinutes: number): number => {
  const timeMs = timestamp.getTime();
  const timeframeMs = timeframeMinutes * 60000;
  return Math.floor(timeMs / timeframeMs) * timeframeMs;
};

/**
 * Aggregates a raw tick into the corresponding timeframe candles for that symbol
 */
export const aggregateOHLC = async (tick: Tick, timeframeMinutes: number, timeframeStr: string): Promise<Candle> => {
  const { symbol, ltp, timestamp, volume = 0 } = tick;
  
  if (!activeCandles[symbol]) {
    activeCandles[symbol] = {};
  }

  const boundary = getBoundaryTime(timestamp, timeframeMinutes);
  let candle = activeCandles[symbol][timeframeStr];

  if (!candle || candle.openTime < boundary) {
    // If there is an existing active candle, it has crossed the timeframe boundary, so finalize it.
    if (candle) {
      await finaliseCandle(candle);
    }

    // Initialize new candle
    candle = {
      symbol,
      timeframe: timeframeStr,
      open: ltp,
      high: ltp,
      low: ltp,
      close: ltp,
      openTime: boundary,
      volume,
    };
  } else {
    // Update existing active candle
    candle.high = Math.max(candle.high, ltp);
    candle.low = Math.min(candle.low, ltp);
    candle.close = ltp;
    candle.volume += volume;
  }

  activeCandles[symbol][timeframeStr] = candle;
  return candle;
};

const finalizedCandlesCache: Record<string, Record<string, Candle[]>> = {};

/**
 * Saves finalized candle to MongoDB and triggers callback
 */
const finaliseCandle = async (candle: Candle) => {
  const { symbol, timeframe } = candle;
  if (!finalizedCandlesCache[symbol]) finalizedCandlesCache[symbol] = {};
  if (!finalizedCandlesCache[symbol][timeframe]) finalizedCandlesCache[symbol][timeframe] = [];

  const existingIdx = finalizedCandlesCache[symbol][timeframe].findIndex(c => c.openTime === candle.openTime);
  if (existingIdx >= 0) {
    finalizedCandlesCache[symbol][timeframe][existingIdx] = candle;
  } else {
    finalizedCandlesCache[symbol][timeframe].push(candle);
    if (finalizedCandlesCache[symbol][timeframe].length > 15) {
      finalizedCandlesCache[symbol][timeframe].shift();
    }
  }

  try {
    await FuturesOHLC.findOneAndUpdate(
      {
        symbol: candle.symbol,
        timeframe: candle.timeframe,
        bar_time: new Date(candle.openTime),
      },
      {
        bar_open: candle.open,
        bar_high: candle.high,
        bar_low: candle.low,
        bar_close: candle.close,
        volume: candle.volume,
      },
      { upsert: true, new: true }
    );

    console.log(`[OHLC] Finalized/Updated ${candle.timeframe} candle for ${candle.symbol} at ${new Date(candle.openTime).toISOString()}`);

    // Prune the database to keep exactly the latest 15 records
    const oldestToKeep = await FuturesOHLC.find({ symbol: candle.symbol, timeframe: candle.timeframe })
      .sort({ bar_time: -1 })
      .skip(14)
      .limit(1);

    if (oldestToKeep.length > 0) {
      const boundaryTime = oldestToKeep[0].bar_time;
      await FuturesOHLC.deleteMany({
        symbol: candle.symbol,
        timeframe: candle.timeframe,
        bar_time: { $lt: boundaryTime }
      });
    }
  } catch (error) {
    console.error("Failed to finalize candle in database:", error);
  }

  // Trigger callback even if DB save fails
  if (onCandleFinalized) {
    try {
      await onCandleFinalized(candle);
    } catch (err) {
      console.error("Error in onCandleFinalized callback:", err);
    }
  }
};

/**
 * Returns latest cached completed candles
 */
export const getCachedOHLCBars = (symbol: string, timeframe: string, limit = 50): Candle[] => {
  const list = finalizedCandlesCache[symbol]?.[timeframe] || [];
  return list.slice(-limit);
};

/**
 * Gets the current active candle for a symbol and timeframe
 */
export const getActiveCandle = (symbol: string, timeframeStr: string): Candle | null => {
  return activeCandles[symbol]?.[timeframeStr] || null;
};
