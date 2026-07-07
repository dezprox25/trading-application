import { useState, useEffect, useCallback, useRef } from "react";
import type { DashboardRow, OHLCBar } from "../../calc";

// ── Types ─────────────────────────────────────────────────────────────────────

type Group = "datetime" | "call" | "put" | "ranking" | "future" | "spot" | "indicators";
type Align = "left" | "right" | "center";

interface ColSpec {
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
}

const TYPE_HIDDEN: Record<string, string[]> = {
  "Call":     ["pe-o", "pe-h", "pe-l", "pe-c", "mma-p", "tla-p"],
  "Put":      ["ce-o", "ce-h", "ce-l", "ce-c", "mma-c", "tla-c"],
  "Call+Put": [],
};

// ── Column definitions (v2 — 31-column client spec) ───────────────────────────

const ALL_COLS: ColSpec[] = [
  // Date & Time (1 frozen column — "DD Mon HH:MM")
  { id: "datetime",  sub: "Date & Time", group: "datetime",   defaultW: 112, frozen: true, align: "center" },
  // Call (CE) — 6 columns
  { id: "ce-o",      sub: "Open",        group: "call",       defaultW: 80 },
  { id: "ce-h",      sub: "High",        group: "call",       defaultW: 80 },
  { id: "ce-l",      sub: "Low",         group: "call",       defaultW: 80 },
  { id: "ce-c",      sub: "Close",       group: "call",       defaultW: 80 },
  { id: "mma-c",     sub: "Call MMA",    group: "call",       defaultW: 88 },
  { id: "tla-c",     sub: "Call TLA",    group: "call",       defaultW: 88 },
  // Put (PE) — 6 columns
  { id: "pe-o",      sub: "Open",        group: "put",        defaultW: 80 },
  { id: "pe-h",      sub: "High",        group: "put",        defaultW: 80 },
  { id: "pe-l",      sub: "Low",         group: "put",        defaultW: 80 },
  { id: "pe-c",      sub: "Close",       group: "put",        defaultW: 80 },
  { id: "mma-p",     sub: "Put MMA",     group: "put",        defaultW: 88 },
  { id: "tla-p",     sub: "Put TLA",     group: "put",        defaultW: 88 },
  // Ranking — 1 column
  { id: "ranking",   sub: "Ranking",     group: "ranking",    defaultW: 90, align: "center" },
  // Future — 6 columns (full OHLC + MMA + TLA)
  { id: "fut-o",     sub: "Open",        group: "future",     defaultW: 80 },
  { id: "fut-h",     sub: "High",        group: "future",     defaultW: 80 },
  { id: "fut-l",     sub: "Low",         group: "future",     defaultW: 80 },
  { id: "fut-c",     sub: "Close",       group: "future",     defaultW: 80 },
  { id: "fut-mma",   sub: "Future MMA",  group: "future",     defaultW: 88 },
  { id: "fut-tla",   sub: "Future TLA",  group: "future",     defaultW: 88 },
  // Spot — 6 columns (full OHLC + MMA + TLA)
  { id: "spot-o",    sub: "Open",        group: "spot",       defaultW: 80 },
  { id: "spot-h",    sub: "High",        group: "spot",       defaultW: 80 },
  { id: "spot-l",    sub: "Low",         group: "spot",       defaultW: 80 },
  { id: "spot-c",    sub: "Close",       group: "spot",       defaultW: 80 },
  { id: "spot-mma",  sub: "Spot MMA",    group: "spot",       defaultW: 88 },
  { id: "spot-tla",  sub: "Spot TLA",    group: "spot",       defaultW: 88 },
  // Indicators — 5 columns
  { id: "smc",       sub: "SMC",         group: "indicators", defaultW: 120, align: "left" },
  { id: "fib",       sub: "FIB",         group: "indicators", defaultW: 110, align: "left" },
  { id: "rsi",       sub: "RSI",         group: "indicators", defaultW: 70 },
  { id: "ema",       sub: "EMA",         group: "indicators", defaultW: 70 },
  { id: "vwap",      sub: "VWAP",        group: "indicators", defaultW: 70 },
];

// ── Group display metadata ────────────────────────────────────────────────────

const GROUP_LABELS: Record<Group, string> = {
  datetime:   "Date & Time",
  call:       "Call",
  put:        "Put",
  ranking:    "Ranking",
  future:     "Future",
  spot:       "Spot",
  indicators: "Indicators",
};

