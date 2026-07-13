import axios from "axios";
import { bufferSet } from "./redisWriteBuffer";
import { broadcastBrokerStatus } from "./socketService";
import {
  loginMarketData,
  getMarketDataToken,
  isMarketDataAuthenticated,
  markMarketDataSessionExpired,
} from "./marketDataSessionService";
import { onRawSocketEvent, disconnect as disconnectMarketDataWebSocket, getStatus as getWebSocketStatus } from "./marketDataWebSocketService";
import { marketDataEvents } from "./marketDataEvents";
import { processRawPacket, NormalizedMarketEvent } from "./marketDataPipelineService";

// Session state (token, userID, expiry) lives in marketDataSessionService.
// The socket connection itself lives ONLY in marketDataWebSocketService
// (Phase 6 consolidation) — this service is a pure consumer of it: it
// registers tick handlers via onRawSocketEvent and reacts to connection
// lifecycle via marketDataEvents. It never creates, destroys, or reconnects
// a socket itself.
let _onReconnectFn: (() => Promise<void>) | null = null;

export const setOnAetramReconnect = (fn: () => Promise<void>) => {
  _onReconnectFn = fn;
};

export const clearAetramSession = () => {
  markMarketDataSessionExpired();
  // The session backing the shared socket is gone — tear the connection down
  // too rather than leaving a socket open with a now-invalid token.
  disconnectMarketDataWebSocket();
};

