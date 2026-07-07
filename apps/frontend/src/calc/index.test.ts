// Formula validation for the Module 1 calculation engine.
// Every expected value is derived by an independent inline implementation of
// the agreed business formula, so these tests catch drift in either direction.

import { describe, it, expect } from "vitest";
import {
  computeRanking,
  computeRsiSeries,
  computeEMASeries,
  computeVWAPSeries,
  mmaBar,
  tlaFromMMA,
  MMA_CLOSE_SIGN,
  type OHLCBar,
} from "./index";

const bar = (t: number, o: number, h: number, l: number, c: number): OHLCBar => ({ t, o, h, l, c });

// ── Ranking ───────────────────────────────────────────────────────────────────

describe("computeRanking", () => {
  it("CE + PE: winner is the larger MMA, tie goes to call", () => {
    expect(computeRanking(120, 80)).toEqual({ value: 120, winner: "call" });
    expect(computeRanking(80, 120)).toEqual({ value: 120, winner: "put" });
    expect(computeRanking(100, 100)).toEqual({ value: 100, winner: "call" });
  });

  it("CE only (Put MMA = NaN): returns the Call MMA, never NaN", () => {
    const r = computeRanking(115.25, NaN);
    expect(r).toEqual({ value: 115.25, winner: "call" });
    expect(Number.isFinite(r.value)).toBe(true);
  });

  it("PE only (Call MMA = NaN): returns the Put MMA, never NaN", () => {
    const r = computeRanking(NaN, 98.5);
    expect(r).toEqual({ value: 98.5, winner: "put" });
    expect(Number.isFinite(r.value)).toBe(true);
  });

  it("missing CE and PE: still returns a finite value", () => {
    const r = computeRanking(NaN, NaN);
    expect(Number.isFinite(r.value)).toBe(true);
  });

  it("never returns Infinity even for Infinity inputs", () => {
    expect(Number.isFinite(computeRanking(Infinity, 50).value)).toBe(true);
    expect(Number.isFinite(computeRanking(50, -Infinity).value)).toBe(true);
  });
});

// ── RSI (agreed business formula: 14-period seed, Wilder continuation) ────────

describe("computeRsiSeries", () => {
  const closes = [
    100, 101.5, 100.8, 102.2, 103.0, 102.4, 104.1, 105.0, 104.2, 106.3,
    107.1, 106.5, 108.0, 109.2, 108.4, 110.0, 109.1, 111.3, 112.0, 110.8,
  ];

  it("first RSI value matches AvgGain = ΣGains/14, RS = AvgGain/AvgLoss, RSI = 100 − 100/(1+RS)", () => {
    const period = 14;
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
      const ch = closes[i] - closes[i - 1];
      if (ch > 0) gains += ch; else losses += -ch;
    }
    const rs = (gains / period) / (losses / period);
    const expected = 100 - 100 / (1 + rs);

    const series = computeRsiSeries(closes);
    // First `period` slots are unseeded
    for (let i = 0; i < period; i++) expect(series[i]).toBeNull();
    expect(series[period]).toBeCloseTo(expected, 10);
  });

  it("continuation values follow Wilder smoothing", () => {
    const period = 14;
    let avgGain = 0, avgLoss = 0;
    for (let i = 1; i <= period; i++) {
      const ch = closes[i] - closes[i - 1];
      avgGain += Math.max(ch, 0);
      avgLoss += Math.max(-ch, 0);
    }
    avgGain /= period;
    avgLoss /= period;

    const series = computeRsiSeries(closes);
    for (let i = period + 1; i < closes.length; i++) {
      const ch = closes[i] - closes[i - 1];
      avgGain = (avgGain * (period - 1) + Math.max(ch, 0)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.max(-ch, 0)) / period;
      const expected = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
      expect(series[i]).toBeCloseTo(expected, 10);
    }
  });

  it("all-gains series pins RSI to 100 (AvgLoss = 0 guard)", () => {
    const up = Array.from({ length: 20 }, (_, i) => 100 + i);
    const series = computeRsiSeries(up);
    expect(series[series.length - 1]).toBe(100);
  });
});

