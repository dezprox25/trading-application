import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth";
import { Watchlist } from "../models/Watchlist";
import { FuturesOHLC } from "../models/FuturesOHLC";
import redis from "../config/redis";
import { WatchlistSchema, Module1ConfigSchema } from "@stock/shared";
import { getActiveCandle, getCachedOHLCBars } from "../services/ohlcAggregator";
import { getPivotLevels, evaluateIndicators } from "../services/pivotService";
import { getLatestModule1OiMetrics } from "../services/module1OiService";
import { isZebuLiveConnected } from "../services/zebuMarketDataClient";
import { isAetramConnected } from "../services/aetramMarketDataService";

// Local in-memory watchlists store for when MongoDB is offline
const inMemoryWatchlists = new Map<string, { symbols: string[]; columnPrefs: any }>();

// Seed default watchlists for guest users
inMemoryWatchlists.set("60c72b2f9b1d8a0015f8e567", {
  symbols: ["NIFTY-SPOT", "NIFTY-FUT"],
  columnPrefs: { pivots: true, indicators: true }
});

// Fetch User Watchlist
export const getWatchlist = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    let symbols = ["NIFTY-SPOT", "NIFTY-FUT"];
    let columnPrefs = { pivots: true, indicators: true };

    try {
      let list = await Watchlist.findOne({ user_id: userId });
      if (!list) {
        list = await Watchlist.create({
          user_id: userId,
          symbols_json: symbols,
          column_prefs_json: columnPrefs
        });
      }
      symbols = list.symbols_json;
      columnPrefs = list.column_prefs_json;
    } catch (err) {
      console.warn("[Market] MongoDB offline. Loading watchlist from in-memory cache.");
      if (!inMemoryWatchlists.has(userId)) {
        inMemoryWatchlists.set(userId, { symbols, columnPrefs });
      }
      const cached = inMemoryWatchlists.get(userId)!;
      symbols = cached.symbols;
      columnPrefs = cached.columnPrefs;
    }

    return res.status(200).json({
      symbols,
      columnPrefs
    });
  } catch (error) {
    console.error("Fetch Watchlist Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

// Update User Watchlist
export const updateWatchlist = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parseResult = WatchlistSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Validation failed", details: parseResult.error.errors });
    }

    const { symbols, columnPrefs } = parseResult.data;

    try {
      await Watchlist.findOneAndUpdate(
        { user_id: userId },
        { symbols_json: symbols, column_prefs_json: columnPrefs || {} },
        { new: true, upsert: true }
      );
    } catch (err) {
      console.warn("[Market] MongoDB offline. Updating watchlist in memory.");
    }

    inMemoryWatchlists.set(userId, { symbols, columnPrefs: columnPrefs || {} });

    return res.status(200).json({
      message: "Watchlist updated successfully",
      symbols,
      columnPrefs: columnPrefs || {}
    });
  } catch (error) {
    console.error("Update Watchlist Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

// Get Spot Price
export const getSpotPrice = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { symbol } = req.params;
    const price = await redis.get(`ltp:${symbol}`);
    
    if (!price) {
      return res.status(404).json({ error: `Price for symbol ${symbol} not found` });
    }

    return res.status(200).json({
      symbol,
      ltp: parseFloat(price),
      timestamp: new Date()
    });
  } catch (error) {
    console.error("Get Spot Price Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

// Get Futures LTP and current active Candle
export const getFuturesData = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { symbol } = req.params;
    const timeframe = (req.query.timeframe as string) || "5m";

    const price = await redis.get(`ltp:${symbol}`);
    const candle = getActiveCandle(symbol, timeframe);

    return res.status(200).json({
      symbol,
      ltp: price ? parseFloat(price) : 0,
      activeCandle: candle
    });
  } catch (error) {
    console.error("Get Futures Data Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

// Get completed OHLC candles from Database
export const getOHLCBars = async (req: AuthenticatedRequest, res: Response) => {
  const { symbol, tf } = req.params;
  const limit = req.query.limit ? parseInt(req.query.limit as string) : 15;
  const fetchLimit = limit + 1;

  type OhlcBar = {
    symbol: string; timeframe: string;
    open: number; high: number; low: number; close: number;
    openTime: number; volume: number;
  };

  let bars: OhlcBar[] = [];

  // Step 1: Try MongoDB for finalized candles
  try {
    const dbBars = await FuturesOHLC.find({ symbol, timeframe: tf })
      .sort({ bar_time: -1 })
      .limit(fetchLimit * 3);

    const seenTimes = new Set<number>();
    const uniqueBars: typeof dbBars = [];
    for (const b of dbBars) {
      const timeMs = new Date(b.bar_time).getTime();
      if (!seenTimes.has(timeMs)) {
        seenTimes.add(timeMs);
        uniqueBars.push(b);
      }
      if (uniqueBars.length >= fetchLimit) {
        break;
      }
    }

    bars = uniqueBars.reverse().map((b) => ({
      symbol: b.symbol,
      timeframe: b.timeframe,
      open: b.bar_open,
      high: b.bar_high,
      low: b.bar_low,
      close: b.bar_close,
      openTime: new Date(b.bar_time).getTime(),
      volume: b.volume
    }));
  } catch (error) {
    console.error("[OHLC] MongoDB error, trying in-memory finalized cache:", error);
  }

  // Step 2: Fall back to in-memory finalized candle cache if MongoDB returned nothing
  if (bars.length === 0) {
    const cached = getCachedOHLCBars(symbol, tf, fetchLimit);
    if (cached.length > 0) {
      console.log(`[OHLC] MongoDB empty for ${symbol}/${tf} — serving ${cached.length} in-memory finalized bars.`);
      bars = cached;
    }
  }

  // Step 3: Include the active (currently building) candle as the most recent data point.
  // This ensures the matrix populates even when no candle has closed yet in this session.
  const activeCandle = getActiveCandle(symbol, tf);
  if (activeCandle) {
    if (bars.length === 0) {
      console.log(`[OHLC] No finalized bars for ${symbol}/${tf} — seeding with active candle (ltp=${activeCandle.close}).`);
      bars = [activeCandle];
    } else if (activeCandle.openTime > bars[bars.length - 1].openTime) {
      bars = [...bars, activeCandle];
    }
  }

  if (bars.length === 0) {
    console.warn(`[OHLC] No data at all for ${symbol}/${tf} — live feed may not have started yet.`);
  }

  return res.status(200).json(bars);
};


// Get computed pivots (all 3 methods)
export const getPivotLevelsEndpoint = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { symbol, tf } = req.params;

    const classic = await getPivotLevels(symbol, tf, "classic");
    const camarilla = await getPivotLevels(symbol, tf, "camarilla");
    const fibonacci = await getPivotLevels(symbol, tf, "fibonacci");

    return res.status(200).json({
      symbol,
      timeframe: tf,
      classic,
      camarilla,
      fibonacci
    });
  } catch (error) {
    console.error("Get Pivot Levels Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

// Evaluate Indicators
export const getIndicatorsEndpoint = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { symbol } = req.params;
    const timeframe = (req.query.timeframe as string) || "5m";
    const method = (req.query.method as "classic" | "camarilla" | "fibonacci") || "classic";

    const indicators = await evaluateIndicators(symbol, timeframe, method);
    if (!indicators) {
      return res.status(404).json({ error: "Failed to compute indicators. Make sure market feeds are running." });
    }

    return res.status(200).json(indicators);
  } catch (error) {
    console.error("Get Indicators Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

export const getModule1LatestOi = async (_req: AuthenticatedRequest, res: Response) => {
  try {
    return res.status(200).json(getLatestModule1OiMetrics());
  } catch (error) {
    console.error("Get Module1 Latest OI Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

// Generate options chain based on current NIFTY spot index
export const getOptionChain = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { index } = req.params; // e.g., "NIFTY50"
    const rawSpot = await redis.get("ltp:NIFTY-SPOT");
    const spot = rawSpot ? parseFloat(rawSpot) : 22100.0;

    // Standard strike step for NIFTY is 50 points
    const strikeStep = 50;
    const atmStrike = Math.round(spot / strikeStep) * strikeStep;

    const strikes: Array<{ strikePrice: number; CE: string; PE: string }> = [];

    // Generate 5 ITM and 5 OTM strikes for both CE and PE
    for (let i = -5; i <= 5; i++) {
      const strikePrice = atmStrike + i * strikeStep;
      strikes.push({
        strikePrice,
        CE: `NIFTY${strikePrice}CE`,
        PE: `NIFTY${strikePrice}PE`
      });
    }

    return res.status(200).json({
      index,
      spotPrice: spot,
      atmStrike,
      strikes
    });
  } catch (error) {
    console.error("Get Option Chain Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

// Update custom timeframe config
export const updateCustomTimeframe = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { timeframe } = req.body; // e.g. "10m"
    if (!timeframe || typeof timeframe !== "string" || !timeframe.endsWith("m")) {
      return res.status(400).json({ error: "Invalid timeframe format. Expected e.g. '10m'" });
    }

    const minutes = parseInt(timeframe);
    if (isNaN(minutes) || minutes <= 0) {
      return res.status(400).json({ error: "Invalid timeframe duration" });
    }

    // Save custom timeframe to Redis
    await redis.set("config:custom_timeframe", timeframe);
    
    // Clear old custom timeframe database records so they restart cleanly
    try {
      await FuturesOHLC.deleteMany({ timeframe });
      console.log(`[Market] Cleared old OHLC bars for custom timeframe: ${timeframe}`);
    } catch (dbErr) {
      // ignore db errors in offline mode
    }

    return res.status(200).json({
      message: "Custom timeframe updated successfully",
      timeframe,
      minutes
    });
  } catch (error) {
    console.error("Update Custom Timeframe Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

/**
 * Helper to check if the current time falls within Indian Standard Time (IST) market hours:
 * Monday to Friday, 9:00 AM to 3:45 PM IST.
 */
export const isMarketOpenTime = (now = new Date()): boolean => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    hour12: false,
    weekday: "long",
    hour: "numeric",
    minute: "numeric",
  });
  
  const parts = formatter.formatToParts(now);
  const partMap: Record<string, string> = {};
  for (const part of parts) {
    partMap[part.type] = part.value;
  }
  
  const weekday = partMap.weekday;
  const hour = parseInt(partMap.hour, 10);
  const minute = parseInt(partMap.minute, 10);
  
  if (weekday === "Saturday" || weekday === "Sunday") {
    return false;
  }
  
  const minutesSinceMidnight = hour * 60 + minute;
  const marketOpenMinutes = 9 * 60; // 9:00 AM
  const marketCloseMinutes = 15 * 60 + 45; // 3:45 PM
  
  return minutesSinceMidnight >= marketOpenMinutes && minutesSinceMidnight <= marketCloseMinutes;
};

// Get current live market connection status
export const getMarketStatus = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const isLive = isMarketOpenTime() && isZebuLiveConnected();
    return res.status(200).json({
      status: isLive ? "LIVE" : "CLOSED"
    });
  } catch (error) {
    console.error("Get Market Status Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

// Get connection statuses for both Module 1 (Zebu) and Module 2 (Aetram)
export const getModuleStatus = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const m1Connected = isZebuLiveConnected();
    const m2Status = isAetramConnected();

    return res.status(200).json({
      module1: m1Connected ? "CONNECTED" : "DISCONNECTED",
      module2: m2Status,
    });
  } catch (error) {
    console.error("Get Module Status Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

