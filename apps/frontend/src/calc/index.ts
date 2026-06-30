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
// Matches the Module1OiMetrics shape from module1OiService / useStore,
// kept here as a plain interface so calc/ stays framework-free.
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

export interface DashboardRow {
  t: number;
  call: OHLCBar;
  put: OHLCBar;
  futureLtp: number;
  spotLtp: number;
  premiumDiscount: number;
  callPP: number;
  putPP: number;
  callPPClassic: number;
  putPPClassic: number;
  callMMA: number;
  callTLA: number;
  putMMA: number;
  putTLA: number;
  oiMatrix: OiSnapshot | null;
  smc: string;
  fib: string;
  rsi: number | null;
  rating: RatingResult;
}

// ── Pivot calculations ────────────────────────────────────────────────────────

export function clientPivot4Bar(bar: OHLCBar): PivotLevels {
  const pp = (bar.o + bar.h + bar.l + bar.c) / 4;
  return {
    pp,
    r1: 2 * pp - bar.l,
    r2: pp + (bar.h - bar.l),
    r3: bar.h + 2 * (pp - bar.l),
    s1: 2 * pp - bar.h,
    s2: pp - (bar.h - bar.l),
    s3: bar.l - 2 * (bar.h - pp),
  };
}

export function classicPivot(bar: OHLCBar): PivotLevels {
  const pp = (bar.h + bar.l + bar.c) / 3;
  return {
    pp,
    r1: 2 * pp - bar.l,
    r2: pp + (bar.h - bar.l),
    r3: bar.h + 2 * (pp - bar.l),
    s1: 2 * pp - bar.h,
    s2: pp - (bar.h - bar.l),
    s3: bar.l - 2 * (bar.h - pp),
  };
}

// ── MMA / TLA ─────────────────────────────────────────────────────────────────

export const mma = (pp: number, high: number): number => 2 * pp - high;
export const tla = (pp: number, low: number): number  => 2 * pp - low;

// ── RSI (Wilder) ─────────────────────────────────────────────────────────────

export function computeRsiSeries(closes: number[], period = 14): (number | null)[] {
  const result: (number | null)[] = [];
  if (closes.length === 0) return result;

  // Fill nulls for the first `period` entries (need period+1 closes for first RSI)
  for (let i = 0; i < Math.min(period, closes.length); i++) result.push(null);
  if (closes.length <= period) return result;

  // Seed with SMA of first `period` changes
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
  return FIB_RATIOS.map(r => ({
    label: `${(r * 100).toFixed(1)}%`,
    value: high - diff * r,
  }));
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

// ── Rating engine ─────────────────────────────────────────────────────────────

export function aggregateRating(votes: number[]): RatingResult {
  const v = votes.length ? votes.reduce((a, b) => a + b, 0) / votes.length : 0;
  const label: RatingResult["label"] =
    v < -0.5 ? "Strong Sell" :
    v < -0.1 ? "Sell" :
    v <=  0.1 ? "Hold" :
    v <=  0.5 ? "Buy"  : "Strong Buy";
  return { value: v, label };
}
