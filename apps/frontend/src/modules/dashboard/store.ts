import { create } from "zustand";
import type { DashboardRow } from "../../calc";

type PivotMethod = "client" | "classic";
export type FeedStatus =
  | "idle"
  | "connecting"
  | "live"
  | "interrupted"
  | "market-closed"
  | "auth-error"
  | "api-error"
  | "no-network"
  | "broker-disconnected"
  | "session-expired"
  | "reconnecting";

interface DashboardStore {
  // Config selection
  exchange: string;
  instrument: string;
  symbol: string;
  type: "Call" | "Put" | "Call+Put";
  callStrike: number | null;
  putStrike:  number | null;
  strike:     number | null;

  // Generated
  isGenerated:     boolean;
  timeframe:       string;
  customRange:     { from: string; to: string; candleTf: string } | null;
  pivotMethod:     PivotMethod;
  configCollapsed: boolean;

  // Live data
  rows:       DashboardRow[];
  feedStatus: FeedStatus;
  spotLtp:    number | null;
  futureLtp:  number | null;
  spotDir:    "up" | "down" | null;
  futureDir:  "up" | "down" | null;

  // Column preferences
  hiddenCols: string[];

  // Actions
  setExchange(v: string): void;
  setInstrument(v: string): void;
  setSymbol(v: string): void;
  setType(v: "Call" | "Put" | "Call+Put"): void;
  setCallStrike(v: number | null): void;
  setPutStrike(v: number | null): void;
  setStrike(v: number | null): void;
  generate(): void;
  reset(): void;
  clearRows(): void;
  setTimeframe(tf: string): void;
  setCustomRange(r: { from: string; to: string; candleTf: string } | null): void;
  setPivotMethod(m: PivotMethod): void;
  toggleConfigCollapsed(): void;
  appendRow(row: DashboardRow): void;
  updateLatestRow(partial: Partial<DashboardRow>): void;
  setFeedStatus(s: FeedStatus): void;
  setLivePrices(spot: number, future: number): void;
  toggleColumn(id: string): void;
}

const savedHidden = (): string[] => {
  try { return JSON.parse(localStorage.getItem("m1_cols") ?? "[]"); }
  catch { return []; }
};

export const useDashStore = create<DashboardStore>((set, get) => ({
  exchange: "", instrument: "", symbol: "",
  type: "Call+Put",
  callStrike: null, putStrike: null, strike: null,
  isGenerated: false,
  timeframe: "5m", customRange: null, pivotMethod: "client", configCollapsed: false,
  rows: [], feedStatus: "idle",
  spotLtp: null, futureLtp: null, spotDir: null, futureDir: null,
  hiddenCols: savedHidden(),

  setExchange:   (v) => set({ exchange: v, instrument: "", symbol: "", callStrike: null, putStrike: null, strike: null }),
  setInstrument: (v) => set({ instrument: v, symbol: "", callStrike: null, putStrike: null, strike: null }),
  setSymbol:     (v) => set({ symbol: v, callStrike: null, putStrike: null, strike: null }),
  setType:       (v) => set({ type: v }),
  setCallStrike: (v) => set({ callStrike: v }),
  setPutStrike:  (v) => set({ putStrike: v }),
  setStrike:     (v) => set({ strike: v }),
  generate:      ()  => set({ isGenerated: true, rows: [] }),
  reset:         ()  => set({ isGenerated: false, rows: [], feedStatus: "idle" }),
  clearRows:     ()  => set({ rows: [] }),
  setTimeframe:  (tf) => set({ timeframe: tf }),
  setCustomRange: (r) => set({ customRange: r }),
  setPivotMethod: (m) => set({ pivotMethod: m }),
  toggleConfigCollapsed: () => set((s) => ({ configCollapsed: !s.configCollapsed })),

  appendRow: (row) => set((s) => ({ rows: [...s.rows, row].slice(-15) })),

  updateLatestRow: (partial) => set((s) => {
    if (s.rows.length === 0) return {};
    const updated = [...s.rows];
    updated[updated.length - 1] = { ...updated[updated.length - 1], ...partial } as DashboardRow;
    return { rows: updated };
  }),

  setFeedStatus: (feedStatus) => set({ feedStatus }),

  setLivePrices: (spot, future) => set((s) => {
    const spotDir   = s.spotLtp   !== null ? (spot   > s.spotLtp   ? "up" : spot   < s.spotLtp   ? "down" : s.spotDir)   : null;
    const futureDir = s.futureLtp !== null ? (future > s.futureLtp ? "up" : future < s.futureLtp ? "down" : s.futureDir) : null;
    return { spotLtp: spot, futureLtp: future, spotDir, futureDir };
  }),

  toggleColumn: (id) => {
    const current = get().hiddenCols;
    const hidden  = current.includes(id) ? current.filter(c => c !== id) : [...current, id];
    try { localStorage.setItem("m1_cols", JSON.stringify(hidden)); } catch { /* noop */ }
    set({ hiddenCols: hidden });
  },
}));
