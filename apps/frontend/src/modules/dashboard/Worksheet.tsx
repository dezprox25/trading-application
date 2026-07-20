import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { DashboardRow, PivotMethod } from "../../calc";
import { pivotForBar } from "../../calc";
import { TRACKED_COLUMN_ACCESSORS, TRACKED_COLUMN_THEME, buildLiveColorGrid, colorClassStyle, truncateForDisplay } from "./cellColorRules";

// ── Types ─────────────────────────────────────────────────────────────────────

export type Group = "datetime" | "call" | "put" | "ranking" | "future" | "space" | "spot" | "indicators";
type Align = "left" | "right" | "center";

export interface ColSpec {
  id: string;
  sub: string;
  group: Group;
  defaultW: number;
  frozen?: boolean;
  align?: Align;
}

interface SelRange { r1: number; c1: number; r2: number; c2: number; }

interface WorksheetProps {
  rows: DashboardRow[];
  hiddenCols: string[];
  colOrder: string[];
  feedStatus: "idle" | "live" | "interrupted";
  isLoading: boolean;
  type: "Call" | "Put" | "Call+Put";
  pivotMethod: PivotMethod;
}

export const TYPE_HIDDEN: Record<string, string[]> = {
  "Call":     ["pe-o", "pe-h", "pe-l", "pe-c", "mma-p", "tla-p", "p-sign"],
  "Put":      ["ce-o", "ce-h", "ce-l", "ce-c", "mma-c", "tla-c", "c-sign"],
  "Call+Put": [],
};

// Pivot Point columns (PP/R1-R3/S1-S3) are fully calculated (row data, Excel
// export param, pivotMethod toggle all stay wired — see getCellValue below)
// but intentionally not shown in the worksheet UI. Unlike TYPE_HIDDEN/hiddenCols
// this list is not user-togglable — it's a permanent UI-visibility switch, kept
// separate so the column defs in ALL_COLS and the calculation pipeline are
// untouched and easy to re-expose later (Signals/strategies/reports/API).
const PIVOT_UI_HIDDEN = ["pp", "r1", "r2", "r3", "s1", "s2", "s3"];

// Client spec: the Indicators section shows exactly SMC / FIB / RSI / EMA /
// VWAP. EMA200, EMA Score, VWAP Score, Total MMA Score, Rating and Signal are
// internal-only — fully calculated (kept available for future use) and
// exported nowhere, never shown as columns. The "EMA" column itself displays
// the EMA20-vs-EMA200 comparison label (CALL/PUT/NEUTRAL), not a raw number —
// see fmtEmaSignal below — so ema-score is effectively surfaced through "ema",
// just not as its own numeric column. Same permanent-hide mechanism as
// PIVOT_UI_HIDDEN above.
const INDICATOR_UI_HIDDEN = ["ema200", "ema-score", "vwap-score", "total-score", "rating", "signal"];

// ── Frozen-column detector (dev-only debugging utility) ───────────────────────
// Columns that legitimately repeat the same value across many rows by design —
// never a sign of a stuck calculation:
//   datetime — the frozen (pinned) leftmost column, not a data value at all
//   space    — reserved placeholder column with no data/logic (always "")
//   smc/fib  — "nearest level" labels; the nearest SWH/SWL/PDH/PDL or Fib
//              level legitimately stays the same across many bars
//   vwap     — null ("VWAP Not Available") until cumulative Future volume > 0
//   ema      — a 3-way categorical label (CALL/PUT/NEUTRAL), not a continuous
//              price; long runs of the same label are expected
const FROZEN_DETECTOR_EXCLUDED_COLS = new Set(["datetime", "space", "smc", "fib", "vwap", "ema"]);

// Floating-point tolerance for the frozen-column detector's raw-value
// comparison — two values are only "the same" when they're mathematically
// equal within this margin, not merely equal after display rounding.
const FROZEN_DETECTOR_EPSILON = 0.0001;

const rawValuesEqual = (a: number | string, b: number | string): boolean =>
  typeof a === "number" && typeof b === "number"
    ? Math.abs(a - b) < FROZEN_DETECTOR_EPSILON
    : a === b;

// Missing-data sentinels (NaN, null, "—", "") never count as "the same value" —
// a column of all-missing cells isn't a frozen calculation, it's absent data.
const isValidRawValue = (v: number | string | null): v is number | string => {
  if (v == null) return false;
  if (typeof v === "number") return Number.isFinite(v);
  return v !== "" && v !== "—";
};

// ── Column definitions (v2 — 31-column client spec) ───────────────────────────

