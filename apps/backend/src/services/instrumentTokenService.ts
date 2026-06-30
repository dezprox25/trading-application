import axios from "axios";
import redis from "../config/redis";

const NFO_SYMBOLS_URL = "https://go.mynt.in/NFO_symbols.txt";
const DOWNLOAD_TIMEOUT_MS = 30_000;
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours — covers weekly expiry cycles

interface ZebuNFORow {
  exchange: string;
  token: string;
  symbol: string;
  tradingSymbol: string;
  expiry: Date | null;
  strike: number;
  optionType: string;
  instrumentType: string;
}

export interface ActiveInstrumentTokens {
  futToken: string | null;
  ceTokens: string[];
  peTokens: string[];
  fetchedAt: Date;
  nearestOptionExpiry: string | null;
  futExpiry: string | null;
}

let cachedTokens: ActiveInstrumentTokens | null = null;
let lastFetchTime = 0;

const parseExpiry = (raw: string): Date | null => {
  const s = (raw || "").trim();
  if (!s || s === "0") return null;

  // ISO: 2026-07-31
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + "T00:00:00.000Z");

  // DD-Mon-YYYY: 31-Jul-2026
  const dm = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(s);
  if (dm) return new Date(`${dm[3]}-${dm[2]}-${dm[1].padStart(2, "0")}T00:00:00.000Z`);

  // DD/MM/YYYY: 31/07/2026
  const ds = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (ds) return new Date(`${ds[3]}-${ds[2]}-${ds[1]}T00:00:00.000Z`);

  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};

const formatExpiryForSymbol = (expiry: Date): string => {
  // Zebu format: DDMONYY (e.g., 03JUL26)
  const day = String(expiry.getUTCDate()).padStart(2, "0");
  const months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  const mon = months[expiry.getUTCMonth()];
  const yr = String(expiry.getUTCFullYear()).slice(-2);
  return `${day}${mon}${yr}`;
};

const parseNFOLine = (line: string): ZebuNFORow | null => {
  // NFO_symbols.txt uses comma separation; some versions use pipe
  const delim = line.includes(",") ? "," : "|";
  const parts = line.split(delim).map(p => p.trim());
  if (parts.length < 10) return null;

  // Columns: Exchange, Token, LotSize, Symbol, TradingSymbol, Expiry, Strike, OptionType, TickSize, InstrumentType
  const [exchange, token, , symbol, tradingSymbol, expiryStr, strikeStr, optionType, , instrumentType] = parts;

  if (!exchange || !token || !symbol || !tradingSymbol) return null;

  return {
    exchange: exchange.toUpperCase(),
    token,
    symbol: symbol.toUpperCase(),
    tradingSymbol,
    expiry: parseExpiry(expiryStr || ""),
    strike: parseFloat(strikeStr || "0") || 0,
    optionType: (optionType || "").toUpperCase().trim(),
    instrumentType: (instrumentType || "").toUpperCase().trim(),
  };
};

const buildActiveTokens = (rows: ZebuNFORow[], atmStrike: number): ActiveInstrumentTokens => {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  // Nearest NIFTY futures contract with expiry >= today
  const futRows = rows
    .filter(r => r.symbol === "NIFTY" && r.instrumentType === "FUTIDX" && r.expiry && r.expiry >= today)
    .sort((a, b) => a.expiry!.getTime() - b.expiry!.getTime());

  let futToken: string | null = null;
  let futExpiry: string | null = null;
  if (futRows.length > 0) {
    const fut = futRows[0];
    futToken = `NFO|${fut.token}:NIFTY-FUT`;
    futExpiry = fut.expiry!.toISOString().slice(0, 10);
    console.log(`[InstrumentTokens] Active futures: ${fut.tradingSymbol} expiry=${futExpiry} → ${futToken}`);
  } else {
    console.warn("[InstrumentTokens] No active NIFTY futures found in NFO symbols.");
  }

  // Nearest weekly options
  const optRows = rows.filter(r =>
    r.symbol === "NIFTY" && r.instrumentType === "OPTIDX" && r.expiry && r.expiry >= today
  );

  if (optRows.length === 0) {
    console.warn("[InstrumentTokens] No active NIFTY option contracts found.");
    return { futToken, ceTokens: [], peTokens: [], fetchedAt: new Date(), nearestOptionExpiry: null, futExpiry };
  }

  const nearestExpiryMs = Math.min(...optRows.map(r => r.expiry!.getTime()));
  const nearestExpiry = new Date(nearestExpiryMs);
  nearestExpiry.setUTCHours(0, 0, 0, 0);
  const nearestOptionExpiry = nearestExpiry.toISOString().slice(0, 10);
  console.log(`[InstrumentTokens] Nearest option expiry: ${nearestOptionExpiry}`);

  // Select strikes within ±500 points of ATM (10 strikes each side at 50-pt intervals).
  // Minimum radius is 1000 so that even if the ATM seed is slightly off (e.g., stale Redis
  // or default fallback), we still capture the actual trading range.
  const atmRounded = Math.round(atmStrike / 50) * 50;
  const strikeRadius = 1000; // ±20 strikes — wide enough to cover a stale ATM seed
  const expiryStr = formatExpiryForSymbol(nearestExpiry);

  const strikeRows = optRows.filter(r => {
    if (!r.expiry) return false;
    const d = new Date(r.expiry);
    d.setUTCHours(0, 0, 0, 0);
    return d.getTime() === nearestExpiry.getTime() && Math.abs(r.strike - atmRounded) <= strikeRadius;
  });

  const ceTokens = strikeRows
    .filter(r => r.optionType === "CE")
    .sort((a, b) => a.strike - b.strike)
    .map(r => `NFO|${r.token}:NIFTY${expiryStr}C${r.strike}`);

  const peTokens = strikeRows
    .filter(r => r.optionType === "PE")
    .sort((a, b) => a.strike - b.strike)
    .map(r => `NFO|${r.token}:NIFTY${expiryStr}P${r.strike}`);

  console.log(`[InstrumentTokens] ATM=${atmRounded}: ${ceTokens.length} CE + ${peTokens.length} PE tokens selected.`);

  return { futToken, ceTokens, peTokens, fetchedAt: new Date(), nearestOptionExpiry, futExpiry };
};

