// ── Trading-selection data models ─────────────────────────────────────────────
//
// The selection UI (Exchange → Instrument → Contract Month → Expiry → Strike)
// consumes ONLY these models. Whether the data comes from the static catalog in
// liveApi.ts or the OpenAlgo/Zebu Instruments API, components must not care.
//
// OpenAlgo mapping (future): exchange → symbol → expiry → strike →
// instrumenttype → brsymbol → token. Broker symbols and tokens are internal —
// never rendered in the UI; they are used for market-data subscriptions and
// order placement only.

export interface Exchange {
  /** Broker exchange code, e.g. "NFO" */
  code: string;
  /** Human-readable name, e.g. "NSE Futures & Options" */
  name: string;
}

export interface Instrument {
  /** Stable id (currently same as symbol) */
  id: string;
  /** Underlying symbol, e.g. "NIFTY" */
  symbol: string;
  /** Display name, e.g. "Nifty 50" */
  name: string;
}

export interface ContractMonth {
  /** Internal id "YYYY-MM", e.g. "2026-07" */
  id: string;
  /** Display month, e.g. "JUL" */
  month: string;
  /** Full year, e.g. 2026 */
  year: number;
}

export interface Expiry {
  /** Internal ISO date "YYYY-MM-DD", e.g. "2026-07-07" */
  id: string;
  /** Display label, e.g. "07 Jul 2026" */
  expiry: string;
}

export interface Strike {
  value: number;
}

// ── Formatting helpers ─────────────────────────────────────────────────────────

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-07" + "JUL"/2026 → "JUL 2026" */
export function formatContractMonth(m: ContractMonth): string {
  return `${m.month} ${m.year}`;
}

/** ISO "2026-07-07" → display "07 Jul 2026". Returns "" for empty/invalid input. */
export function formatExpiryDisplay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return "";
  const [, y, mo, d] = m;
  return `${d} ${MONTHS_SHORT[Number(mo) - 1]} ${y}`;
}

/** ISO "2026-07-07" → broker expiry fragment "07JUL26" (internal use only). */
export function formatExpiryForBroker(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return "";
  const [, y, mo, d] = m;
  return `${d}${MONTHS_SHORT[Number(mo) - 1].toUpperCase()}${y.slice(-2)}`;
}