export const ALL_COLS: ColSpec[] = [
  // Time (1 frozen column — "HH:MM", date display removed per final client spec)
  { id: "datetime",  sub: "Time",        group: "datetime",   defaultW: 80, frozen: true, align: "center" },
  // Call (CE) — 7 columns (column ids keep the legacy mma/tla slugs so saved
  // column-order/hidden-column prefs keep working; only the labels changed)
  { id: "ce-o",      sub: "Open",        group: "call",       defaultW: 88 },
  { id: "ce-h",      sub: "High",        group: "call",       defaultW: 88 },
  { id: "ce-l",      sub: "Low",         group: "call",       defaultW: 88 },
  { id: "ce-c",      sub: "Close",       group: "call",       defaultW: 88 },
  { id: "mma-c",     sub: "MA",          group: "call",       defaultW: 96 },
  { id: "tla-c",     sub: "TMA",         group: "call",       defaultW: 96 },
  { id: "c-sign",    sub: "C Sign",      group: "call",       defaultW: 88 },
  // Put (PE) — 7 columns
  { id: "pe-o",      sub: "Open",        group: "put",        defaultW: 88 },
  { id: "pe-h",      sub: "High",        group: "put",        defaultW: 88 },
  { id: "pe-l",      sub: "Low",         group: "put",        defaultW: 88 },
  { id: "pe-c",      sub: "Close",       group: "put",        defaultW: 88 },
  { id: "mma-p",     sub: "MA",          group: "put",        defaultW: 96 },
  { id: "tla-p",     sub: "TMA",         group: "put",        defaultW: 96 },
  { id: "p-sign",    sub: "P Sign",      group: "put",        defaultW: 88 },
  // Ranking — 1 column
  { id: "ranking",   sub: "Ranking",     group: "ranking",    defaultW: 100, align: "center" },
  // Future — 6 columns (full OHLC + MA + TMA)
  { id: "fut-o",     sub: "Open",        group: "future",     defaultW: 88 },
  { id: "fut-h",     sub: "High",        group: "future",     defaultW: 88 },
  { id: "fut-l",     sub: "Low",         group: "future",     defaultW: 88 },
  { id: "fut-c",     sub: "Close",       group: "future",     defaultW: 88 },
  { id: "fut-mma",   sub: "MA",          group: "future",     defaultW: 96 },
  { id: "fut-tla",   sub: "TMA",         group: "future",     defaultW: 96 },
  // Space — 1 column (reserved placeholder, no data/logic — see PR notes)
  { id: "space",     sub: "",            group: "space",      defaultW: 88 },
  // Spot — 6 columns (full OHLC + MA + TMA)
  { id: "spot-o",    sub: "Open",        group: "spot",       defaultW: 88 },
  { id: "spot-h",    sub: "High",        group: "spot",       defaultW: 88 },
  { id: "spot-l",    sub: "Low",         group: "spot",       defaultW: 88 },
  { id: "spot-c",    sub: "Close",       group: "spot",       defaultW: 88 },
  { id: "spot-mma",  sub: "MA",          group: "spot",       defaultW: 96 },
  { id: "spot-tla",  sub: "TMA",         group: "spot",       defaultW: 96 },
  // Indicators — 5 columns
  { id: "smc",       sub: "SMC",         group: "indicators", defaultW: 132, align: "left" },
  { id: "fib",       sub: "FIB",         group: "indicators", defaultW: 122, align: "left" },
  { id: "rsi",       sub: "RSI",         group: "indicators", defaultW: 78 },
  // "ema" renders the EMA20-vs-EMA200 comparison label (see fmtEmaSignal),
  // not a raw EMA number — the client spec has exactly one EMA column.
  { id: "ema",       sub: "EMA",         group: "indicators", defaultW: 78 },
  // ema200 / ema-score / vwap-score / total-score / rating / signal are all
  // internal-only (see INDICATOR_UI_HIDDEN) — kept as column defs so the calc
  // pipeline stays untouched and they're easy to re-expose later, but never
  // rendered or exported.
  { id: "ema200",    sub: "EMA200",      group: "indicators", defaultW: 84 },
  { id: "vwap",      sub: "VWAP",        group: "indicators", defaultW: 78 },
  { id: "ema-score",    sub: "EMA Score",   group: "indicators", defaultW: 92 },
  { id: "vwap-score",   sub: "VWAP Score",  group: "indicators", defaultW: 96 },
  { id: "total-score",  sub: "Total Score", group: "indicators", defaultW: 96 },
  { id: "rating",       sub: "Rating",      group: "indicators", defaultW: 120, align: "left" },
  { id: "signal",       sub: "Signal",      group: "indicators", defaultW: 92,  align: "left" },
  // Pivot Points — PP/R1-R3/S1-S3 (client's chosen 4-Bar or Classic formula,
  // see calc/pivotForBar), evaluated on the row's own Future candle.
  { id: "pp",        sub: "PP",          group: "indicators", defaultW: 78 },
  { id: "r1",        sub: "R1",          group: "indicators", defaultW: 78 },
  { id: "r2",        sub: "R2",          group: "indicators", defaultW: 78 },
  { id: "r3",        sub: "R3",          group: "indicators", defaultW: 78 },
  { id: "s1",        sub: "S1",          group: "indicators", defaultW: 78 },
  { id: "s2",        sub: "S2",          group: "indicators", defaultW: 78 },
  { id: "s3",        sub: "S3",          group: "indicators", defaultW: 78 },
];

// ── Group display metadata ────────────────────────────────────────────────────

export const GROUP_LABELS: Record<Group, string> = {
  datetime:   "Time",
  call:       "Call",
  put:        "Put",
  ranking:    "Ranking",
  future:     "Future",
  space:      "Space",
  spot:       "Spot",
  indicators: "Indicators",
};

