// Pure TypeScript calculation engine — no React imports.

export interface OHLCBar {
  t: number; // unix ms
  o: number;
  h: number;
  l: number;
  c: number;
}

export interface PivotLevels {
  pp: number;
  r1: number; r2: number; r3: number;
  s1: number; s2: number; s3: number;
}

export interface RatingResult {
  value: number;
  label: "Strong Sell" | "Sell" | "Hold" | "Buy" | "Strong Buy";
}

export interface FibLevel {
  label: string;
  value: number;
}

// Snapshot of the OI matrix at the moment a row is assembled.
export interface OiSnapshot {
  tin: number;
  c_tl: number; c_mn: number; c_hig: number; c_low: number;
  c_buy: number; c_sell: number;
  f_buy: number; f_sell: number;
  p_tl: number; p_mn: number; p_hig: number; p_low: number;
  p_buy: number; p_sell: number;
  callSignal: string;
  putSignal: string;
  dataSource: string;
}

// ── Dashboard row model (v2 — 31-column spec) ─────────────────────────────────
// Each row represents one completed (or live-forming) bar of the active timeframe.

export interface DashboardRow {
  t: number;
  // Per-side full OHLC bars
  call:   OHLCBar;   // CE option premium
  put:    OHLCBar;   // PE option premium
  future: OHLCBar;   // NIFTY-FUT
  spot:   OHLCBar;   // NIFTY-SPOT (falls back to NIFTY-FUT when Spot unavailable)
  // Pre-computed MMA and TLA for all four sides
  callMMA:   number;
  callTLA:   number;
  putMMA:    number;
  putTLA:    number;
  futureMMA: number;
  futureTLA: number;
  spotMMA:   number;
  spotTLA:   number;
  // Ranking — the higher of Call MMA vs Put MMA, plus which side won (for cell colour)
  ranking:       number;
  rankingWinner: "call" | "put";
  // Indicators
  smc:  string;
  fib:  string;
  rsi:  number | null;
  ema:  number | null;   // EMA-20 of Spot Close (confirm period)
  vwap: number | null;   // Session cumulative avg of TP=(H+L+C)/3 (confirm with volume)
  // OI snapshot (kept for Module 1 OI sidebar)
  oiMatrix: OiSnapshot | null;
}

// ── Legacy pivot calculations (kept for reference; not used in v2 row builder) ─

export function clientPivot4Bar(bar: OHLCBar): PivotLevels {
  const pp = (bar.o + bar.h + bar.l + bar.c) / 4;
  return {
    pp,
    r1: 2 * pp - bar.l,  r2: pp + (bar.h - bar.l),  r3: bar.h + 2 * (pp - bar.l),
    s1: 2 * pp - bar.h,  s2: pp - (bar.h - bar.l),  s3: bar.l - 2 * (bar.h - pp),
  };
}

export function classicPivot(bar: OHLCBar): PivotLevels {
  const pp = (bar.h + bar.l + bar.c) / 3;
  return {
    pp,
    r1: 2 * pp - bar.l,  r2: pp + (bar.h - bar.l),  r3: bar.h + 2 * (pp - bar.l),
    s1: 2 * pp - bar.h,  s2: pp - (bar.h - bar.l),  s3: bar.l - 2 * (bar.h - pp),
  };
}

// ── MMA v2 / TLA v2 ──────────────────────────────────────────────────────────
// Client formula (v2 spec): MMA = (O + H + L + (MMA_CLOSE_SIGN × C)) / 4
// With MMA_CLOSE_SIGN = −1 (as written by the client) MMA ≈ half the price and
// TLA = 2×MMA − H can be negative.  Change to +1 if confirmed a typo.
export const MMA_CLOSE_SIGN = -1 as const;

export function mmaBar(bar: OHLCBar): number {
  return (bar.o + bar.h + bar.l + MMA_CLOSE_SIGN * bar.c) / 4;
}

// TLA = 2 × MMA − High  (derived from MMA, not re-derived from the bar)
export function tlaFromMMA(barMMA: number, barHigh: number): number {
  return 2 * barMMA - barHigh;
}

