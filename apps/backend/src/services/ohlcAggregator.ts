import { FuturesOHLC } from "../models/FuturesOHLC";
import { Tick, Candle } from "@stock/shared";
import redis from "../config/redis";

// Local cache for active candles: activeCandles[symbol][timeframe]
const activeCandles: Record<string, Record<string, Candle>> = {};

const parseTfMinutes = (tf: string): number => {
  if (tf.endsWith("h")) {
    const h = parseInt(tf, 10);
    return !isNaN(h) && h > 0 ? h * 60 : 0;
  }
  if (tf.endsWith("m")) {
    const m = parseInt(tf, 10);
    return !isNaN(m) && m > 0 ? m : 0;
  }
  return 0;
};

const getTimeframeMinutes = async (tfStr: string): Promise<number> => {
  if (tfStr === "custom") {
    try {
      const customTf = await redis.get("config:custom_timeframe");
      if (customTf) {
        const mins = parseTfMinutes(customTf);
        if (mins > 0) return mins;
      }
    } catch {
      // Ignore Redis offline/read errors
    }
    return 10;
  }
  const mins = parseTfMinutes(tfStr);
  return mins > 0 ? mins : 5;
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

// NSE session open: 09:15 IST = 03:45 UTC = 225 minutes from UTC midnight
const SESSION_OPEN_UTC_MINUTES = 3 * 60 + 45;

// Returns the millisecond timestamp of the current trading day's session open (03:45 UTC).
// If the current UTC time is before 03:45 today, returns yesterday's session open.
export const getTodaySessionOpenMs = (): number => {
  const now = Date.now();
  const todayMidnightMs = now - (now % (24 * 60 * 60000));
  const todaySessionOpenMs = todayMidnightMs + SESSION_OPEN_UTC_MINUTES * 60000;
  return now < todaySessionOpenMs ? todaySessionOpenMs - 24 * 60 * 60000 : todaySessionOpenMs;
};

/**
 * Normalizes time boundary based on timeframe in minutes.
 * For timeframes < 60 minutes, boundaries align to UTC midnight (which coincidentally
 * aligns with IST 09:15 for 1m/5m/15m/30m/45m because 225min is divisible by each).
 * For timeframes >= 60 minutes, boundaries are offset to the NSE session open (09:15 IST)
 * so that the first bar of the day starts exactly at market open, not at a UTC-midnight-
 * aligned time that precedes the session by 30–75 minutes.
 */
export const getBoundaryTime = (timestamp: Date, timeframeMinutes: number): number => {
  const timeMs = timestamp.getTime();
  const timeframeMs = timeframeMinutes * 60000;

  if (timeframeMinutes < 60) {
    return Math.floor(timeMs / timeframeMs) * timeframeMs;
  }

  // Anchor to session open so the first bar of the day starts at 09:15 IST (03:45 UTC)
  const sessionOpenMs = SESSION_OPEN_UTC_MINUTES * 60000; // ms from UTC midnight
  // Find midnight UTC for the same day as the timestamp
  const midnightMs = timeMs - (timeMs % (24 * 60 * 60000));
  const todaySessionOpenMs = midnightMs + sessionOpenMs;
  const offsetMs = timeMs - todaySessionOpenMs;
  if (offsetMs < 0) {
    // Tick is before today's session open — snap to previous session's last boundary
    const prevSessionOpenMs = todaySessionOpenMs - 24 * 60 * 60000;
    return prevSessionOpenMs + Math.floor((timeMs - prevSessionOpenMs) / timeframeMs) * timeframeMs;
  }
  return todaySessionOpenMs + Math.floor(offsetMs / timeframeMs) * timeframeMs;
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
    // Keep at most 400 candles in memory (enough for a full 1m intraday session: 375 candles)
    if (finalizedCandlesCache[symbol][timeframe].length > 400) {
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

    // Prune candles from previous trading sessions (before today's 09:15 IST = 03:45 UTC)
    const sessionOpen = new Date(candle.openTime);
    sessionOpen.setUTCHours(3, 45, 0, 0); // 09:15 IST
    if (sessionOpen.getTime() > candle.openTime) {
      sessionOpen.setUTCDate(sessionOpen.getUTCDate() - 1);
    }
    await FuturesOHLC.deleteMany({
      symbol: candle.symbol,
      timeframe: candle.timeframe,
      bar_time: { $lt: sessionOpen },
    });
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
 * Returns latest cached completed candles for the current trading session only.
 * Bars from previous sessions are excluded so stale data is never served.
 */
export const getCachedOHLCBars = (symbol: string, timeframe: string, limit = 400): Candle[] => {
  const sessionOpenMs = getTodaySessionOpenMs();
  const list = (finalizedCandlesCache[symbol]?.[timeframe] || [])
    .filter(c => c.openTime >= sessionOpenMs);
  return list.slice(-limit);
};

/**
 * Gets the current active candle for a symbol and timeframe
 */
export const getActiveCandle = (symbol: string, timeframeStr: string): Candle | null => {
  return activeCandles[symbol]?.[timeframeStr] || null;
};