const GROUP_COLORS: Record<Group, { bg: string; subBg: string; text: string }> = {
  datetime:   { bg: "#E8EDF2", subBg: "#EFF2F6", text: "#1A2533" },
  call:       { bg: "#DBEAFE", subBg: "#EFF6FF", text: "#1E40AF" },
  put:        { bg: "#FEF3C7", subBg: "#FFFBEB", text: "#92400E" },
  ranking:    { bg: "#F3E8FF", subBg: "#FAF0FF", text: "#6B21A8" },
  future:     { bg: "#D1FAE5", subBg: "#ECFDF5", text: "#065F46" },
  space:      { bg: "#E5E7EB", subBg: "#F3F4F6", text: "#4B5563" },
  spot:       { bg: "#CCFBF1", subBg: "#F0FDFA", text: "#0F766E" },
  indicators: { bg: "#EDE9FE", subBg: "#F5F3FF", text: "#4C1D95" },
};

// ── Cell coloring ──────────────────────────────────────────────────────────
// Static per-column-role coloring has been replaced by the dynamic, stateful
// rule engine in ./cellColorRules (Blue/Green/Pink/Black, Light/Dark themes —
// see buildLiveColorGrid/colorClassStyle) for every Call/Put/Future/Spot
// OHLC/MMA/TLA column plus the Indicators section (SMC/FIB/RSI/EMA/VWAP).
// getCellStyle below now only covers columns that keep static coloring
// (currently just Ranking's call/put-winner fallback); everything else
// defaults to plain white.

type CellColor = { bg: string; textColor: string };

const C_DEFAULT: CellColor = { bg: "#FFFFFF", textColor: "#000000" };

const C_RANK_CALL: CellColor = { bg: "#FFFFFF", textColor: "#1E40AF" }; // white bg, blue text — call wins
const C_RANK_PUT:  CellColor = { bg: "#FFFFFF", textColor: "#78350F" }; // white bg, amber text — put wins

// ── Ranking direction indicator (UI-only) ─────────────────────────────────────
// Each Ranking cell is compared against the chronologically PREVIOUS bar's
// Ranking (rankingDir) — this comparison is unchanged. Direction is now shown
// as a CELL BACKGROUND (dark green/dark red from the same shared color
// engine's dark theme, via colorClassStyle) with white text, replacing the
// old white-background/colored-text rendering. When direction is unknown
// (first row) or flat (unchanged from the previous row), the cell falls back
// to the existing call/put-winner styling below (C_RANK_CALL/C_RANK_PUT),
// unchanged. The number shown is always the actual Ranking value (never the
// difference), and the underlying calculation/data are untouched — this is
// pure display.

export type RankDir = "up" | "down" | "flat" | "none";

export function rankingDir(curr: number, prev: number | undefined): RankDir {
  if (prev === undefined || !Number.isFinite(prev) || !Number.isFinite(curr)) return "none";
  if (curr > prev) return "up";
  if (curr < prev) return "down";
  return "flat";
}

// C Sign / P Sign color rule (final client spec) — applies ONLY to these two
// columns, as a full CELL BACKGROUND with white text, using the same
// truncated value the cell displays:
//   value > 0            → dark green background
//   value ≤ 0 (or missing) → black background
const C_SIGN_POSITIVE:    CellColor = { bg: "#006400", textColor: "#FFFFFF" };
const C_SIGN_NONPOSITIVE: CellColor = { bg: "#000000", textColor: "#FFFFFF" };

function getCellStyle(colId: string, row: DashboardRow): CellColor {
  switch (colId) {
    case "ranking":
      return row.rankingWinner === "call" ? C_RANK_CALL : C_RANK_PUT;
    case "c-sign":
    case "p-sign": {
      const v = colId === "c-sign" ? row.callMMA - row.callTMA : row.putMMA - row.putTMA;
      return Number.isFinite(v) && truncateForDisplay(v) > 0 ? C_SIGN_POSITIVE : C_SIGN_NONPOSITIVE;
    }
    default:
      return C_DEFAULT;
  }
}

// ── Formatting ────────────────────────────────────────────────────────────────

// Display-only: truncates to a whole number (drops the decimal portion,
// doesn't round). Underlying values keep full precision for calculations —
// only the rendered text is affected. Used for every price column.
const p0 = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? "—" : truncateForDisplay(n).toLocaleString("en-IN");

// Future/Spot Open/High/Low/Close only (client spec): same truncation as p0,
// but WITHOUT the thousands-separator grouping — e.g. 24210, not 24,210.
// Every other column (Call/Put OHLC, MA, TMA, C Sign, P Sign, Ranking,
// Indicators) keeps p0()'s comma formatting untouched.
const p0NoGroup = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? "—" : String(truncateForDisplay(n));

// C Sign / P Sign: MA − TMA per the written spec, shown with an explicit "+"
// prefix when positive (client example: "+5"), truncated like every other
// price column. The same truncated value drives the Dark-Green/Black color
// rule in getCellStyle. NOTE (accepted business reality): with the current
// MA formula (MMA_CLOSE_SIGN = −1, i.e. (O+H+L−C)/4) MA sits at ~half the
// TMA's price scale, so these values are negative on essentially every real
// bar and render black — that is spec-compliant, not a styling defect.
const fmtSign = (n: number): string => {
  if (!Number.isFinite(n)) return "—";
  const tr = truncateForDisplay(n);
  return (tr > 0 ? "+" : "") + tr.toLocaleString("en-IN");
};

