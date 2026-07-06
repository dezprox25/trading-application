import { api } from "../utils/api";
import type { Exchange, Instrument, ContractMonth, Expiry, Strike } from "./models";

// ── Static catalog ─────────────────────────────────────────────────────────────
//
// Exchange / instrument / contract-month / expiry lists are served from this
// catalog until the OpenAlgo/Zebu Instruments API is connected. Each fetch*
// function keeps the exact signature and return model it will have once it
// proxies the real API, so swapping the implementation requires no UI changes.

const EXCHANGES: Exchange[] = [
  { code: "NFO", name: "NSE Futures & Options" },
  { code: "NSE", name: "National Stock Exchange" },
  { code: "BSE", name: "Bombay Stock Exchange" },
  { code: "MCX", name: "Multi Commodity Exchange" },
  { code: "CDS", name: "Currency Derivatives" },
];

export const DEFAULT_EXCHANGE = "NFO";

const INSTRUMENTS: Record<string, Instrument[]> = {
  NFO: [
    { id: "NIFTY",      symbol: "NIFTY",      name: "Nifty 50" },
    { id: "BANKNIFTY",  symbol: "BANKNIFTY",  name: "Nifty Bank" },
    { id: "FINNIFTY",   symbol: "FINNIFTY",   name: "Nifty Financial Services" },
    { id: "MIDCPNIFTY", symbol: "MIDCPNIFTY", name: "Nifty Midcap Select" },
    { id: "SENSEX",     symbol: "SENSEX",     name: "BSE Sensex" },
    { id: "BANKEX",     symbol: "BANKEX",     name: "BSE Bankex" },
  ],
  // Populated dynamically once the Instruments API is connected.
  NSE: [], BSE: [], MCX: [], CDS: [],
};

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

const MONTHS_UPPER = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const MONTHS_TITLE = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad2 = (n: number) => String(n).padStart(2, "0");

// ── Fetch functions (async to match the future API shape) ─────────────────────

export const fetchExchanges = async (): Promise<Exchange[]> => EXCHANGES;

export const fetchInstruments = async (exchange: string): Promise<Instrument[]> =>
  INSTRUMENTS[exchange] ?? [];

/** Next `count` contract months starting from the current month. */
export const fetchContractMonths = async (
  _exchange: string,
  instrument: string,
  count = 4,
): Promise<ContractMonth[]> => {
  if (!instrument) return [];
  const now = new Date();
  const result: ContractMonth[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    result.push({
      id: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`,
      month: MONTHS_UPPER[d.getMonth()],
      year: d.getFullYear(),
    });
  }
  return result;
};

/** Expiries within the selected contract month ("YYYY-MM"), future dates only. */
export const fetchExpiries = async (
  _exchange: string,
  instrument: string,
  contractMonthId: string,
): Promise<Expiry[]> => {
  const m = /^(\d{4})-(\d{2})$/.exec(contractMonthId);
  const rule = EXPIRY_RULES[instrument];
  if (!m || !rule) return [];

  const year = Number(m[1]);
  const month = Number(m[2]) - 1; // 0-based
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Collect every matching weekday in the month
  const dates: Date[] = [];
  const d = new Date(year, month, 1);
  while (d.getMonth() === month) {
    if (d.getDay() === rule.weekday) dates.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }

  const candidates = rule.weekly ? dates : dates.slice(-1); // monthly = last weekday
  return candidates
    .filter(dt => dt >= today)
    .map(dt => ({
      id: `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`,
      expiry: `${pad2(dt.getDate())} ${MONTHS_TITLE[dt.getMonth()]} ${dt.getFullYear()}`,
    }));
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