// ── EMA: EMA = C×k + prevEMA×(1−k), k = 2/(N+1), SMA-seeded ───────────────────

describe("computeEMASeries", () => {
  const closes = Array.from({ length: 250 }, (_, i) => 100 + Math.sin(i / 7) * 5 + i * 0.1);

  for (const period of [9, 20, 50, 200]) {
    it(`EMA ${period} matches manual SMA seed + recursive formula`, () => {
      const k = 2 / (period + 1);
      const series = computeEMASeries(closes, period);

      for (let i = 0; i < period - 1; i++) expect(series[i]).toBeNull();

      let expected = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
      expect(series[period - 1]).toBeCloseTo(expected, 10);

      for (let i = period; i < closes.length; i++) {
        expected = closes[i] * k + expected * (1 - k);
        expect(series[i]).toBeCloseTo(expected, 10);
      }
    });
  }

  it("live continuation from the historical seed equals recomputing the full series", () => {
    // Mirrors dashboard Effect 2: prevEmaRef seeded from history, then one
    // more close arrives and is folded in with the same k.
    const period = 20;
    const k = 2 / (period + 1);
    const history = closes.slice(0, 100);
    const nextClose = closes[100];

    const histSeries = computeEMASeries(history, period);
    const seed = histSeries[histSeries.length - 1]!;
    const continued = nextClose * k + seed * (1 - k);

    const fullSeries = computeEMASeries(closes.slice(0, 101), period);
    expect(continued).toBeCloseTo(fullSeries[fullSeries.length - 1]!, 10);
  });
});

// ── VWAP: session-cumulative average of TP = (H+L+C)/3 ────────────────────────
// (Volume weighting is intentionally omitted: the VWAP source is the NIFTY spot
// index, which has no traded volume; Σ(TP×V)/ΣV degenerates to ΣTP/n.)

describe("computeVWAPSeries", () => {
  const bars = [
    bar(0, 100, 102, 99, 101),
    bar(1, 101, 104, 100, 103),
    bar(2, 103, 103.5, 101, 102),
    bar(3, 102, 105, 102, 104.5),
  ];

  it("each value equals cumulative Σ((H+L+C)/3) / barCount", () => {
    const series = computeVWAPSeries(bars);
    let cum = 0;
    bars.forEach((b, i) => {
      cum += (b.h + b.l + b.c) / 3;
      expect(series[i]).toBeCloseTo(cum / (i + 1), 10);
    });
  });

  it("live continuation state (cumTP, count) matches the series", () => {
    // Mirrors dashboard Effect 2 vwapStateRef: history accumulates cumTP/count,
    // then the live bar's TP is folded in.
    const history = bars.slice(0, 3);
    let cumTP = 0;
    history.forEach(b => { cumTP += (b.h + b.l + b.c) / 3; });
    const liveBar = bars[3];
    const liveTp = (liveBar.h + liveBar.l + liveBar.c) / 3;
    const liveVwap = (cumTP + liveTp) / (history.length + 1);

    const fullSeries = computeVWAPSeries(bars);
    expect(liveVwap).toBeCloseTo(fullSeries[fullSeries.length - 1]!, 10);
  });
});

// ── MMA / TLA (current client spec: MMA_CLOSE_SIGN = −1) ──────────────────────

describe("mmaBar / tlaFromMMA", () => {
  it("MMA = (O + H + L + sign×C) / 4 and TLA = 2×MMA − H", () => {
    const b = bar(0, 100, 110, 95, 105);
    const expectedMMA = (100 + 110 + 95 + MMA_CLOSE_SIGN * 105) / 4;
    expect(mmaBar(b)).toBeCloseTo(expectedMMA, 10);
    expect(tlaFromMMA(expectedMMA, b.h)).toBeCloseTo(2 * expectedMMA - 110, 10);
  });
});