/**
 * Download NFO instrument master from Zebu and refresh active token list.
 * Called before each broker connection attempt to stay current across expiries.
 */
export const refreshInstrumentTokens = async (): Promise<ActiveInstrumentTokens | null> => {
  try {
    console.log("[InstrumentTokens] Downloading NFO instrument master from Zebu...");
    const resp = await axios.get<string>(NFO_SYMBOLS_URL, {
      timeout: DOWNLOAD_TIMEOUT_MS,
      responseType: "text",
    });

    const lines = String(resp.data).split("\n");
    console.log(`[InstrumentTokens] NFO file: ${lines.length} lines.`);

    const rows: ZebuNFORow[] = [];
    for (const line of lines) {
      const t = line.trim();
      if (!t || t.startsWith("Exchange") || t.startsWith("Exch")) continue;
      const row = parseNFOLine(line);
      if (row && row.symbol === "NIFTY" && (row.instrumentType === "FUTIDX" || row.instrumentType === "OPTIDX")) {
        rows.push(row);
      }
    }
    console.log(`[InstrumentTokens] Parsed ${rows.length} NIFTY rows.`);

    if (rows.length === 0) {
      console.warn("[InstrumentTokens] No NIFTY rows parsed — NFO file format may have changed.");
      return null;
    }

    // Get current spot price to calculate ATM strike.
    // Priority: ltp:NIFTY-SPOT (live cash index) → ltp:NIFTY-FUT (close proxy, persists from
    // last session even after contract expiry) → hardcoded fallback.
    // The futures price diverges from spot by at most a few points intraday, making it a
    // reliable ATM seed when the spot tick hasn't arrived yet on cold-start.
    let atmStrike = 25500; // Fallback updated to reflect realistic NIFTY range; overridden below
    let atmSource = "fallback-default";
    try {
      const spotStr = await redis.get("ltp:NIFTY-SPOT");
      const futStr  = await redis.get("ltp:NIFTY-FUT");
      const spot = spotStr ? parseFloat(spotStr) : 0;
      const fut  = futStr  ? parseFloat(futStr)  : 0;
      if (spot > 0) {
        atmStrike = spot;
        atmSource = "redis-spot";
      } else if (fut > 0) {
        // Futures price lags spot by at most the fair-value basis (typically <50 pts).
        // Accurate enough for strike selection at ±1000 radius.
        atmStrike = fut;
        atmSource = "redis-futures";
      }
    } catch { /* Redis offline — use default */ }
    const atmWarning = atmSource === "fallback-default"
      ? ` (WARNING: Redis empty — using default ATM ${atmStrike}; if NIFTY has moved >1000pts from here, option selection may miss actual ATM)`
      : "";
    console.log(`[InstrumentTokens] ATM source: ${atmSource} → ${atmStrike}${atmWarning}`);

    const tokens = buildActiveTokens(rows, atmStrike);
    cachedTokens = tokens;
    lastFetchTime = Date.now();
    return tokens;
  } catch (err: any) {
    console.error("[InstrumentTokens] Download/parse failed:", err?.message || err);
    return null;
  }
};

/**
 * Returns cached tokens if fresh, otherwise triggers a refresh.
 */
export const getActiveInstrumentTokens = async (): Promise<ActiveInstrumentTokens | null> => {
  if (cachedTokens && Date.now() - lastFetchTime < CACHE_TTL_MS) return cachedTokens;
  return refreshInstrumentTokens();
};

export const getCachedInstrumentTokens = (): ActiveInstrumentTokens | null => cachedTokens;
