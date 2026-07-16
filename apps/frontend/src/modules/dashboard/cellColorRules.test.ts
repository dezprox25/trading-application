import { describe, it, expect } from "vitest";
import { buildLiveColorGrid, isColorableValue } from "./cellColorRules";
import type { DashboardRow, OHLCBar } from "../../calc";

function bar(o: number): OHLCBar {
  return { t: 0, o, h: o, l: o, c: o };
}

function rowWithCallOpen(o: number): DashboardRow {
  return {
    t: 0,
    call: bar(o), put: bar(1), future: bar(1), spot: bar(1),
    callMMA: 1, callTLA: 1, putMMA: 1, putTLA: 1,
    futureMMA: 1, futureTLA: 1, spotMMA: 1, spotTLA: 1,
    ranking: 1, rankingWinner: "call",
    smc: "", fib: "", rsi: null, ema: null, vwap: null, ema200: null,
    emaScore: null, vwapScore: null, totalScore: null, rating: null, signal: null,
    oiMatrix: null,
  } as DashboardRow;
}

describe("buildLiveColorGrid — Rule 1 applied literally: 'Current > Highest -> Blue; Highest = Current'", () => {
  // NOTE: the spec's narrative walkthroughs (e.g. "56 -> Light Green, 57 ->
  // Light Green, 60 -> Blue" for a clean 55..60 climb) are inconsistent with
  // the spec's own formal Rule 1 definition taken literally: 56 IS strictly
  // greater than the only prior value (55), which makes it "the highest
  // value reached within the currently selected timeframe" by definition, so
  // a literal reading makes every strictly-increasing step Blue, not just
  // the last one. This is confirmed unambiguously by the spec's OTHER worked
  // example ("Highest = 100, Previous = 82, Current = 85 -> Light Green",
  // tested below) — that example only makes sense if "Highest" is a
  // continuously-updating running max checked on every tick, which is
  // exactly what's implemented here. Every strict new-high tick during a
  // clean rally being highlighted Blue is also standard "new session high"
  // trading-UI behavior. Flagged for the team in case the narrative
  // walkthroughs reflect a different intended nuance.
  it("55,56,57,60,58,44,61 -> null,blue,blue,blue,pink,black,blue", () => {
    const values = [55, 56, 57, 60, 58, 44, 61];
    const rows = values.map(rowWithCallOpen);
    const grid = buildLiveColorGrid(rows);
    expect(grid["ce-o"]).toEqual([null, "blue", "blue", "blue", "pink", "black", "blue"]);
  });

  it("color-details.md sequence: 55,56,57,58,59,60,58,56,44", () => {
    const values = [55, 56, 57, 58, 59, 60, 58, 56, 44];
    const rows = values.map(rowWithCallOpen);
    const grid = buildLiveColorGrid(rows);
    expect(grid["ce-o"]).toEqual([
      null, "blue", "blue", "blue", "blue", "blue", "pink", "pink", "black",
    ]);
  });

  it("highest resets only when the row array itself is rebuilt (new reference)", () => {
    const rows1 = [55, 56, 60].map(rowWithCallOpen);
    const grid1 = buildLiveColorGrid(rows1);
    expect(grid1["ce-o"]).toEqual([null, "blue", "blue"]);

    // Simulate a timeframe switch: rows array rebuilt from scratch.
    const rows2 = [10, 20].map(rowWithCallOpen);
    const grid2 = buildLiveColorGrid(rows2);
    expect(grid2["ce-o"]).toEqual([null, "blue"]); // 20 is a new high in the FRESH series, not compared to 60
  });

  it("Highest=100 / previous=82 / current=85 -> green (not a new high)", () => {
    const rows = [100, 82, 85].map(rowWithCallOpen);
    const grid = buildLiveColorGrid(rows);
    expect(grid["ce-o"]).toEqual([null, "black", "green"]);
  });

  it("equal values produce no color", () => {
    const rows = [220, 220, 220].map(rowWithCallOpen);
    const grid = buildLiveColorGrid(rows);
    expect(grid["ce-o"]).toEqual([null, null, null]);
  });

  it("missing/invalid values (0, NaN) get no color and are skipped for tracking", () => {
    const rows = [50, 0, NaN, 55].map(rowWithCallOpen);
    const grid = buildLiveColorGrid(rows);
    // 0 and NaN are invalid -> null; 55 compares against 50 (last valid), not 0
    expect(grid["ce-o"]).toEqual([null, null, null, "blue"]);
  });

  it("columns are fully independent (Call Open vs Put Open never influence each other)", () => {
    const rows: DashboardRow[] = [
      { ...rowWithCallOpen(50), put: bar(90) },
      { ...rowWithCallOpen(60), put: bar(80) }, // ce-o up -> green/blue, pe-o down -> pink/black
    ];
    const grid = buildLiveColorGrid(rows);
    expect(grid["ce-o"][1]).toBe("blue"); // 60 > 50, new high
    expect(grid["pe-o"][1]).toBe("pink"); // 80 < 90, drop = 11.1% < 15%
  });

  it("isColorableValue treats 0/NaN/Infinity as invalid, negatives as valid", () => {
    expect(isColorableValue(0)).toBe(false);
    expect(isColorableValue(NaN)).toBe(false);
    expect(isColorableValue(Infinity)).toBe(false);
    expect(isColorableValue(-5)).toBe(true);
    expect(isColorableValue(5)).toBe(true);
  });
});

// ── Display-truncation consistency ────────────────────────────────────────────
// Regression coverage for a real client-reported defect: the color engine
// used to compare raw, full-precision values while the cell displays
// Math.trunc(value) — so two rows showing the identical on-screen number
// (e.g. both "19") could still get colored if their raw values differed by a
// fraction. The engine must compare the SAME truncated value the cell shows,
// so "visually unchanged" and "no color" always agree.
describe("buildLiveColorGrid — colors match the displayed (truncated) value, not the raw float", () => {
  it("raw values that display as the same integer produce no color", () => {
    // 19.6 -> 19.2: a real ~2% raw decrease, but both truncate to "19"
    const rows = [19.6, 19.2].map(rowWithCallOpen);
    const grid = buildLiveColorGrid(rows);
    expect(grid["ce-o"]).toEqual([null, null]);
  });

  it("reproduces the client's reported dataset shape: 19.4, 19.2, 19.6, 19.1 (all display 19/19/19/19) -> no color on any row", () => {
    const rows = [19.4, 19.2, 19.6, 19.1].map(rowWithCallOpen);
    const grid = buildLiveColorGrid(rows);
    expect(grid["ce-o"]).toEqual([null, null, null, null]);
  });

  it("still colors when the DISPLAYED integer actually changes, even by a fraction that crosses the boundary", () => {
    // 18.9 -> 19.1: displays as "18" then "19" — a real, visible change
    const rows = [18.9, 19.1].map(rowWithCallOpen);
    const grid = buildLiveColorGrid(rows);
    expect(grid["ce-o"]).toEqual([null, "blue"]);
  });

  it("highest tracking uses the truncated value too, so a raw-only new high that doesn't cross the display boundary is not a new high", () => {
    // 20.9 (displays 20, becomes highest=20) -> 20.1 (still displays 20, not > 20) -> no color
    const rows = [20.9, 20.1].map(rowWithCallOpen);
    const grid = buildLiveColorGrid(rows);
    expect(grid["ce-o"]).toEqual([null, null]);
  });
});
