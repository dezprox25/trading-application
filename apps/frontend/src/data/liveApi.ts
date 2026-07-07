import { api } from "../utils/api";
import type { Expiry, Strike } from "./models";

// ── Static catalog ─────────────────────────────────────────────────────────────
//
// Expiry / strike lists are served from this catalog until the OpenAlgo/Zebu
// Instruments API is connected. Each fetch* function keeps the exact signature
// and return model it will have once it proxies the real API, so swapping the
// implementation requires no UI changes. Instrument-type/symbol lists live in
// ../data/tradingConfig.ts (data-driven, no fetch needed).

/** Weekly-expiry weekday per underlying (real F&O calendar: NSE weeklies expire
 *  Tuesday, BSE weeklies Thursday; non-weekly underlyings get monthly only).
 *  Catalog data — replaced by real expiries from the Instruments API. */
const EXPIRY_RULES: Record<string, { weekday: number; weekly: boolean }> = {
  NIFTY:      { weekday: 2, weekly: true  },
  BANKNIFTY:  { weekday: 2, weekly: false },
  FINNIFTY:   { weekday: 2, weekly: false },
  MIDCPNIFTY: { weekday: 2, weekly: false },
  SENSEX:     { weekday: 4, weekly: true  },
  BANKEX:     { weekday: 4, weekly: false },
};

const INDEX_MAP: Record<string, string> = {
  NIFTY: "NIFTY50", BANKNIFTY: "BANKNIFTY50",
  FINNIFTY: "FINNIFTY", MIDCPNIFTY: "MIDCPNIFTY",
  SENSEX: "SENSEX", BANKEX: "BANKEX",
};

const MONTHS_TITLE = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad2 = (n: number) => String(n).padStart(2, "0");

// ── Fetch functions (async to match the future API shape) ─────────────────────

const toExpiry = (d: Date): Expiry => ({
  id: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
  expiry: `${pad2(d.getDate())} ${MONTHS_TITLE[d.getMonth()]} ${d.getFullYear()}`,
});

/** Last occurrence of `weekday` within the month containing `monthStart`. */
const lastWeekdayOfMonth = (monthStart: Date, weekday: number): Date => {
  const nextMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
  const d = new Date(nextMonth.getTime() - 24 * 60 * 60 * 1000); // last day of month
  const diff = (d.getDay() - weekday + 7) % 7;
  d.setDate(d.getDate() - diff);
  return d;
};

/** Next `count` future expiries for the selected symbol, nearest first. */
export const fetchSymbolExpiries = async (
  instrument: string,
  count = 6,
): Promise<Expiry[]> => {
  const rule = EXPIRY_RULES[instrument];
  if (!instrument || !rule) return [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const results: Expiry[] = [];

  if (rule.weekly) {
    const d = new Date(today);
    while (results.length < count) {
      if (d.getDay() === rule.weekday && d >= today) results.push(toExpiry(d));
      d.setDate(d.getDate() + 1);
    }
  } else {
    let monthCursor = new Date(today.getFullYear(), today.getMonth(), 1);
    while (results.length < count) {
      const last = lastWeekdayOfMonth(monthCursor, rule.weekday);
      if (last >= today) results.push(toExpiry(last));
      monthCursor = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 1);
    }
  }

  return results;
};

// ── Live strikes from the real option-chain endpoint ─────────────────────────

export const fetchStrikes = async (
  instrument: string,
  _expiryId: string,
): Promise<Strike[]> => {
  const index = INDEX_MAP[instrument] ?? "NIFTY50";
  const data = await api.get(`/api/market/option-chain/${index}`);
  if (Array.isArray(data?.strikes)) {
    return data.strikes.map((s: { strikePrice: number }) => ({ value: s.strikePrice }));
  }
  return [];
};