// ── Ranking ───────────────────────────────────────────────────────────────────
// Compares Call MMA vs Put MMA only (Future/Spot not included).
// TODO confirm tie behaviour — defaulting to Call MMA on tie (diff ≥ 0 → call).
export function computeRanking(callMMA: number, putMMA: number): { value: number; winner: "call" | "put" } {
  if (callMMA - putMMA >= 0) return { value: callMMA, winner: "call" };
  return { value: putMMA, winner: "put" };
}

// ── EMA ───────────────────────────────────────────────────────────────────────
// Period defaults to 20 (CONFIRM with client).
// Source: Spot Close; caller falls back to Future Close if Spot unavailable.
// Seeded with SMA of the first `period` values; returns null until seeded.
export function computeEMASeries(closes: number[], period = 20): (number | null)[] {
  const k = 2 / (period + 1);
  const out: (number | null)[] = [];
  let ema: number | null = null;
  let seedSum = 0;

  for (let i = 0; i < closes.length; i++) {
    seedSum += closes[i];
    if (i < period - 1) {
      out.push(null);
    } else if (i === period - 1) {
      ema = seedSum / period;
      out.push(ema);
    } else {
      ema = closes[i] * k + ema! * (1 - k);
      out.push(ema);
    }
  }
  return out;
}

// ── VWAP ──────────────────────────────────────────────────────────────────────
// Session-cumulative average of Typical Price = (H+L+C)/3.
// Volume weighting omitted because OHLCBar has no volume field yet.
// TODO: add v?: number to OHLCBar and weight by volume when available.
// Source: Spot bars; caller falls back to Future bars if Spot unavailable.
// Resets every session (caller is responsible for feeding only today's bars).
export function computeVWAPSeries(bars: OHLCBar[]): (number | null)[] {
  const out: (number | null)[] = [];
  let cumTP = 0;
  for (let i = 0; i < bars.length; i++) {
    const { h, l, c } = bars[i];
    cumTP += (h + l + c) / 3;
    out.push(cumTP / (i + 1));
  }
  return out;
}

// ── RSI (Wilder) ─────────────────────────────────────────────────────────────

export function computeRsiSeries(closes: number[], period = 14): (number | null)[] {
  const result: (number | null)[] = [];
  if (closes.length === 0) return result;

  for (let i = 0; i < Math.min(period, closes.length); i++) result.push(null);
  if (closes.length <= period) return result;

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = closes[i] - closes[i - 1];
    avgGain += Math.max(ch, 0);
    avgLoss += Math.max(-ch, 0);
  }
  avgGain /= period;
  avgLoss /= period;
  result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));

  for (let i = period + 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(ch, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-ch, 0)) / period;
    result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return result;
}

// ── Fibonacci retracement ─────────────────────────────────────────────────────

const FIB_RATIOS = [0.236, 0.382, 0.5, 0.618, 0.786];

export function fibLevels(high: number, low: number): FibLevel[] {
  const diff = high - low;
  return FIB_RATIOS.map(r => ({ label: `${(r * 100).toFixed(1)}%`, value: high - diff * r }));
}

export function nearestFibLabel(price: number, high: number, low: number): string | null {
  if (high <= low) return null;
  const levels = fibLevels(high, low);
  const nearest = levels.reduce((best, lvl) =>
    Math.abs(lvl.value - price) < Math.abs(best.value - price) ? lvl : best
  );
  return `${nearest.label} ${nearest.value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── SMC structural levels ─────────────────────────────────────────────────────

export function smcNearest(
  close: number,
  swHigh: number,
  swLow: number,
  pdh: number,
  pdl: number,
): string {
  const candidates = [
    { label: "SWH", value: swHigh },
    { label: "SWL", value: swLow },
    { label: "PDH", value: pdh },
    { label: "PDL", value: pdl },
  ];
  const nearest = candidates.reduce((best, c) =>
    Math.abs(c.value - close) < Math.abs(best.value - close) ? c : best
  );
  return `${nearest.label} ${nearest.value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Rating engine (kept for backward compat; not used in v2 DashboardRow) ─────

export function aggregateRating(votes: number[]): RatingResult {
  const v = votes.length ? votes.reduce((a, b) => a + b, 0) / votes.length : 0;
  const label: RatingResult["label"] =
    v < -0.5 ? "Strong Sell" :
    v < -0.1 ? "Sell"        :
    v <=  0.1 ? "Hold"       :
    v <=  0.5 ? "Buy"        : "Strong Buy";
  return { value: v, label };
}
