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
//
// Blue and Black are additionally "singleton" per column: only the MOST
// RECENT new-high (blue) and the MOST RECENT >=15% drop (black) stay
// highlighted. When a later row earns a fresh blue/black, the previous row
// that held that color is repainted to null (see lastBlueIndex/lastBlackIndex
// in buildLiveColorGrid below). Green/pink are unaffected and can appear on
// any number of rows simultaneously.

// Single source of truth for "the number the trader actually sees" — the
// Worksheet's p0()/fmtVwap() truncate to a whole number for display
// (Math.trunc), and the color engine below compares THIS SAME rounded value,
// not the raw sub-decimal float. Two consecutive rows whose raw values only
// differ by a fraction (e.g. 19.6 -> 19.2) both display as "19" — coloring
// off the raw values would flag that pair as a real decrease even though
// nothing visibly changed on screen, which is exactly the "equal values
// getting colored" defect this fixes. Exported so Worksheet.tsx's p0/fmtVwap
// use the identical function and the two can never drift apart again.
export const truncateForDisplay = (n: number): number => Math.trunc(n);

export type ColorClass = "blue" | "green" | "pink" | "black" | null;

export interface CellColorStyle {
  bg: string;
  textColor: string;
}

const DEFAULT_STYLE: CellColorStyle = { bg: "#FFFFFF", textColor: "#000000" };

// ── Color themes ──────────────────────────────────────────────────────────────
// Same ColorClass, same calculation (nextColorStep below) — only the visual
// palette differs by column group:
//   "light" — the base subtle-background palette (still colorClassStyle's
//             default, and the source LIGHT_THEME_STYLE the "hlc" theme
//             below pulls its green/pink from)
//   "hlc"   — Call/Put/Future/Spot Open/High/Low/Close: green/pink stay the
//             same light backgrounds as "light", but blue/black switch to
//             the stronger "dark" palette so a new-highest or a decrease
//             reads more emphatically on these columns
//   "dark"  — Call/Put/Future/Spot MMA/TLA + the Indicators section
//             (stronger backgrounds, white text, throughout)
// "black" (drop >= 15%) is intentionally identical across "hlc" and "dark" —
// a large drop reads the same regardless of column group.
export type ColorTheme = "light" | "hlc" | "dark";

const LIGHT_THEME_STYLE: Record<Exclude<ColorClass, null>, CellColorStyle> = {
  blue:  { bg: "#BFDBFE", textColor: "#1E3A8A" }, // light blue — new highest
  green: { bg: "#BBF7D0", textColor: "#065F46" }, // light green — up, not a new highest
  pink:  { bg: "#FBD5D5", textColor: "#7F1D1D" }, // light pink — down, drop < 15%
  black: { bg: "#111827", textColor: "#FFFFFF" }, // down, drop >= 15%
};

const DARK_THEME_STYLE: Record<Exclude<ColorClass, null>, CellColorStyle> = {
  blue:  { bg: "#1E3A8A", textColor: "#FFFFFF" }, // dark blue — new highest
  green: { bg: "#065F46", textColor: "#FFFFFF" }, // dark green — up, not a new highest
  pink:  { bg: "#7F1D1D", textColor: "#FFFFFF" }, // dark red — down, drop < 15%
  black: { bg: "#111827", textColor: "#FFFFFF" }, // down, drop >= 15%
};

// Open/High/Low/Close: light green/pink (same as LIGHT_THEME_STYLE) but dark
// blue/black (same as DARK_THEME_STYLE) — only blue/black get the darker
// treatment per the client's revision.
const HLC_THEME_STYLE: Record<Exclude<ColorClass, null>, CellColorStyle> = {
  blue:  DARK_THEME_STYLE.blue,
  green: LIGHT_THEME_STYLE.green,
  pink:  LIGHT_THEME_STYLE.pink,
  black: DARK_THEME_STYLE.black,
};

const COLOR_THEME_STYLE: Record<ColorTheme, Record<Exclude<ColorClass, null>, CellColorStyle>> = {
  light: LIGHT_THEME_STYLE,
  hlc:   HLC_THEME_STYLE,
  dark:  DARK_THEME_STYLE,
};

export function colorClassStyle(cls: ColorClass, theme: ColorTheme = "light"): CellColorStyle {
  return cls ? COLOR_THEME_STYLE[theme][cls] : DEFAULT_STYLE;
}

