import axios from "axios";
import AdmZip from "adm-zip";
import { readLive } from "./redisWriteBuffer";

// BROKER_MASTER_SOURCE_AUDIT.md: the previous plain-.txt URL is a stale, apparently abandoned
// mirror (Last-Modified was ~9 months old, content stopped updating in 2023). Zebu's actively
// refreshed instrument master — confirmed via HTTP headers (same-day Last-Modified) and via the
// OpenAlgo broker integration, which uses this exact URL in production — is the .zip variant at
// the same domain/filename. The CSV inside is byte-for-byte the same column layout as before, so
// parseNFOLine/parseExpiry below are unchanged; only the download+extraction step differs.
const NFO_SYMBOLS_URL = "https://go.mynt.in/NFO_symbols.txt.zip";
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
  // False when the strike band above was selected around a stale hardcoded ATM guess
  // (Redis had no live spot/futures price yet at connect time) rather than a real price.
  atmIsReliable: boolean;
}

let cachedTokens: ActiveInstrumentTokens | null = null;
let lastFetchTime = 0;

// Raw NFO rows + nearest option expiry from the last successful refresh, kept around so
// on-demand lookups (exact strike resolution, ATM-band recompute once a real tick arrives)
// don't need to re-download the instrument master.
let cachedRows: ZebuNFORow[] = [];
let cachedNearestExpiry: Date | null = null;

const MONTH_ABBR_TO_NUM: Record<string, string> = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

const parseExpiry = (raw: string): Date | null => {
  const s = (raw || "").trim();
  if (!s || s === "0") return null;

  // ISO: 2026-07-31
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + "T00:00:00.000Z");

  // DD-Mon-YYYY: 31-Jul-2026 (this is the format the live NFO_symbols.txt actually uses,
  // e.g. "27-JUL-2023", "31-DEC-2026"). `new Date("2026-DEC-31T...")` is NOT valid ISO 8601
  // (month must be numeric) and silently produces an Invalid Date — whose comparisons like
  // `expiry >= today` are always false, not an exception, so every row with this expiry
  // format was silently treated as "not active" without any error. Map the month name to a
  // zero-padded number so the resulting string is real ISO 8601.
  const dm = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(s);
  if (dm) {
    const monthNum = MONTH_ABBR_TO_NUM[dm[2].toUpperCase()];
    if (monthNum) return new Date(`${dm[3]}-${monthNum}-${dm[1].padStart(2, "0")}T00:00:00.000Z`);
  }

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

  // Verified against the live file (2026-07-02, go.mynt.in/NFO_symbols.txt), header row:
  //   Exchange,Token,LotSize,Symbol,TradingSymbol,Expiry,Instrument,OptionType,StrikePrice,TickSize
  // Sample: NFO,42697,50,NIFTY,NIFTY27JUL23F,27-JUL-2023,FUTIDX,XX,-0.01,0.05
  // Columns 6 (Instrument) and 8 (StrikePrice) were previously swapped with the wrong
  // labels here, so every row's `instrumentType` actually held the tick-size string
  // (e.g. "0.05") and never matched "FUTIDX"/"OPTIDX" — refreshInstrumentTokens()
  // silently parsed 0 NIFTY rows every time, so it always fell back to the expired
  // tokens hardcoded in .env instead of the live instrument master.
  const [exchange, token, , symbol, tradingSymbol, expiryStr, instrumentType, optionType, strikeStr] = parts;

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

const findNearestOptionExpiry = (rows: ZebuNFORow[]): Date | null => {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const optRows = rows.filter(r => r.symbol === "NIFTY" && r.instrumentType === "OPTIDX" && r.expiry && r.expiry >= today);
  if (optRows.length === 0) return null;
  const nearestExpiryMs = Math.min(...optRows.map(r => r.expiry!.getTime()));
  const nearestExpiry = new Date(nearestExpiryMs);
  nearestExpiry.setUTCHours(0, 0, 0, 0);
  return nearestExpiry;
};

/**
 * Selects CE/PE tokens for the given expiry within `strikeRadius` of `atmStrike`.
 * Shared by the startup token build (buildActiveTokens) and the on-demand ATM-band
 * recompute (recomputeOptionBandFromLivePrice) so both use identical selection logic.
 */
