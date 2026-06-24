import axios from "axios";
import { io, Socket } from "socket.io-client";
import redis from "../config/redis";

let sessionToken: string | null = null;
let userID: string | null = null;
let socket: Socket | null = null;
let socketConnected = false;

export const isAetramConnected = (): "CONNECTED" | "ERROR" | "WAITING_FOR_CONFIGURATION" => {
  const apiKey = getApiKey();
  const apiSecret = getApiSecret();
  const authUrl = getAuthUrl();
  const baseUrl = getBaseUrl();

  if (isPlaceholder(apiKey) || isPlaceholder(apiSecret) || !authUrl || !baseUrl) {
    return "WAITING_FOR_CONFIGURATION";
  }

  if (sessionToken && socketConnected) {
    return "CONNECTED";
  }

  return "ERROR";
};

// Caches for symbol mapping
const symbolToTokenMap = new Map<string, { segment: number; token: string }>();
const tokenToSymbolMap = new Map<string, string>(); // key is `segment|token` or just `token`

const isPlaceholder = (value?: string) =>
  !value || value.includes("your-") || value.includes("placeholder");

const getApiKey = () => (process.env.MOD2_API_KEY || "").trim();
const getApiSecret = () => (process.env.MOD2_API_SECRET || "").trim();
const getBaseUrl = () => (process.env.AETRAM_MARKETDATA_API_BASE_URL || "").trim();
const getAuthUrl = () => (process.env.AETRAM_MARKETDATA_AUTH_URL || "").trim();