// SMC/FIB render as "<LABEL> <formatted price>" (see calc/index.ts
// smcNearest / nearestFibLabel — e.g. "SWH 23,456.00" or "23.6% 23,456.00").
// The color engine needs a plain number to track against; this pulls the
// trailing formatted price back out of the label. Mirrors every other
// tracked column, where the color reads the raw underlying number and the
// rendered text is a separate, independent concern (e.g. MMA/TLA are
// truncated for display via p0() but colored from the untruncated value).
function parseTrailingNumber(label: string): number | null {
  const match = label.match(/(-?[\d,]+\.\d+)\s*$/);
  if (!match) return null;
  const n = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

interface TrackedColumnDef {
  accessor: (row: DashboardRow) => number | null | undefined;
  theme: ColorTheme;
  // Whether to compare the truncateForDisplay()'d value instead of the raw
  // one — true for every column whose cell text is p0()/fmtVwap() (both
  // Math.trunc), so "looks unchanged" and "no color" always agree. false for
  // smc/fib (parseTrailingNumber already reads the *already-rounded* 2-decimal
  // label text — truncating again would throw away real display precision)
  // and ema (the cell shows a CALL/PUT/NEUTRAL label, not a number at all, so
  // there's no displayed digit for the color to stay consistent with).
  truncateForColor: boolean;
}

// Every applicable column, mapped to how to read its value off a
// DashboardRow and which palette it uses. Ranking is handled separately in
// Worksheet.tsx (its comparison is against the previous row only, not a
// running highest — see rankingDir). To extend to a future column, add one
// entry here; nothing else changes.
const TRACKED_COLUMNS: Record<string, TrackedColumnDef> = {
  // Group A — Call/Put/Future/Spot Open/High/Low/Close (light green/pink, dark blue/black)
  "ce-o": { accessor: (r) => r.call.o, theme: "hlc", truncateForColor: true },
  "ce-h": { accessor: (r) => r.call.h, theme: "hlc", truncateForColor: true },
  "ce-l": { accessor: (r) => r.call.l, theme: "hlc", truncateForColor: true },
  "ce-c": { accessor: (r) => r.call.c, theme: "hlc", truncateForColor: true },
  "pe-o": { accessor: (r) => r.put.o, theme: "hlc", truncateForColor: true },
  "pe-h": { accessor: (r) => r.put.h, theme: "hlc", truncateForColor: true },
  "pe-l": { accessor: (r) => r.put.l, theme: "hlc", truncateForColor: true },
  "pe-c": { accessor: (r) => r.put.c, theme: "hlc", truncateForColor: true },
  "fut-o": { accessor: (r) => r.future.o, theme: "hlc", truncateForColor: true },
  "fut-h": { accessor: (r) => r.future.h, theme: "hlc", truncateForColor: true },
  "fut-l": { accessor: (r) => r.future.l, theme: "hlc", truncateForColor: true },
  "fut-c": { accessor: (r) => r.future.c, theme: "hlc", truncateForColor: true },
  "spot-o": { accessor: (r) => r.spot.o, theme: "hlc", truncateForColor: true },
  "spot-h": { accessor: (r) => r.spot.h, theme: "hlc", truncateForColor: true },
  "spot-l": { accessor: (r) => r.spot.l, theme: "hlc", truncateForColor: true },
  "spot-c": { accessor: (r) => r.spot.c, theme: "hlc", truncateForColor: true },

  // Group B — Call/Put/Future/Spot MMA/TLA (dark theme)
  "mma-c": { accessor: (r) => r.callMMA, theme: "dark", truncateForColor: true },
  "tla-c": { accessor: (r) => r.callTLA, theme: "dark", truncateForColor: true },
  "mma-p": { accessor: (r) => r.putMMA, theme: "dark", truncateForColor: true },
  "tla-p": { accessor: (r) => r.putTLA, theme: "dark", truncateForColor: true },
  "fut-mma": { accessor: (r) => r.futureMMA, theme: "dark", truncateForColor: true },
  "fut-tla": { accessor: (r) => r.futureTLA, theme: "dark", truncateForColor: true },
  "spot-mma": { accessor: (r) => r.spotMMA, theme: "dark", truncateForColor: true },
  "spot-tla": { accessor: (r) => r.spotTLA, theme: "dark", truncateForColor: true },

  // Group C — Indicators (dark theme)
  "smc": { accessor: (r) => parseTrailingNumber(r.smc), theme: "dark", truncateForColor: false },
  "fib": { accessor: (r) => parseTrailingNumber(r.fib), theme: "dark", truncateForColor: false },
  "rsi": { accessor: (r) => r.rsi, theme: "dark", truncateForColor: true },
  "ema": { accessor: (r) => r.ema, theme: "dark", truncateForColor: false }, // raw EMA-20 value — the column itself renders a CALL/PUT/NEUTRAL label, but color tracks the underlying number, same pattern as every other column
  "vwap": { accessor: (r) => r.vwap, theme: "dark", truncateForColor: true },
};

export const TRACKED_COLUMN_ACCESSORS: Record<string, (row: DashboardRow) => number | null | undefined> =
  Object.fromEntries(Object.entries(TRACKED_COLUMNS).map(([id, def]) => [id, def.accessor]));

export const TRACKED_COLUMN_THEME: Record<string, ColorTheme> =
  Object.fromEntries(Object.entries(TRACKED_COLUMNS).map(([id, def]) => [id, def.theme]));

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

  for (const [colId, def] of Object.entries(TRACKED_COLUMNS)) {
    const colColors: ColorClass[] = new Array(rows.length).fill(null);
    let prevValue: number | null = null;
    let highest: number | null = null;
    // Index of the row currently holding this column's blue/black — at most
    // one of each may be lit at a time. When a later row earns a fresh
    // blue/black, the row at the recorded index is repainted to null first.
    let lastBlueIndex: number | null = null;
    let lastBlackIndex: number | null = null;

    for (let i = 0; i < rows.length; i++) {
      let raw = def.accessor(rows[i]);
      // Compare the same value the cell displays — see truncateForColor's
      // doc comment above. Applied before the invalid-value check so a raw
      // value like 0.4 that displays as "0" is correctly excluded the same
      // way a genuine 0 already is (unchanged rule: 0 -> no color).
      if (def.truncateForColor && typeof raw === "number" && Number.isFinite(raw)) {
        raw = truncateForDisplay(raw);
      }
      if (!isColorableValue(raw)) continue; // missing/invalid — no color, don't touch tracking

      const step = nextColorStep(raw, prevValue, highest);

      if (step.colorClass === "blue") {
        if (lastBlueIndex !== null) colColors[lastBlueIndex] = null;
        lastBlueIndex = i;
      } else if (step.colorClass === "black") {
        if (lastBlackIndex !== null) colColors[lastBlackIndex] = null;
        lastBlackIndex = i;
      }

      colColors[i] = step.colorClass;
      prevValue = raw;
      highest = step.nextHighest;
    }

    grid[colId] = colColors;
  }

  return grid;
}