// VWAP-specific: null means "no Volume to weight by yet" (client spec) —
// distinct from the generic "—" used for every other not-yet-available cell.
const fmtVwap = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? "VWAP Not Available" : truncateForDisplay(n).toLocaleString("en-IN");

// The single visible EMA column shows the EMA20-vs-EMA200 comparison label,
// not a raw EMA number (client spec) — score is row.emaScore, already
// +1/-1/0 from compareScore(ema20, ema200).
const fmtEmaSignal = (score: number | null | undefined): string => {
  if (score == null || !Number.isFinite(score)) return "—";
  if (score > 0) return "CALL (+1)";
  if (score < 0) return "PUT (-1)";
  return "NEUTRAL (0)";
};

// Time-only display, 24-hour "HH:MM" (e.g. "09:15") — the date is no longer
// shown anywhere in the table per the final client spec. Display-only — the
// row's millisecond timestamp stays the source of truth for ordering and
// candle boundaries.
const fmtTime = (ms: number) => {
  const d = new Date(ms);
  const opts: Intl.DateTimeFormatOptions = {
    hour: "2-digit", minute: "2-digit",
    hour12: false, timeZone: "Asia/Kolkata",
  };
  return d.toLocaleTimeString("en-GB", opts);
};

// ── Cell value resolver ───────────────────────────────────────────────────────
// Values are pre-computed by the row builder; Worksheet only reads them.

// Ranking cell text as displayed: the value prefixed with +/- when it moved
// vs the chronologically previous bar (see rankingDir). Shared by the live
// table render and the Excel export so both show identical text.
export function rankingDisplayValue(row: DashboardRow, prevRow: DashboardRow | undefined): string {
  const dir = rankingDir(row.ranking, prevRow?.ranking);
  let val = p0(row.ranking);
  if ((dir === "up" || dir === "down") && row.ranking >= 0) {
    val = (dir === "up" ? "+" : "-") + val;
  }
  return val;
}

// Visible, ordered column list for a given table configuration — the single
// source of truth shared by the live table render and the Excel export so
// both always show/export the exact same columns in the exact same order.
export function getVisibleColumns(type: string, hiddenCols: string[], colOrder: string[]): ColSpec[] {
  const typeHidden = TYPE_HIDDEN[type] ?? [];
  const sortedBase = colOrder.length > 0
    ? [...ALL_COLS].sort((a, b) => {
        const ai = colOrder.indexOf(a.id);
        const bi = colOrder.indexOf(b.id);
        if (ai === -1 && bi === -1) return 0;
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      })
    : ALL_COLS;
  return sortedBase.filter(c =>
    !hiddenCols.includes(c.id) && !typeHidden.includes(c.id) &&
    !PIVOT_UI_HIDDEN.includes(c.id) && !INDICATOR_UI_HIDDEN.includes(c.id)
  );
}

export function getCellValue(row: DashboardRow, colId: string, pivotMethod: PivotMethod = "client"): string {
  switch (colId) {
    // Time (single frozen column)
    case "datetime":  return fmtTime(row.t);
    // Call OHLC
    case "ce-o":      return p0(row.call.o);
    case "ce-h":      return p0(row.call.h);
    case "ce-l":      return p0(row.call.l);
    case "ce-c":      return p0(row.call.c);
    case "mma-c":     return p0(row.callMMA);
    case "tla-c":     return p0(row.callTMA);
    case "c-sign":    return fmtSign(row.callMMA - row.callTMA);
    // Put OHLC
    case "pe-o":      return p0(row.put.o);
    case "pe-h":      return p0(row.put.h);
    case "pe-l":      return p0(row.put.l);
    case "pe-c":      return p0(row.put.c);
    case "mma-p":     return p0(row.putMMA);
    case "tla-p":     return p0(row.putTMA);
    case "p-sign":    return fmtSign(row.putMMA - row.putTMA);
    // Ranking (compares option MMAs; coloured via getCellStyle)
    case "ranking":   return p0(row.ranking);
    // Future OHLC (no thousands separator, client spec) + MA/TMA (unchanged)
    case "fut-o":     return p0NoGroup(row.future.o);
    case "fut-h":     return p0NoGroup(row.future.h);
    case "fut-l":     return p0NoGroup(row.future.l);
    case "fut-c":     return p0NoGroup(row.future.c);
    case "fut-mma":   return p0(row.futureMMA);
    case "fut-tla":   return p0(row.futureTMA);
    // Space — reserved placeholder column, intentionally always blank
    case "space":     return "";
    // Spot OHLC (no thousands separator, client spec) + MA/TMA (unchanged)
    case "spot-o":    return p0NoGroup(row.spot.o);
    case "spot-h":    return p0NoGroup(row.spot.h);
    case "spot-l":    return p0NoGroup(row.spot.l);
    case "spot-c":    return p0NoGroup(row.spot.c);
    case "spot-mma":  return p0(row.spotMMA);
    case "spot-tla":  return p0(row.spotTMA);
    // Indicators
    case "smc":       return row.smc;
    case "fib":       return row.fib;
    case "rsi":       return p0(row.rsi);
    case "ema":       return fmtEmaSignal(row.emaScore);
    case "vwap":      return fmtVwap(row.vwap);
    // EMA20 vs EMA200 / VWAP vs EMA20 scoring (client EMA & VWAP spec)
    case "ema200":       return p0(row.ema200);
    case "ema-score":    return p0(row.emaScore);
    case "vwap-score":   return p0(row.vwapScore);
    case "total-score":  return p0(row.totalScore);
    case "rating":       return row.rating ?? "—";
    case "signal":       return row.signal ?? "—";
    // Pivot Points — computed on demand from the row's own Future candle so
    // switching pivotMethod recalculates every row immediately, live and
    // historical, without needing to rebuild the stored rows.
    case "pp":        return p0(pivotForBar(pivotMethod, row.future)?.pp);
    case "r1":        return p0(pivotForBar(pivotMethod, row.future)?.r1);
    case "r2":        return p0(pivotForBar(pivotMethod, row.future)?.r2);
    case "r3":        return p0(pivotForBar(pivotMethod, row.future)?.r3);
    case "s1":        return p0(pivotForBar(pivotMethod, row.future)?.s1);
    case "s2":        return p0(pivotForBar(pivotMethod, row.future)?.s2);
    case "s3":        return p0(pivotForBar(pivotMethod, row.future)?.s3);
    default:          return "—";
  }
}