const GROUP_COLORS: Record<Group, { bg: string; subBg: string; text: string }> = {
  datetime:   { bg: "#E8EDF2", subBg: "#EFF2F6", text: "#1A2533" },
  call:       { bg: "#DBEAFE", subBg: "#EFF6FF", text: "#1E40AF" },
  put:        { bg: "#FEF3C7", subBg: "#FFFBEB", text: "#92400E" },
  ranking:    { bg: "#F3E8FF", subBg: "#FAF0FF", text: "#6B21A8" },
  future:     { bg: "#D1FAE5", subBg: "#ECFDF5", text: "#065F46" },
  spot:       { bg: "#CCFBF1", subBg: "#F0FDFA", text: "#0F766E" },
  indicators: { bg: "#EDE9FE", subBg: "#F5F3FF", text: "#4C1D95" },
};

// ── OHLC conditional coloring ─────────────────────────────────────────────────

type CellColor = { bg: string; textColor: string };

const C_HIGH: CellColor      = { bg: "#22C55E", textColor: "#FFFFFF" };
const C_LOW: CellColor       = { bg: "#EF4444", textColor: "#FFFFFF" };
const C_OPEN: CellColor      = { bg: "#3B82F6", textColor: "#FFFFFF" };
const C_BULL: CellColor      = { bg: "#DCFCE7", textColor: "#000000" };
const C_BEAR: CellColor      = { bg: "#FCA5A5", textColor: "#FFFFFF" };
const C_CALL_TINT: CellColor = { bg: "#EFF6FF", textColor: "#1E40AF" };
const C_PUT_TINT: CellColor  = { bg: "#FFFBEB", textColor: "#92400E" };
const C_DEFAULT: CellColor   = { bg: "#FFFFFF", textColor: "#000000" };

function ohlcColor(role: "o" | "h" | "l" | "c", bar: OHLCBar): CellColor {
  if (!Number.isFinite(bar.o)) return C_DEFAULT; // NaN sentinel — no data for this bar
  const { o, h, l, c } = bar;
  switch (role) {
    case "h": return C_HIGH;
    case "l": return C_LOW;
    case "c":
      if (c === h) return C_HIGH;
      if (c === l) return C_LOW;
      if (c > o)   return C_BULL;
      if (c < o)   return C_BEAR;
      return C_DEFAULT;
    case "o":
      if (o === h) return C_HIGH;
      if (o === l) return C_LOW;
      return C_OPEN;
  }
}

const C_RANK_CALL: CellColor = { bg: "#FFFFFF", textColor: "#1E40AF" }; // white bg, blue text — call wins
const C_RANK_PUT:  CellColor = { bg: "#FFFFFF", textColor: "#78350F" }; // white bg, amber text — put wins

// ── Ranking direction indicator (UI-only) ─────────────────────────────────────
// Each Ranking cell is compared against the chronologically PREVIOUS bar's
// Ranking and rendered with a +/− prefix and green/red emphasis. The number
// shown is always the actual Ranking value (never the difference), and the
// underlying calculation/data are untouched — this is pure display.
const C_RANK_UP_TEXT   = "#16A34A"; // green — higher than previous bar
const C_RANK_DOWN_TEXT = "#DC2626"; // red — lower than previous bar

type RankDir = "up" | "down" | "flat" | "none";

function rankingDir(curr: number, prev: number | undefined): RankDir {
  if (prev === undefined || !Number.isFinite(prev) || !Number.isFinite(curr)) return "none";
  if (curr > prev) return "up";
  if (curr < prev) return "down";
  return "flat";
}

function getCellStyle(colId: string, row: DashboardRow): CellColor {
  switch (colId) {
    case "ce-o":   return ohlcColor("o", row.call);
    case "ce-h":   return ohlcColor("h", row.call);
    case "ce-l":   return ohlcColor("l", row.call);
    case "ce-c":   return ohlcColor("c", row.call);
    case "mma-c":
    case "tla-c":  return C_CALL_TINT;
    case "pe-o":   return ohlcColor("o", row.put);
    case "pe-h":   return ohlcColor("h", row.put);
    case "pe-l":   return ohlcColor("l", row.put);
    case "pe-c":   return ohlcColor("c", row.put);
    case "mma-p":
    case "tla-p":  return C_PUT_TINT;
    case "ranking":
      return row.rankingWinner === "call" ? C_RANK_CALL : C_RANK_PUT;
    case "fut-o":  return ohlcColor("o", row.future);
    case "fut-h":  return ohlcColor("h", row.future);
    case "fut-l":  return ohlcColor("l", row.future);
    case "fut-c":  return ohlcColor("c", row.future);
    case "spot-o": return ohlcColor("o", row.spot);
    case "spot-h": return ohlcColor("h", row.spot);
    case "spot-l": return ohlcColor("l", row.spot);
    case "spot-c": return ohlcColor("c", row.spot);
    default:       return C_DEFAULT;
  }
}

