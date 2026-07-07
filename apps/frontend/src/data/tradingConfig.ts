// ── Trading selection config ──────────────────────────────────────────────────
//
// Data-driven catalog for the simplified selection panel: Instrument → Symbol →
// Expiry Date. Adding a new instrument type or symbol only requires editing the
// tables below — no UI/component changes needed.

export interface InstrumentTypeOption {
  value: string;
  label: string;
}

/** Display order for the Instrument dropdown. Label is the raw instrument
 *  value itself — no descriptive names are shown. */
export const INSTRUMENT_TYPES: InstrumentTypeOption[] = [
  { value: "OPTIDX", label: "OPTIDX" },
  { value: "FUTIDX", label: "FUTIDX" },
  { value: "INDEX",  label: "INDEX" },
  { value: "EQ",     label: "EQ" },
  { value: "OPTSTK", label: "OPTSTK" },
  { value: "FUTSTK", label: "FUTSTK" },
  { value: "FUTCUR", label: "FUTCUR" },
  { value: "OPTCUR", label: "OPTCUR" },
  { value: "FUTCOM", label: "FUTCOM" },
  { value: "OPTCOM", label: "OPTCOM" },
];

export const DEFAULT_INSTRUMENT_TYPE = "OPTIDX";

const INDEX_SYMBOLS = [
  "NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50", "SENSEX", "BANKEX",
];

/** Instrument type → symbols it offers. Stock/currency/commodity lists are
 *  empty for now and can be populated here without touching the UI. */
export const tradingConfig: Record<string, { symbols: string[] }> = {
  INDEX:  { symbols: INDEX_SYMBOLS },
  FUTIDX: { symbols: INDEX_SYMBOLS },
  OPTIDX: { symbols: INDEX_SYMBOLS },
  EQ:     { symbols: [] },
  FUTSTK: { symbols: [] },
  OPTSTK: { symbols: [] },
  FUTCUR: { symbols: [] },
  OPTCUR: { symbols: [] },
  FUTCOM: { symbols: [] },
  OPTCOM: { symbols: [] },
};

/** Instrument types that settle/expire and therefore need an Expiry Date picker. */
const NO_EXPIRY_TYPES = new Set(["INDEX", "EQ"]);

export const requiresExpiry = (instrumentType: string): boolean =>
  !NO_EXPIRY_TYPES.has(instrumentType);