// Raw (pre-formatting) counterpart of getCellValue — returns the actual
// numeric/string value straight from DashboardRow, with no p0()/Math.trunc()
// or other display rounding applied. Used only by the dev-only frozen-column
// detector below, which must compare real values, not rendered text.
export function getCellRawValue(row: DashboardRow, colId: string, pivotMethod: PivotMethod = "client"): number | string | null {
  switch (colId) {
    case "ce-o":      return row.call.o;
    case "ce-h":      return row.call.h;
    case "ce-l":      return row.call.l;
    case "ce-c":      return row.call.c;
    case "mma-c":     return row.callMMA;
    case "tla-c":     return row.callTMA;
    case "c-sign":    return row.callMMA - row.callTMA;
    case "pe-o":      return row.put.o;
    case "pe-h":      return row.put.h;
    case "pe-l":      return row.put.l;
    case "pe-c":      return row.put.c;
    case "mma-p":     return row.putMMA;
    case "tla-p":     return row.putTMA;
    case "p-sign":    return row.putMMA - row.putTMA;
    case "ranking":   return row.ranking;
    case "fut-o":     return row.future.o;
    case "fut-h":     return row.future.h;
    case "fut-l":     return row.future.l;
    case "fut-c":     return row.future.c;
    case "fut-mma":   return row.futureMMA;
    case "fut-tla":   return row.futureTMA;
    case "spot-o":    return row.spot.o;
    case "spot-h":    return row.spot.h;
    case "spot-l":    return row.spot.l;
    case "spot-c":    return row.spot.c;
    case "spot-mma":  return row.spotMMA;
    case "spot-tla":  return row.spotTMA;
    case "smc":       return row.smc;
    case "fib":       return row.fib;
    case "rsi":       return row.rsi;
    case "vwap":      return row.vwap;
    case "ema200":       return row.ema200;
    case "ema-score":    return row.emaScore;
    case "vwap-score":   return row.vwapScore;
    case "total-score":  return row.totalScore;
    case "rating":       return row.rating;
    case "signal":       return row.signal;
    case "pp":        return pivotForBar(pivotMethod, row.future)?.pp ?? null;
    case "r1":        return pivotForBar(pivotMethod, row.future)?.r1 ?? null;
    case "r2":        return pivotForBar(pivotMethod, row.future)?.r2 ?? null;
    case "r3":        return pivotForBar(pivotMethod, row.future)?.r3 ?? null;
    case "s1":        return pivotForBar(pivotMethod, row.future)?.s1 ?? null;
    case "s2":        return pivotForBar(pivotMethod, row.future)?.s2 ?? null;
    case "s3":        return pivotForBar(pivotMethod, row.future)?.s3 ?? null;
    default:          return null;
  }
}

// ── Shimmer skeleton ──────────────────────────────────────────────────────────

const SHIMMER_STYLE: React.CSSProperties = {
  background: "linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)",
  backgroundSize: "200% 100%",
  animation: "ws-shimmer 1.5s infinite",
  borderRadius: 2,
  height: 13,
  display: "block",
};

// ── Main component ────────────────────────────────────────────────────────────

