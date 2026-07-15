import type { DashboardRow } from "../../calc";

// ── Live cell color coding ──────────────────────────────────────────────────
// Column-independent Blue/Green/Pink/Black highlighting for every Call/Put/
// Future/Spot Open/High/Low/Close/MMA/TLA column. Each column tracks its own
// "previous value" and "highest value reached this timeframe" completely
// independently of every other column (see TRACKED_COLUMN_ACCESSORS below).
//
// Rules (evaluated per cell, against that SAME column's own running state):
//   current > all-time-high-so-far   → "blue"  (new high), highest updates
//   current > previous, not new high → "green"
//   current < previous, drop < 15%   → "pink"
//   current < previous, drop >= 15%  → "black"
//   current === previous             → null (no color change)
//   first valid value in the column  → null (nothing to compare against yet)
//
// Missing/invalid values (null, undefined, 0, NaN, Infinity) never get a
// color and are skipped entirely for previous/highest tracking.
//
// Highest-value tracking is per column and resets automatically whenever the
// row set is rebuilt (e.g. on a timeframe change, which clears/refetches
// `rows` from scratch — see Dashboard Effect 1) since the whole grid below is
// always recomputed from row 0 of the CURRENT `rows` array.

export type ColorClass = "blue" | "green" | "pink" | "black" | null;

export interface CellColorStyle {
  bg: string;
  textColor: string;
}

const DEFAULT_STYLE: CellColorStyle = { bg: "#FFFFFF", textColor: "#000000" };

export const COLOR_CLASS_STYLE: Record<Exclude<ColorClass, null>, CellColorStyle> = {
  blue:  { bg: "#2563EB", textColor: "#FFFFFF" }, // new highest
  green: { bg: "#BBF7D0", textColor: "#065F46" }, // up, not a new highest
  pink:  { bg: "#FBD5D5", textColor: "#7F1D1D" }, // down, drop < 15%
  black: { bg: "#111827", textColor: "#FFFFFF" }, // down, drop >= 15%
};

export function colorClassStyle(cls: ColorClass): CellColorStyle {
  return cls ? COLOR_CLASS_STYLE[cls] : DEFAULT_STYLE;
}

// Every applicable column (Call/Put/Future/Spot × Open/High/Low/Close/MMA/
// TLA), mapped to how to read its value off a DashboardRow. Ranking, SMC,
// FIB, RSI, EMA and VWAP are intentionally absent — they must stay uncolored.
// To extend to a future column, add one entry here; nothing else changes.
export const TRACKED_COLUMN_ACCESSORS: Record<string, (row: DashboardRow) => number> = {
  "ce-o": (r) => r.call.o,   "ce-h": (r) => r.call.h,   "ce-l": (r) => r.call.l,   "ce-c": (r) => r.call.c,
  "mma-c": (r) => r.callMMA, "tla-c": (r) => r.callTLA,

  "pe-o": (r) => r.put.o,    "pe-h": (r) => r.put.h,    "pe-l": (r) => r.put.l,    "pe-c": (r) => r.put.c,
  "mma-p": (r) => r.putMMA,  "tla-p": (r) => r.putTLA,

  "fut-o": (r) => r.future.o, "fut-h": (r) => r.future.h, "fut-l": (r) => r.future.l, "fut-c": (r) => r.future.c,
  "fut-mma": (r) => r.futureMMA, "fut-tla": (r) => r.futureTLA,

  "spot-o": (r) => r.spot.o, "spot-h": (r) => r.spot.h, "spot-l": (r) => r.spot.l, "spot-c": (r) => r.spot.c,
  "spot-mma": (r) => r.spotMMA, "spot-tla": (r) => r.spotTLA,
};

export function isColorableValue(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v) && v !== 0;
}

function nextColorStep(
  current: number,
  prevValue: number | null,
  highestBefore: number | null
): { colorClass: ColorClass; nextHighest: number } {
  const nextHighest = highestBefore === null ? current : Math.max(highestBefore, current);

  if (prevValue === null || current === prevValue) {
    return { colorClass: null, nextHighest };
  }
  if (current > prevValue) {
    const isNewHigh = highestBefore === null || current > highestBefore;
    return { colorClass: isNewHigh ? "blue" : "green", nextHighest };
  }
  // current < prevValue
  const dropPct = ((prevValue - current) / prevValue) * 100;
  return { colorClass: dropPct >= 15 ? "black" : "pink", nextHighest };
}

// One left-to-right pass per tracked column (O(rows × columns), no
// quadratic rescans) — each column keeps its own prev/highest state as it
// walks the row list, exactly mirroring the independent-per-column contract
// above. Call with the live `rows` array; memoize on that array's reference
// (it's a fresh array on every append/update — see useDashStore) so this
// only reruns when the data actually changes, not on every render.
export function buildLiveColorGrid(rows: DashboardRow[]): Record<string, ColorClass[]> {
  const grid: Record<string, ColorClass[]> = {};

  for (const colId of Object.keys(TRACKED_COLUMN_ACCESSORS)) {
    const accessor = TRACKED_COLUMN_ACCESSORS[colId];
    const colColors: ColorClass[] = new Array(rows.length).fill(null);
    let prevValue: number | null = null;
    let highest: number | null = null;

    for (let i = 0; i < rows.length; i++) {
      const raw = accessor(rows[i]);
      if (!isColorableValue(raw)) continue; // missing/invalid — no color, don't touch tracking

      const step = nextColorStep(raw, prevValue, highest);
      colColors[i] = step.colorClass;
      prevValue = raw;
      highest = step.nextHighest;
    }

    grid[colId] = colColors;
  }

  return grid;
}