// ── Formatting ────────────────────────────────────────────────────────────────

const p0 = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? "—" : Math.round(n).toLocaleString("en-IN");

// Option premiums move in ₹0.05 ticks — sub-rupee precision is real market
// signal. A deep-OTM expiry-day put trading 1.35→1.50 must render as
// 1.35/1.50, not as a constant "1" (Math.floor destroyed all variation and
// made the PUT side look frozen). Used for Call/Put OHLC, MMA, TLA, Ranking.
const p2 = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n)
    ? "—"
    : n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// 12-hour display with AM/PM (e.g. "07 Jul, 1:04 PM"). Display-only — the
// row's millisecond timestamp stays the source of truth for ordering and
// candle boundaries. ICU emits lowercase "am/pm"; the spec wants uppercase.
const fmtDateTime = (ms: number) => {
  const d = new Date(ms);
  const opts: Intl.DateTimeFormatOptions = {
    day: "2-digit", month: "short",
    hour: "numeric", minute: "2-digit",
    hour12: true, timeZone: "Asia/Kolkata",
  };
  return d.toLocaleString("en-IN", opts).replace(/\s?(am|pm)$/i, (m) => m.toUpperCase());
};

// ── Cell value resolver ───────────────────────────────────────────────────────
// Values are pre-computed by the row builder; Worksheet only reads them.

function getCellValue(row: DashboardRow, colId: string): string {
  switch (colId) {
    // Date & Time (single frozen column)
    case "datetime":  return fmtDateTime(row.t);
    // Call OHLC (option premiums — 2-decimal precision, see p2)
    case "ce-o":      return p2(row.call.o);
    case "ce-h":      return p2(row.call.h);
    case "ce-l":      return p2(row.call.l);
    case "ce-c":      return p2(row.call.c);
    case "mma-c":     return p2(row.callMMA);
    case "tla-c":     return p2(row.callTLA);
    // Put OHLC (option premiums — 2-decimal precision, see p2)
    case "pe-o":      return p2(row.put.o);
    case "pe-h":      return p2(row.put.h);
    case "pe-l":      return p2(row.put.l);
    case "pe-c":      return p2(row.put.c);
    case "mma-p":     return p2(row.putMMA);
    case "tla-p":     return p2(row.putTLA);
    // Ranking (compares option MMAs — same precision; coloured via getCellStyle)
    case "ranking":   return p2(row.ranking);
    // Future OHLC + indicators
    case "fut-o":     return p0(row.future.o);
    case "fut-h":     return p0(row.future.h);
    case "fut-l":     return p0(row.future.l);
    case "fut-c":     return p0(row.future.c);
    case "fut-mma":   return p0(row.futureMMA);
    case "fut-tla":   return p0(row.futureTLA);
    // Spot OHLC + indicators
    case "spot-o":    return p0(row.spot.o);
    case "spot-h":    return p0(row.spot.h);
    case "spot-l":    return p0(row.spot.l);
    case "spot-c":    return p0(row.spot.c);
    case "spot-mma":  return p0(row.spotMMA);
    case "spot-tla":  return p0(row.spotTLA);
    // Indicators
    case "smc":       return row.smc;
    case "fib":       return row.fib;
    case "rsi":       return p0(row.rsi);
    case "ema":       return p0(row.ema);
    case "vwap":      return p0(row.vwap);
    default:          return "—";
  }
}

// ── Shimmer skeleton ──────────────────────────────────────────────────────────

const SHIMMER_STYLE: React.CSSProperties = {
  background: "linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)",
  backgroundSize: "200% 100%",
  animation: "ws-shimmer 1.5s infinite",
  borderRadius: 2,
  height: 10,
  display: "block",
};

// ── Main component ────────────────────────────────────────────────────────────