export function Worksheet({ rows, hiddenCols, colOrder, feedStatus, isLoading, type, pivotMethod }: WorksheetProps) {
  const cols = getVisibleColumns(type, hiddenCols, colOrder);

  const initWidths = (): Record<string, number> => {
    const w: Record<string, number> = {};
    ALL_COLS.forEach(c => { w[c.id] = c.defaultW; });
    return w;
  };
  const [colWidths, setColWidths] = useState<Record<string, number>>(initWidths);
  const [selRange, setSelRange]   = useState<SelRange | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Dev-only: detect columns whose values are identical across every visible row.
  const frozenWarnKeyRef = useRef<string>("");
  const [frozenWarn, setFrozenWarn] = useState<string[]>([]);

  // rows is already chronological (oldest first, appendRow pushes newest to
  // the end) — display in that order so the earliest candle is the first row
  // and the live candle is always the last.
  const displayRows = rows;

  // Column-independent Blue/Green/Pink/Black live coloring (see
  // ./cellColorRules) — one left-to-right pass per applicable column,
  // recomputed only when the `rows` array reference actually changes
  // (every live tick), never on unrelated re-renders (selection, resize,
  // column visibility, etc.).
  const liveColorGrid = useMemo(() => buildLiveColorGrid(displayRows), [displayRows]);

  const copySelection = useCallback(() => {
    if (!selRange) return;
    const { r1, c1, r2, c2 } = selRange;
    const lines: string[] = [];
    for (let ri = r1; ri <= r2; ri++) {
      const row = displayRows[ri];
      if (!row) continue;
      const cells: string[] = [];
      for (let ci = c1; ci <= c2; ci++) {
        const col = cols[ci];
        if (col) cells.push(getCellValue(row, col.id, pivotMethod));
      }
      lines.push(cells.join("\t"));
    }
    navigator.clipboard.writeText(lines.join("\n")).catch(() => { /* ignore */ });
  }, [selRange, displayRows, cols, pivotMethod]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "c" && selRange) copySelection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [copySelection, selRange]);

  useEffect(() => {
    const onUp = () => setIsDragging(false);
    document.addEventListener("mouseup", onUp);
    return () => document.removeEventListener("mouseup", onUp);
  }, []);

  // Frozen-column detector — dev only.
  // A column is "frozen" when every non-missing row's RAW (pre-formatting)
  // value is the same within FROZEN_DETECTOR_EPSILON, which indicates the row
  // builder copied one price into all rows instead of using per-bar data.
  // Compares getCellRawValue, never getCellValue/p0() — a column can display
  // identical truncated text (e.g. 104.20/104.38/104.46/104.42 all showing
  // "104") while the underlying calculation is changing correctly every row;
  // that is a display-rounding artifact, not a frozen calculation, and must
  // not be reported here.
  useEffect(() => {
    if (!import.meta.env.DEV || displayRows.length < 2) {
      if (frozenWarn.length > 0) setFrozenWarn([]);
      return;
    }
    const frozen: string[] = [];
    for (const col of cols) {
      if (FROZEN_DETECTOR_EXCLUDED_COLS.has(col.id)) continue;
      const raws = displayRows.map(row => getCellRawValue(row, col.id, pivotMethod));
      const valid = raws.filter(isValidRawValue);
      if (valid.length >= 2 && valid.every(v => rawValuesEqual(v, valid[0]))) {
        const shown = typeof valid[0] === "number" ? valid[0].toFixed(4) : valid[0];
        console.warn(`[Worksheet] FROZEN COLUMN: "${col.sub}" (${col.id}) — all ${valid.length} rows ≈ ${shown} (raw value, tolerance ${FROZEN_DETECTOR_EPSILON})`);
        frozen.push(col.sub);
      }
    }
    const key = frozen.join("|");
    if (key !== frozenWarnKeyRef.current) {
      frozenWarnKeyRef.current = key;
      setFrozenWarn(frozen);
    }
  }, [displayRows, cols, pivotMethod]); // eslint-disable-line react-hooks/exhaustive-deps

  const startResize = (colId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = colWidths[colId] ?? 80;
    const onMove = (ev: MouseEvent) => {
      setColWidths(prev => ({ ...prev, [colId]: Math.max(40, startW + ev.clientX - startX) }));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const totalW = cols.reduce((s, c) => s + (colWidths[c.id] ?? c.defaultW), 0);

  const frozenLeft = (_colId: string): number => 0; // single frozen column always at left: 0

  // Build group spans as a run-length encoding of the visible column list.
  // Also track the pixel left-offset of each group's first column so the
  // frozen Date & Time group header can be pinned to left: 0.
  const visibleGroupSpans = (() => {
    const result: {
      group: Group;
      label: string;
      span: number;
      frozen: boolean;
      leftPx: number;
    }[] = [];
    let leftAcc = 0;

    for (const col of cols) {
      const last = result[result.length - 1];
      if (last && last.group === col.group) {
        last.span++;
      } else {
        result.push({
          group:  col.group,
          label:  GROUP_LABELS[col.group],
          span:   1,
          frozen: !!col.frozen,
          leftPx: leftAcc,
        });
      }
      leftAcc += colWidths[col.id] ?? col.defaultW;
    }
    return result;
  })();

  // ── Shared header heights ──────────────────────────────────────────────────
  // Row 1 (group header) is 34 px; row 2 (column sub-header) is sticky at top: 34.

  const GROUP_ROW_H = 34;

  // ── Skeleton rows ─────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", background: "#FFFFFF" }}>
        <style>{`
          @keyframes ws-shimmer {
            0%  { background-position: 200% 0 }
            100%{ background-position: -200% 0 }
          }
        `}</style>
        <table style={{ borderCollapse: "collapse", tableLayout: "fixed", width: totalW }}>
          <colgroup>{cols.map(c => <col key={c.id} style={{ width: colWidths[c.id] ?? c.defaultW }} />)}</colgroup>
          <thead>
            <tr>
              {visibleGroupSpans.map((gs, i) => {
                const gc = GROUP_COLORS[gs.group];
                return (
                  <th key={i} colSpan={gs.span} style={{
                    border: "1px solid #BDC4CF", padding: "6px 10px",
                    fontFamily: "'Calibri','Segoe UI',system-ui,sans-serif",
                    fontSize: 13, fontWeight: 700, height: GROUP_ROW_H,
                    whiteSpace: "nowrap", textAlign: "center", letterSpacing: "0.04em",
                    textTransform: "uppercase", userSelect: "none",
                    position: "sticky", top: 0, zIndex: gs.frozen ? 7 : 5,
                    background: gc.bg, color: gc.text,
                    ...(gs.frozen ? { left: gs.leftPx } : {}),
                  }}>
                    {gs.label}
                  </th>
                );
              })}
            </tr>
            <tr>
              {cols.map(c => {
                const gc = GROUP_COLORS[c.group];
                return (
                  <th key={c.id} style={{
                    border: "1px solid #BDC4CF", padding: "5px 10px",
                    fontFamily: "'Calibri','Segoe UI',system-ui,sans-serif",
                    fontSize: 12, fontWeight: 600, whiteSpace: "nowrap",
                    textAlign: "center", userSelect: "none",
                    position: "sticky", top: GROUP_ROW_H, zIndex: 4,
                    background: gc.subBg, color: gc.text,
                  }}>
                    {c.sub}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 5 }).map((_, ri) => (
              <tr key={ri}>
                {cols.map(c => (
                  <td key={c.id} style={{
                    border: "1px solid #BDC4CF", padding: "6px 10px",
                    height: 32, background: "#FFFFFF",
                  }}>
                    <span style={SHIMMER_STYLE} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // ── Empty state ───────────────────────────────────────────────────────────

  if (rows.length === 0) {
    return (
      <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#FFFFFF" }}>
        <div style={{ textAlign: "center", color: "#9CA3AF" }}>
          <div style={{ fontSize: 36, marginBottom: 12, opacity: 0.3 }}>📊</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#1A2533", marginBottom: 6 }}>No data yet</div>
          <div style={{ fontSize: 13, color: "#5B6B7F" }}>Configure your selection above and press <strong>Generate</strong></div>
        </div>
      </div>
    );
  }

  // ── Main Excel-style table ────────────────────────────────────────────────

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {import.meta.env.DEV && frozenWarn.length > 0 && (
        <div style={{
          background: "#FEF2F2", borderBottom: "2px solid #EF4444",
          padding: "4px 14px", fontSize: 11, fontWeight: 600, color: "#DC2626", flexShrink: 0,
        }}>
          ⚠ DEV: frozen columns (all rows identical): {frozenWarn.join(", ")} — check data pipeline
        </div>
      )}
      <style>{`
        @keyframes ws-shimmer {
          0%  { background-position: 200% 0 }
          100%{ background-position: -200% 0 }
        }
        .ws-row:hover td { background: #F0F4F8 !important; }
      `}</style>

      {feedStatus === "interrupted" && (
        <div style={{
          background: "#FEF3C7", borderBottom: "1px solid #FDE68A",
          padding: "5px 14px", fontSize: 12, fontWeight: 600, color: "#92400E",
          flexShrink: 0,
        }}>
          ⚠ Feed interrupted — reconnecting…
        </div>
      )}

      {/* ── Scrollable table area ─────────────────────────────────────────── */}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", background: "#FFFFFF" }}>
        <table style={{
          borderCollapse: "collapse",
          tableLayout: "fixed",
          width: Math.max(totalW, 600),
          minWidth: "100%",
          fontFamily: "'Calibri','Segoe UI',system-ui,sans-serif",
        }}>
          <colgroup>
            {cols.map(c => <col key={c.id} style={{ width: colWidths[c.id] ?? c.defaultW }} />)}
          </colgroup>

          <thead>
            {/* ── Row 1: Group headers ──────────────────────────────────── */}
            <tr>
              {visibleGroupSpans.map((gs, i) => {
                const gc = GROUP_COLORS[gs.group];
                return (
                  <th
                    key={i}
                    colSpan={gs.span}
                    style={{
                      border: "1px solid #BDC4CF",
                      borderBottom: `2px solid ${gc.text}40`,
                      padding: "6px 10px",
                      fontSize: 13,
                      fontWeight: 700,
                      height: GROUP_ROW_H,
                      whiteSpace: "nowrap",
                      textAlign: "center",
                      letterSpacing: "0.05em",
                      textTransform: "uppercase",
                      userSelect: "none",
                      position: "sticky",
                      top: 0,
                      // Frozen Date & Time group pins to top-left; all others pin to top only.
                      zIndex: gs.frozen ? 7 : 5,
                      background: gc.bg,
                      color: gc.text,
                      ...(gs.frozen ? { left: gs.leftPx } : {}),
                    }}
                  >
                    {gs.label}
                  </th>
                );
              })}
            </tr>

            {/* ── Row 2: Column sub-headers ─────────────────────────────── */}
            <tr>
              {cols.map((c) => {
                const isFrozen = !!c.frozen;
                const gc = GROUP_COLORS[c.group];
                return (
                  <th
                    key={c.id}
                    style={{
                      border: "1px solid #BDC4CF",
                      padding: "5px 10px",
                      fontSize: 12,
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                      textAlign: "center",
                      userSelect: "none",
                      position: "sticky",
                      top: GROUP_ROW_H,
                      // Frozen sub-headers (date, time) must overlay non-frozen ones on horiz scroll.
                      zIndex: isFrozen ? 6 : 4,
                      background: gc.subBg,
                      color: gc.text,
                      boxShadow: "0 1px 0 #BDC4CF",
                      cursor: "default",
                      ...(isFrozen ? { left: frozenLeft(c.id) } : {}),
                    }}
                  >
                    {c.sub}
                    {/* Drag handle for column resize */}
                    <div
                      onMouseDown={(e) => startResize(c.id, e)}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        position: "absolute", right: 0, top: 0, bottom: 0, width: 5,
                        cursor: "col-resize", zIndex: 10,
                      }}
                    />
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {displayRows.map((row, ri) => (
              <tr key={row.t} className="ws-row">
                {cols.map((c, ci) => {
                  const isFrozen = !!c.frozen;
                  const isInSel  = selRange !== null
                    && ri >= selRange.r1 && ri <= selRange.r2
                    && ci >= selRange.c1 && ci <= selRange.c2;

                  const cs = c.id in TRACKED_COLUMN_ACCESSORS
                    ? colorClassStyle(liveColorGrid[c.id]?.[ri] ?? null, TRACKED_COLUMN_THEME[c.id] ?? "light")
                    : getCellStyle(c.id, row);
                  let val = getCellValue(row, c.id, pivotMethod);
                  let bg         = cs.bg;
                  let textColor  = cs.textColor;
                  let fontWeight = 400;

                  if (c.id === "ranking") {
                    // displayRows is chronological (oldest first), so the
                    // previous bar is the row ABOVE (ri - 1). The oldest row
                    // has no previous bar and renders plain.
                    const dir = rankingDir(row.ranking, displayRows[ri - 1]?.ranking);
                    if (dir === "up" || dir === "down") {
                      // Direction as CELL BACKGROUND (dark green/dark red,
                      // reused from the shared engine's dark theme) with
                      // white text, replacing the old colored-text rendering.
                      const rankStyle = colorClassStyle(dir === "up" ? "green" : "pink", "dark");
                      bg         = rankStyle.bg;
                      textColor  = rankStyle.textColor;
                      fontWeight = 600;
                    }
                    val = rankingDisplayValue(row, displayRows[ri - 1]);
                  }

                  return (
                    <td
                      key={c.id}
                      style={{
                        border: "1px solid #BDC4CF",
                        padding: "6px 10px",
                        fontSize: 13,
                        height: 32,
                        whiteSpace: "nowrap",
                        userSelect: "none",
                        textAlign: (c.align ?? "center") as "left" | "right" | "center",
                        background: isInSel ? "rgba(31,111,235,0.45)" : bg,
                        color: textColor,
                        fontWeight,
                        outline: isInSel ? "1px solid #1F6FEB" : "none",
                        outlineOffset: "-1px",
                        position: isFrozen ? "sticky" : "relative",
                        left:   isFrozen ? frozenLeft(c.id) : undefined,
                        zIndex: isFrozen ? 2 : undefined,
                      }}
                      onMouseDown={() => {
                        setSelRange({ r1: ri, c1: ci, r2: ri, c2: ci });
                        setIsDragging(true);
                      }}
                      onMouseEnter={() => {
                        if (isDragging && selRange) {
                          setSelRange({
                            r1: Math.min(selRange.r1, ri), c1: Math.min(selRange.c1, ci),
                            r2: Math.max(selRange.r2, ri), c2: Math.max(selRange.c2, ci),
                          });
                        }
                      }}
                    >
                      {val}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Status bar ────────────────────────────────────────────────────── */}
      <div style={{
        flexShrink: 0, padding: "5px 12px",
        background: "#F3F6FA", borderTop: "1px solid #BDC4CF",
        fontSize: 11, color: "#5B6B7F",
        display: "flex", justifyContent: "space-between",
        fontFamily: "'Calibri','Segoe UI',system-ui,sans-serif",
      }}>
        <span>{rows.length} bar{rows.length !== 1 ? "s" : ""} · Select range + Ctrl/Cmd-C to copy as TSV</span>
        <span>MA=(O+H+L−C)/4 · TMA=Σ(O+H+L+C)/(4×N) · C/P Sign=MA−TMA · Ranking=max(CallMA,PutMA) · EMA=EMA20 vs EMA200 Spot signal · VWAP Σ(TP×Vol)/ΣVol Future · RSI Wilder(14)</span>
      </div>
    </div>
  );
}

export default Worksheet;