const selectOptionTokens = (
  rows: ZebuNFORow[],
  nearestExpiry: Date,
  atmStrike: number,
  strikeRadius: number
): { ceTokens: string[]; peTokens: string[]; expiryStr: string } => {
  const atmRounded = Math.round(atmStrike / 50) * 50;
  const expiryStr = formatExpiryForSymbol(nearestExpiry);

  const strikeRows = rows.filter(r => {
    if (r.symbol !== "NIFTY" || r.instrumentType !== "OPTIDX" || !r.expiry) return false;
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

  return { ceTokens, peTokens, expiryStr };
};

const buildActiveTokens = (rows: ZebuNFORow[], atmStrike: number, atmIsReliable: boolean): ActiveInstrumentTokens => {
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

  const nearestExpiry = findNearestOptionExpiry(rows);
  if (!nearestExpiry) {
    console.warn("[InstrumentTokens] No active NIFTY option contracts found.");
    return { futToken, ceTokens: [], peTokens: [], fetchedAt: new Date(), nearestOptionExpiry: null, futExpiry, atmIsReliable };
  }
  cachedNearestExpiry = nearestExpiry;
  const nearestOptionExpiry = nearestExpiry.toISOString().slice(0, 10);
  console.log(`[InstrumentTokens] Nearest option expiry: ${nearestOptionExpiry}`);

  // Select strikes around ATM. When the ATM seed came from a live Redis price
  // (redis-spot / redis-futures) it's trustworthy, so a tight ±1000 radius is enough.
  // When it fell back to the hardcoded default (no Redis data yet — e.g. cold start
  // before any tick has arrived this session), that constant WILL drift out of date
  // as NIFTY moves over weeks/months. A tight radius around a stale fallback silently
  // excludes the real ATM strikes from subscription entirely — Zebu then never sends
  // ticks for the strikes the user actually selects, which is indistinguishable from a
  // broken feed (CE/PE OHLC permanently empty). Widen the net substantially in that case
  // as an immediate safety net; the real fix is dataFeed.ts recomputing the band from the
  // first genuine spot/futures tick (see recomputeOptionBandFromLivePrice below) and from
  // the frontend's on-demand `subscribe:options` request (see resolveOptionInstrument).
  const strikeRadius = atmIsReliable ? 1000 : 5000;
  const { ceTokens, peTokens } = selectOptionTokens(rows, nearestExpiry, atmStrike, strikeRadius);

  console.log(`[InstrumentTokens] ATM=${Math.round(atmStrike / 50) * 50} (reliable=${atmIsReliable}, radius=${strikeRadius}): ${ceTokens.length} CE + ${peTokens.length} PE tokens selected.`);

  return { futToken, ceTokens, peTokens, fetchedAt: new Date(), nearestOptionExpiry, futExpiry, atmIsReliable };
};

/**
 * Download NFO instrument master from Zebu and refresh active token list.
 * Called before each broker connection attempt to stay current across expiries.
 */
export const refreshInstrumentTokens = async (): Promise<ActiveInstrumentTokens | null> => {
  try {
    console.log(`[InstrumentTokens] Downloading NFO instrument master from ${NFO_SYMBOLS_URL} ...`);
    const resp = await axios.get<ArrayBuffer>(NFO_SYMBOLS_URL, {
      timeout: DOWNLOAD_TIMEOUT_MS,
      responseType: "arraybuffer",
    });
    const downloadedAt = new Date();
    const zipBuffer = Buffer.from(resp.data);

    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries();
    const entry = entries.find(e => e.entryName.toLowerCase().endsWith(".txt")) ?? entries[0];
    if (!entry) {
      console.error("[InstrumentTokens] Downloaded zip has no entries — cannot extract instrument master.");
      return null;
    }
    const fileText = zip.readAsText(entry);

    // Phase 1 diagnostics: download URL, timestamp, and file size (compressed vs. extracted).
    console.log(
      `[InstrumentTokens] Download complete — url=${NFO_SYMBOLS_URL} timestamp=${downloadedAt.toISOString()} ` +
      `zipBytes=${zipBuffer.length} extractedBytes=${entry.header.size} entry="${entry.entryName}"`
    );

    const lines = fileText.split("\n");
    console.log(`[InstrumentTokens] NFO file: ${lines.length} lines.`);

    const rows: ZebuNFORow[] = [];
    let totalParsedRows = 0;
    for (const line of lines) {
      const t = line.trim();
      if (!t || t.startsWith("Exchange") || t.startsWith("Exch")) continue;
      const row = parseNFOLine(line);
      if (!row) continue;
      totalParsedRows++;
      if (row.symbol === "NIFTY" && (row.instrumentType === "FUTIDX" || row.instrumentType === "OPTIDX")) {
        rows.push(row);
      }
    }
    // Phase 1 diagnostics: total rows (all symbols) vs. the NIFTY-only subset actually cached.
    console.log(`[InstrumentTokens] Total rows parsed (all symbols): ${totalParsedRows} | Total NIFTY rows: ${rows.length}`);

    if (rows.length === 0) {
      console.warn("[InstrumentTokens] No NIFTY rows parsed — NFO file format may have changed.");
      return null;
    }

    // Cache raw rows for on-demand lookups (exact strike resolution, ATM-band recompute)
    // so those don't need to re-download the instrument master.
    cachedRows = rows;

    // Phase 1 diagnostics: active contract counts + every unique NIFTY expiry now loaded, so
    // it's possible to confirm at a glance whether the cache contains current contracts
    // without a separate manual audit script.
    {
      const todayForDiag = new Date();
      todayForDiag.setUTCHours(0, 0, 0, 0);
      const activeFutRows = rows.filter(r => r.instrumentType === "FUTIDX" && r.expiry && r.expiry >= todayForDiag);
      const activeOptRows = rows.filter(r => r.instrumentType === "OPTIDX" && r.expiry && r.expiry >= todayForDiag);
      const uniqueExpiries = [...new Set(rows.filter(r => r.expiry).map(r => r.expiry!.toISOString().slice(0, 10)))].sort();
      console.log(`[InstrumentTokens] Active NIFTY FUTIDX rows (expiry >= today): ${activeFutRows.length}`);
      console.log(`[InstrumentTokens] Active NIFTY OPTIDX rows (expiry >= today): ${activeOptRows.length}`);
      console.log(`[InstrumentTokens] Unique NIFTY expiries loaded (${uniqueExpiries.length}): ${uniqueExpiries.join(", ")}`);
    }

    // Get current spot price to calculate ATM strike.
    // Priority: ltp:NIFTY-SPOT (live cash index) → ltp:NIFTY-FUT (close proxy, persists from
    // last session even after contract expiry) → hardcoded fallback.
    // The futures price diverges from spot by at most a few points intraday, making it a
    // reliable ATM seed when the spot tick hasn't arrived yet on cold-start.
    let atmStrike = 25500; // Fallback updated to reflect realistic NIFTY range; overridden below
    let atmSource = "fallback-default";
    try {
      const spotStr = await readLive("ltp:NIFTY-SPOT");
      const futStr  = await readLive("ltp:NIFTY-FUT");
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
    const atmIsReliable = atmSource !== "fallback-default";
    const atmWarning = atmIsReliable
      ? ""
      : ` (WARNING: Redis empty — using default ATM ${atmStrike}; widening strike radius to compensate for a possibly stale seed)`;
    console.log(`[InstrumentTokens] ATM source: ${atmSource} → ${atmStrike}${atmWarning}`);

    const tokens = buildActiveTokens(rows, atmStrike, atmIsReliable);
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

/**
 * Resolves the exact NFO token for one option contract by instrument + expiry + strike +
 * type, independent of the ATM band selected at connect time. Used by the on-demand
 * `subscribe:options` socket handler so the user's chosen strike is always resolvable even
 * if it fell outside the ATM band picked at startup.
 * Returns null if the instrument master hasn't been loaded yet or the contract isn't found
 * (wrong strike/expiry, or expired).
 */
export const resolveOptionInstrument = (
  instrument: string,
  expiryFmt: string,
  strike: number,
  optionType: "CE" | "PE"
): { exchange: string; token: string; symbol: string } | null => {
  if (!cachedRows.length) return null;
  const inst = instrument.toUpperCase();

  const row = cachedRows.find(r =>
    r.symbol === inst &&
    r.instrumentType === "OPTIDX" &&
    r.optionType === optionType &&
    r.strike === strike &&
    r.expiry && formatExpiryForSymbol(r.expiry) === expiryFmt
  );
  if (!row) return null;

  const letter = optionType === "CE" ? "C" : "P";
  return { exchange: row.exchange, token: row.token, symbol: `${inst}${expiryFmt}${letter}${strike}` };
};

/**
 * Recomputes the ±1000 ATM strike band from a real spot/futures price (called once, when
 * the first genuine tick arrives after a cold start where the initial band was built off
 * the unreliable hardcoded fallback). Returns the CE/PE token strings to runtime-subscribe.
 */
export const recomputeOptionBandFromLivePrice = (
  livePrice: number
): { ceTokens: string[]; peTokens: string[] } | null => {
  if (!cachedRows.length || !cachedNearestExpiry) return null;
  const { ceTokens, peTokens } = selectOptionTokens(cachedRows, cachedNearestExpiry, livePrice, 1000);
  console.log(`[InstrumentTokens] Recomputed ATM band from live price ${livePrice} → ${ceTokens.length} CE + ${peTokens.length} PE tokens (±1000, expiry=${cachedNearestExpiry.toISOString().slice(0, 10)}).`);
  return { ceTokens, peTokens };
};