export function Worksheet({ rows, hiddenCols, colOrder, feedStatus, isLoading, type }: WorksheetProps) {
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

  const cols = sortedBase.filter(c => !hiddenCols.includes(c.id) && !typeHidden.includes(c.id));

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

  const displayRows = [...rows].reverse();

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
        if (col) cells.push(getCellValue(row, col.id));
      }
      lines.push(cells.join("\t"));
    }
    navigator.clipboard.writeText(lines.join("\n")).catch(() => { /* ignore */ });
  }, [selRange, displayRows, cols]);

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
  // A column is "frozen" when every non-missing row shows the same value,
  // which indicates the row builder copied one price into all rows instead
  // of using per-bar data.
  useEffect(() => {
    if (!import.meta.env.DEV || displayRows.length < 2) {
      if (frozenWarn.length > 0) setFrozenWarn([]);
      return;
    }
    const frozen: string[] = [];
    for (const col of cols) {
      if (col.id === "datetime" || col.id === "smc" || col.id === "fib") continue;
      const vals = displayRows.map(row => getCellValue(row, col.id));
      const valid = vals.filter(v => v !== "—");
      if (valid.length >= 2 && valid.every(v => v === valid[0])) {
        console.warn(`[Worksheet] FROZEN COLUMN: "${col.sub}" (${col.id}) — all ${valid.length} rows = "${valid[0]}"`);
        frozen.push(col.sub);
      }
    }
    const key = frozen.join("|");
    if (key !== frozenWarnKeyRef.current) {
      frozenWarnKeyRef.current = key;
      setFrozenWarn(frozen);
    }
  }, [displayRows, cols]); // eslint-disable-line react-hooks/exhaustive-deps

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
  // Row 1 (group header) is 26 px; row 2 (column sub-header) is sticky at top: 26.

  const GROUP_ROW_H = 26;

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
                    border: "1px solid #BDC4CF", padding: "3px 8px",
                    fontFamily: "'Calibri','Segoe UI',system-ui,sans-serif",
                    fontSize: 11, fontWeight: 700, height: GROUP_ROW_H,
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
                    border: "1px solid #BDC4CF", padding: "2px 6px",
                    fontFamily: "'Calibri','Segoe UI',system-ui,sans-serif",
                    fontSize: 10, fontWeight: 600, whiteSpace: "nowrap",
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
                    border: "1px solid #BDC4CF", padding: "2px 6px",
                    height: 22, background: "#FFFFFF",
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
                      padding: "3px 8px",
                      fontSize: 11,
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
                      padding: "2px 6px",
                      fontSize: 10,
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

                  const cs  = getCellStyle(c.id, row);
                  let val = getCellValue(row, c.id);
                  let textColor  = cs.textColor;
                  let fontWeight = 400;

                  if (c.id === "ranking") {
                    // displayRows is newest-first, so the chronologically
                    // previous bar is the row BELOW (ri + 1). The oldest row
                    // has no previous bar and renders plain.
                    const dir = rankingDir(row.ranking, displayRows[ri + 1]?.ranking);
                    if (dir === "up" || dir === "down") {
                      textColor  = dir === "up" ? C_RANK_UP_TEXT : C_RANK_DOWN_TEXT;
                      fontWeight = 600;
                      // Prefix marks direction vs previous row; the number is
                      // the actual Ranking value. A negative value keeps its
                      // own sign (no double prefix) — colour still shows direction.
                      if (row.ranking >= 0) val = (dir === "up" ? "+" : "-") + val;
                    }
                  }

                  return (
                    <td
                      key={c.id}
                      style={{
                        border: "1px solid #BDC4CF",
                        padding: "2px 6px",
                        fontSize: 11,
                        height: 22,
                        whiteSpace: "nowrap",
                        userSelect: "none",
                        textAlign: (c.align ?? "center") as "left" | "right" | "center",
                        background: isInSel ? "rgba(31,111,235,0.45)" : cs.bg,
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
        flexShrink: 0, padding: "3px 12px",
        background: "#F3F6FA", borderTop: "1px solid #BDC4CF",
        fontSize: 10, color: "#5B6B7F",
        display: "flex", justifyContent: "space-between",
        fontFamily: "'Calibri','Segoe UI',system-ui,sans-serif",
      }}>
        <span>{rows.length} bar{rows.length !== 1 ? "s" : ""} · Select range + Ctrl/Cmd-C to copy as TSV</span>
        <span>MMA=(O+H+L−C)/4 · TLA=2×MMA−H · Ranking=max(CallMMA,PutMMA) · EMA-20 Spot · VWAP cumΣ(TP)/n · RSI Wilder(14)</span>
      </div>
    </div>
  );
}

export default Worksheet;
