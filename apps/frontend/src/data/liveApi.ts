import { api } from "../utils/api";

// ── Static catalog (exchange/instrument/symbol are configuration, not market data) ──

const INSTRUMENTS: Record<string, string[]> = {
  NSE: ["NIFTY", "BANKNIFTY", "FINNIFTY"],
  BSE: ["SENSEX", "BANKEX"],
};

const SYMBOLS: Record<string, string[]> = {
  NIFTY:     ["NIFTY 26JUN", "NIFTY 31JUL"],
  BANKNIFTY: ["BANKNIFTY 26JUN"],
  FINNIFTY:  ["FINNIFTY 26JUN"],
  SENSEX:    ["SENSEX 26JUN"],
  BANKEX:    ["BANKEX 26JUN"],
};

const INDEX_MAP: Record<string, string> = {
  NIFTY: "NIFTY50", BANKNIFTY: "BANKNIFTY50",
  FINNIFTY: "FINNIFTY", SENSEX: "SENSEX", BANKEX: "BANKEX",
};

export const fetchExchanges   = async (): Promise<string[]> => ["NSE", "BSE"];
export const fetchInstruments = async (exchange: string): Promise<string[]> => INSTRUMENTS[exchange] ?? [];
export const fetchSymbols     = async (instrument: string): Promise<string[]> => SYMBOLS[instrument] ?? [];

// ── Live strikes from the real option-chain endpoint ─────────────────────────

export const fetchStrikes = async (symbol: string): Promise<number[]> => {
  const instrument = symbol.split(" ")[0] ?? "NIFTY";
  const index = INDEX_MAP[instrument] ?? "NIFTY50";
  const data = await api.get(`/api/market/option-chain/${index}`);
  if (Array.isArray(data?.strikes)) {
    return data.strikes.map((s: { strikePrice: number }) => s.strikePrice);
  }
  return [];
};
