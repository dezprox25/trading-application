import { api } from "../utils/api";
import type { Expiry, Strike } from "./models";

// ── Live expiry/strike data ───────────────────────────────────────────────────
//
// Backed by the real NFO instrument master Zebu already downloads for the live
// feed (instrumentTokenService.ts on the backend) — not a synthetic generator.
// Instrument-type/symbol lists live in ../data/tradingConfig.ts (data-driven,
// no fetch needed).

/** Every real, currently-active expiry for the selected symbol, ascending. */
export const fetchSymbolExpiries = async (instrument: string): Promise<Expiry[]> => {
  if (!instrument) return [];
  const data = await api.get(`/api/module1/expiries/${instrument}`);
  return Array.isArray(data?.expiries) ? data.expiries : [];
};

/** Every real strike price for the selected symbol + expiry, ascending. */
export const fetchStrikes = async (
  instrument: string,
  expiryId: string,
): Promise<Strike[]> => {
  if (!instrument || !expiryId) return [];
  const data = await api.get(`/api/module1/strikes/${instrument}/${expiryId}`);
  return Array.isArray(data?.strikes) ? data.strikes : [];
};