const parseDateToYMD = (val: string | Date | number): string => {
  const d = new Date(val);
  if (isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

/**
 * Standard HTTP headers for Aetram requests
 */
const getHeaders = () => {
  if (!sessionToken) return { "Content-Type": "application/json" };
  return {
    "Content-Type": "application/json",
    "authorization": sessionToken,
  };
};

/**
 * Perform login to Aetram MarketData API
 */
export const loginToAetram = async (): Promise<boolean> => {
  const apiKey = getApiKey();
  const apiSecret = getApiSecret();
  const authUrl = getAuthUrl();

  if (isPlaceholder(apiKey) || isPlaceholder(apiSecret) || !authUrl) {
    console.warn("[AetramMD] Missing or placeholder credentials in env. Skipping Aetram live login.");
    return false;
  }

  try {
    console.log("[AetramMD] Logging in to Aetram MarketData API...");
    const response = await axios.post(
      authUrl,
      {
        secretKey: apiSecret,
        appKey: apiKey,
        source: "WEBAPI",
      },
      {
        headers: { "Content-Type": "application/json" },
      }
    );

    if (response.data && response.data.code === "success" && response.data.result) {
      sessionToken = response.data.result.token;
      userID = response.data.result.userID;
      console.log(`[AetramMD] Login successful. User ID: ${userID}`);
      return true;
    } else {
      console.error("[AetramMD] Login failed. Response:", response.data);
      return false;
    }
  } catch (error: any) {
    console.error("[AetramMD] Login request exception:", error?.message || error);
    if (error.response?.data) {
      console.error("[AetramMD] Login request error response body:", JSON.stringify(error.response.data, null, 2));
    }
    return false;
  }
};

/**
 * Search and resolve an option strike symbol to its instrument token
 */
export const resolveOptionStrikeToken = async (
  index: string,
  expiryDate: string,
  strikeSymbol: string
): Promise<{ segment: number; token: string } | null> => {
  // If already in cache, return it
  if (symbolToTokenMap.has(strikeSymbol)) {
    return symbolToTokenMap.get(strikeSymbol)!;
  }

  const baseUrl = getBaseUrl();
  if (!baseUrl || !sessionToken) return null;

  // Extract strike price and option type from strikeSymbol (e.g. "NIFTY22100CE")
  const match = strikeSymbol.match(/(\d+)(CE|PE)$/);
  if (!match) return null;
  const strikePrice = Number(match[1]);
  const optionType = match[2].toUpperCase(); // CE or PE

  const indexShort = index.replace("50", "").replace("fifty", "").toUpperCase(); // e.g. "NIFTY"

  try {
    // Search using searchString
    const searchString = `${indexShort} ${strikePrice} ${optionType}`;
    const searchUrl = `${baseUrl}/search/instruments?searchString=${encodeURIComponent(searchString)}`;
    
    const response = await axios.get(searchUrl, { headers: getHeaders() });
    
    if (response.data && response.data.code === "success" && Array.isArray(response.data.result)) {
      const targetYmd = parseDateToYMD(expiryDate);
      
      // Filter list in-memory for the closest match
      for (const inst of response.data.result) {
        const instExpiryYmd = parseDateToYMD(inst.expiryDate || inst.expiry || "");
        const instStrike = Math.round(Number(inst.strikePrice || inst.strike || 0));
        const instOptType = String(inst.optionType || inst.type || "").toUpperCase();
        const isOptCE = instOptType.startsWith("C") || instOptType.includes("CE");
        const targetCE = optionType.startsWith("C");

        if (
          instExpiryYmd === targetYmd &&
          instStrike === strikePrice &&
          isOptCE === targetCE
        ) {
          const segment = Number(inst.exchangeSegment || 2);
          const token = String(inst.exchangeInstrumentID);

          const result = { segment, token };
          symbolToTokenMap.set(strikeSymbol, result);
          tokenToSymbolMap.set(`${segment}|${token}`, strikeSymbol);
          tokenToSymbolMap.set(token, strikeSymbol); // Fallback lookup mapping

          console.log(`[AetramMD] Resolved ${strikeSymbol} to Token: ${token} (Seg: ${segment})`);
          return result;
        }
      }
    }
    console.warn(`[AetramMD] Could not find matching Aetram instrument for strike ${strikeSymbol} (${expiryDate})`);
    return null;
  } catch (error: any) {
    console.error(`[AetramMD] Instrument lookup error for ${strikeSymbol}:`, error?.message || error);
    return null;
  }
};

/**
 * Subscribe to LTP & OI updates for resolved instruments
 */
export const subscribeToInstruments = async (
  instruments: Array<{ segment: number; token: string }>
) => {
  const baseUrl = getBaseUrl();
  if (!baseUrl || !sessionToken || instruments.length === 0) return;

  try {
    const payload = {
      instruments: instruments.map((inst) => ({
        exchangeSegment: inst.segment,
        exchangeInstrumentID: Number(inst.token),
      })),
      xtsMessageCode: 1512, // LTP updates
    };

    const payloadOI = {
      ...payload,
      xtsMessageCode: 1510, // OI updates
    };

    console.log(`[AetramMD] Subscribing to LTP/OI for ${instruments.length} instruments...`);
    await axios.post(`${baseUrl}/instruments/subscription`, payload, { headers: getHeaders() });
    await axios.post(`${baseUrl}/instruments/subscription`, payloadOI, { headers: getHeaders() });
  } catch (error: any) {
    console.error("[AetramMD] Subscription request failed:", error?.message || error);
  }
};

/**
 * Handles incoming ticks and updates Redis
 */
const handleLtpTick = async (tick: any) => {
  const token = String(tick.exchangeInstrumentID || tick.ExchangeInstrumentID);
  const ltp = tick.lastTradedPrice || tick.lastPrice || tick.ltp || tick.close;
  if (token && ltp !== undefined) {
    const symbol = tokenToSymbolMap.get(token);
    if (symbol) {
      await redis.set(`ltp:${symbol}`, ltp.toString());
    }
  }
};

const handleOiTick = async (tick: any) => {
  const token = String(tick.exchangeInstrumentID || tick.ExchangeInstrumentID);
  const oi = tick.openInterest || tick.oi;
  if (token && oi !== undefined) {
    const symbol = tokenToSymbolMap.get(token);
    if (symbol) {
      await redis.set(`oi:${symbol}`, oi.toString());
    }
  }
};

/**
 * Establish WebSocket / Socket.IO connection
 */
export const connectToAetramWebSocket = async (): Promise<boolean> => {
  if (!sessionToken || !userID) {
    console.warn("[AetramMD] No active session. Cannot connect socket.");
    return false;
  }

  // Extract base host URL
  const baseUrl = getBaseUrl();
  let host = "";
  try {
    const parsed = new URL(baseUrl);
    host = `${parsed.protocol}//${parsed.host}`;
  } catch {
    console.error("[AetramMD] Invalid MarketData Base URL.");
    return false;
  }

  console.log(`[AetramMD] Connecting Socket.IO client to ${host}...`);

  socket = io(host, {
    path: "/apibinarymarketdata/socket.io",
    query: {
      token: sessionToken,
      userID: userID,
      apiType: "MARKETDATA",
      publishFormat: "JSON",
    },
    transports: ["websocket"],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: Infinity,
  });

  socket.on("connect", () => {
    socketConnected = true;
    console.log("[AetramMD] Socket.IO feed connected successfully.");
  });

  socket.on("connect_error", (error: Error) => {
    socketConnected = false;
    console.error("[AetramMD] Socket connection error:", error);
  });

  // Attach handlers for LTP and OI
  socket.on("1512-json-full", handleLtpTick);
  socket.on("1512-json-partial", handleLtpTick);
  socket.on("1510-json-full", handleOiTick);
  socket.on("1510-json-partial", handleOiTick);

  socket.on("disconnect", (reason: string) => {
    socketConnected = false;
    console.warn(`[AetramMD] Socket disconnected: ${reason}`);
  });

  return true;
};

/**
 * Login using credentials provided at runtime by the user.
 * Called by module2BrokerLogin controller — never called on server startup.
 */
export const loginToAetramWithCredentials = async (appKey: string, secretKey: string): Promise<boolean> => {
  const authUrl = getAuthUrl();
  if (!authUrl) {
    console.warn("[AetramMD] AETRAM_MARKETDATA_AUTH_URL not configured.");
    return false;
  }
  try {
    console.log("[AetramMD] Logging in with user-provided credentials...");
    const response = await axios.post(
      authUrl,
      { secretKey, appKey, source: "WEBAPI" },
      { headers: { "Content-Type": "application/json" }, timeout: 15000 }
    );
    if (response.data?.code === "success" && response.data?.result) {
      sessionToken = response.data.result.token;
      userID       = response.data.result.userID;
      console.log(`[AetramMD] Authenticated. User ID: ${userID}`);
      return true;
    }
    console.error("[AetramMD] Auth rejected:", response.data);
    return false;
  } catch (error: any) {
    console.error("[AetramMD] Auth exception:", error?.message || error);
    return false;
  }
};

/**
 * Legacy env-based startup — NOT called anymore. Kept for reference only.
 */
export const initAetramMarketDataService = async () => {
  // Removed from startup. Module 2 connects only after user broker login.
  console.log("[AetramMD] initAetramMarketDataService: deferred — awaiting user login.");
};