export const isAetramConnected = (): "CONNECTED" | "ERROR" | "WAITING_FOR_CONFIGURATION" => {
  const apiKey = getApiKey();
  const apiSecret = getApiSecret();
  const authUrl = getAuthUrl();
  const baseUrl = getBaseUrl();

  if (isPlaceholder(apiKey) || isPlaceholder(apiSecret) || !authUrl || !baseUrl) {
    return "WAITING_FOR_CONFIGURATION";
  }

  if (isMarketDataAuthenticated() && getWebSocketStatus().state === "CONNECTED") {
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
  const token = getMarketDataToken();
  if (!token) return { "Content-Type": "application/json" };
  return {
    "Content-Type": "application/json",
    "authorization": token,
  };
};

/**
 * Perform login to Aetram MarketData API using configured env credentials
 */
export const loginToAetram = async (): Promise<boolean> => {
  const apiKey = getApiKey();
  const apiSecret = getApiSecret();

  if (isPlaceholder(apiKey) || isPlaceholder(apiSecret)) {
    console.warn("[AetramMD] Missing or placeholder credentials in env. Skipping Aetram live login.");
    return false;
  }

  const result = await loginMarketData();
  return result.ok;
};

/**
 * Normalized shape of one row returned by Aetram's /search/instruments endpoint.
 * Used by the Instrument Discovery layer (InstrumentService) as well as the
 * strike-token resolution below.
 */
export interface AetramInstrumentResult {
  exchangeSegment: number;
  exchangeInstrumentID: string;
  name: string;
  tradingSymbol: string;
  series: string;
  instrumentType: string;
  expiryDate?: string;
  strikePrice?: number;
  optionType?: string;
}

/**
 * Raw instrument search against Aetram's /search/instruments endpoint.
 * Extracted from resolveOptionStrikeToken (Phase 3) so the Instrument Discovery
 * layer can reuse the exact same search call instead of re-implementing it.
 */
export const searchInstruments = async (searchString: string): Promise<AetramInstrumentResult[]> => {
  const baseUrl = getBaseUrl();
  if (!baseUrl || !getMarketDataToken()) return [];

  try {
    const searchUrl = `${baseUrl}/search/instruments?searchString=${encodeURIComponent(searchString)}`;
    const response = await axios.get(searchUrl, { headers: getHeaders(), timeout: 10000 });

    // "type" is the success/failure discriminant per the XTS response envelope
    // (code carries a granular id like "s-response-0001", never "success").
    if (response.data?.type !== "success" || !Array.isArray(response.data.result)) return [];

    return response.data.result.map((inst: any) => ({
      exchangeSegment: Number(inst.exchangeSegment ?? 2),
      exchangeInstrumentID: String(inst.exchangeInstrumentID ?? ""),
      name: String(inst.name ?? inst.symbol ?? ""),
      tradingSymbol: String(inst.tradingSymbol ?? inst.displayName ?? ""),
      series: String(inst.series ?? ""),
      instrumentType: String(inst.instrumentType ?? inst.series ?? ""),
      expiryDate: inst.expiryDate || inst.expiry || undefined,
      strikePrice: inst.strikePrice !== undefined ? Number(inst.strikePrice)
        : inst.strike !== undefined ? Number(inst.strike) : undefined,
      optionType: inst.optionType || inst.type || undefined,
    }));
  } catch (error: any) {
    if (error?.response?.status === 401) {
      console.warn("[AetramMD] Session expired (401) during instrument search.");
      clearAetramSession();
      broadcastBrokerStatus("session-expired", "Broker session expired. Please login again.", "module2");
    } else {
      console.error(`[AetramMD] Instrument search error for "${searchString}":`, error?.message || error);
    }
    return [];
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

  if (!getBaseUrl() || !getMarketDataToken()) return null;

  // Extract strike price and option type from strikeSymbol (e.g. "NIFTY22100CE")
  const match = strikeSymbol.match(/(\d+)(CE|PE)$/);
  if (!match) return null;
  const strikePrice = Number(match[1]);
  const optionType = match[2].toUpperCase(); // CE or PE

  const indexShort = index.replace("50", "").replace("fifty", "").toUpperCase(); // e.g. "NIFTY"

  const searchString = `${indexShort} ${strikePrice} ${optionType}`;
  const results = await searchInstruments(searchString);
  const targetYmd = parseDateToYMD(expiryDate);

  // Filter list in-memory for the closest match
  for (const inst of results) {
    const instExpiryYmd = parseDateToYMD(inst.expiryDate || "");
    const instStrike = Math.round(inst.strikePrice || 0);
    const instOptType = String(inst.optionType || "").toUpperCase();
    const isOptCE = instOptType.startsWith("C") || instOptType.includes("CE");
    const targetCE = optionType.startsWith("C");

    if (
      instExpiryYmd === targetYmd &&
      instStrike === strikePrice &&
      isOptCE === targetCE
    ) {
      const segment = inst.exchangeSegment;
      const token = inst.exchangeInstrumentID;

      const result = { segment, token };
      symbolToTokenMap.set(strikeSymbol, result);
      tokenToSymbolMap.set(`${segment}|${token}`, strikeSymbol);
      tokenToSymbolMap.set(token, strikeSymbol); // Fallback lookup mapping

      console.log(`[AetramMD] Resolved ${strikeSymbol} to Token: ${token} (Seg: ${segment})`);
      return result;
    }
  }

  console.warn(`[AetramMD] Could not find matching Aetram instrument for strike ${strikeSymbol} (${expiryDate})`);
  return null;
};

/**
 * Subscribe to LTP & OI updates for resolved instruments
 */
export const subscribeToInstruments = async (
  instruments: Array<{ segment: number; token: string }>
) => {
  const baseUrl = getBaseUrl();
  if (!baseUrl || !getMarketDataToken() || instruments.length === 0) return;

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
    await axios.post(`${baseUrl}/instruments/subscription`, payload, { headers: getHeaders(), timeout: 10000 });
    await axios.post(`${baseUrl}/instruments/subscription`, payloadOI, { headers: getHeaders(), timeout: 10000 });
  } catch (error: any) {
    if (error?.response?.status === 401) {
      console.warn("[AetramMD] Session expired (401) during subscription.");
      clearAetramSession();
      broadcastBrokerStatus("session-expired", "Broker session expired. Please login again.", "module2");
    } else {
      console.error("[AetramMD] Subscription request failed:", error?.message || error);
    }
  }
};

/**
 * Persists normalized LTP/OI events to the in-process live store (Module 2's
 * tracker reads these via readLive — same process, zero Redis commands).
 * Previously each tick issued a direct Redis SET; per-tick REST calls were a
 * major contributor to the monthly command quota blowout.
 *
 * This is business logic (what to do with a tick), kept separate from
 * transport/decoding — see marketDataPipelineService.ts (Phase 7), which
 * decodes the raw packet and publishes LTP_UPDATED/OI_UPDATED. This service
 * only reacts to those normalized events; it no longer parses raw packets.
 */
marketDataEvents.on("LTP_UPDATED", (event: NormalizedMarketEvent) => {
  if (!event.exchangeInstrumentID || event.lastPrice === null) return;
  const symbol = tokenToSymbolMap.get(event.exchangeInstrumentID);
  if (symbol) bufferSet(`ltp:${symbol}`, String(event.lastPrice));
});

marketDataEvents.on("OI_UPDATED", (event: NormalizedMarketEvent) => {
  if (!event.exchangeInstrumentID || event.openInterest === null) return;
  const symbol = tokenToSymbolMap.get(event.exchangeInstrumentID);
  if (symbol) bufferSet(`oi:${symbol}`, String(event.openInterest));
});

/**
 * WebSocket lifecycle wiring (Phase 6 consolidation).
 *
 * marketDataWebSocketService is the ONLY owner of the socket. This service
 * only registers what it needs on top of that shared connection:
 *   - raw packet routing into the Phase 7 pipeline, re-attached to every
 *     socket instance the manager creates (including across reconnects) via
 *     onRawSocketEvent
 *   - a reaction to CONNECTED/RECONNECTED/DISCONNECTED lifecycle events to
 *     preserve the exact same business behavior the old inline socket
 *     handlers had (frontend broker-status broadcast + the tracker resync
 *     callback), without owning the socket itself.
 *
 * "-json-full"/"-json-partial" are Aetram/XTS's own event-name suffixes for a
 * full snapshot vs. an incremental update of the same message code; both route
 * to the same decoder since the pipeline normalizes either shape identically.
 * 1501/1502 are wired defensively even though nothing currently requests those
 * message codes via subscribeToInstruments — the pipeline is meant to be
 * reusable for whatever future subsystems start requesting them.
 */
const routeToPipeline = (packetType: string) => (raw: unknown) => processRawPacket(packetType, raw);

onRawSocketEvent("1512-json-full", routeToPipeline("1512"));
onRawSocketEvent("1512-json-partial", routeToPipeline("1512"));
onRawSocketEvent("1510-json-full", routeToPipeline("1510"));
onRawSocketEvent("1510-json-partial", routeToPipeline("1510"));
onRawSocketEvent("1501-json-full", routeToPipeline("1501"));
onRawSocketEvent("1501-json-partial", routeToPipeline("1501"));
onRawSocketEvent("1502-json-full", routeToPipeline("1502"));
onRawSocketEvent("1502-json-partial", routeToPipeline("1502"));

const triggerReconnectCallback = () => {
  if (_onReconnectFn) {
    _onReconnectFn().catch((err: any) => {
      console.error("[AetramMD] Reconnect callback error:", err?.message || err);
    });
  }
};

marketDataEvents.on("CONNECTED", () => {
  console.log("[AetramMD] Socket connected.");
  broadcastBrokerStatus("live", undefined, "module2");
  triggerReconnectCallback();
});

marketDataEvents.on("RECONNECTED", () => {
  console.log("[AetramMD] Socket reconnected.");
  broadcastBrokerStatus("live", undefined, "module2");
  triggerReconnectCallback();
});

marketDataEvents.on("DISCONNECTED", ({ reason, manual }: { reason: string; manual: boolean }) => {
  console.warn(`[AetramMD] Socket disconnected: ${reason}`);
  if (!manual) {
    broadcastBrokerStatus("broker-disconnected", "Lost connection to broker. Reconnecting...", "module2");
  }
});

/**
 * Compute the next N upcoming Thursdays (NSE weekly expiry pattern, last resort fallback)
 */
const computeUpcomingThursdays = (count: number): string[] => {
  const result: string[] = [];
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const dayOfWeek = d.getDay();
  const daysToThursday = (4 - dayOfWeek + 7) % 7;
  d.setDate(d.getDate() + daysToThursday);
  for (let i = 0; i < count; i++) {
    result.push(parseDateToYMD(new Date(d)));
    d.setDate(d.getDate() + 7);
  }
  return result;
};

/**
 * Fetch available expiry dates for options on the given index.
 * Priority: Aetram API → MOD2_EXPIRY_DATES env → computed Thursdays
 *
 * `exchangeSegment` defaults to 2 (NSEFO) to preserve existing NIFTY/BANKNIFTY/
 * FINNIFTY behavior. Pass 12 (BSEFO) for SENSEX — the only supported BSE index.
 */
export const getAetramExpiryDates = async (indexSymbol: string, exchangeSegment = 2): Promise<string[]> => {
  const baseUrl = getBaseUrl();

  if (baseUrl && getMarketDataToken()) {
    try {
      const name = indexSymbol.replace(/50$/i, "").replace(/FIFTY$/i, "").toUpperCase();
      const url = `${baseUrl}/instruments/expiry?exchangeSegment=${exchangeSegment}&series=OPT&name=${encodeURIComponent(name)}`;
      const response = await axios.get(url, { headers: getHeaders(), timeout: 8000 });

      if (response.data?.type === "success" && Array.isArray(response.data.result)) {
        const dates = response.data.result
          .map((r: any) => parseDateToYMD(r.expiryDate || r.expiry || ""))
          .filter(Boolean)
          .sort();
        if (dates.length > 0) return dates;
      }
    } catch {
      // Fall through to config fallback
    }
  }

  const configDates = (process.env.MOD2_EXPIRY_DATES || "").trim();
  if (configDates) {
    return configDates.split(",").map((d) => d.trim()).filter(Boolean).sort();
  }

  return computeUpcomingThursdays(5);
};

/**
 * Login using credentials provided at runtime by the user.
 * Called by module2BrokerLogin controller — never called on server startup.
 */
export const loginToAetramWithCredentials = async (appKey: string, secretKey: string): Promise<boolean> => {
  const result = await loginMarketData(appKey, secretKey);
  return result.ok;
};

/**
 * Legacy env-based startup — NOT called anymore. Kept for reference only.
 */
export const initAetramMarketDataService = async () => {
  // Removed from startup. Module 2 connects only after user broker login.
  console.log("[AetramMD] initAetramMarketDataService: deferred — awaiting user login.");
};
