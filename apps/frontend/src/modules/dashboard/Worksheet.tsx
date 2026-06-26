import { useState, useEffect, useCallback } from "react";
import type { DashboardRow } from "../../calc";

// ── Types ─────────────────────────────────────────────────────────────────────

type Group = "date" | "call" | "put" | "market" | "rating" | "mma-call" | "mma-put" | "tla-call" | "tla-put" | "analysis";
type Align = "left" | "right" | "center";
type PivotMethod = "client" | "classic";

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
  pivotMethod: PivotMethod;
  hiddenCols: string[];
  feedStatus: "idle" | "live" | "interrupted";
  isLoading: boolean;
}

// ── Column definitions ────────────────────────────────────────────────────────

const ALL_COLS: ColSpec[] = [
  { id: "date",    sub: "Date",    group: "date",     defaultW: 72,  frozen: true,  align: "center" },
  { id: "time",    sub: "Time",    group: "date",     defaultW: 60,  frozen: true,  align: "center" },
  { id: "ce-o",    sub: "Open",    group: "call",     defaultW: 80 },
  { id: "ce-h",    sub: "High",    group: "call",     defaultW: 80 },
  { id: "ce-l",    sub: "Low",     group: "call",     defaultW: 80 },
  { id: "ce-c",    sub: "Close",   group: "call",     defaultW: 80 },
  { id: "call-pp", sub: "Call PP", group: "call",     defaultW: 82 },
  { id: "pe-o",    sub: "Open",    group: "put",      defaultW: 80 },
  { id: "pe-h",    sub: "High",    group: "put",      defaultW: 80 },
  { id: "pe-l",    sub: "Low",     group: "put",      defaultW: 80 },
  { id: "pe-c",    sub: "Close",   group: "put",      defaultW: 80 },
  { id: "put-pp",  sub: "Put PP",  group: "put",      defaultW: 82 },
  { id: "future",  sub: "Future",  group: "market",   defaultW: 88 },
  { id: "spot",    sub: "Spot",    group: "market",   defaultW: 88 },
  { id: "rating",  sub: "Rating",  group: "rating",   defaultW: 90,  align: "center" },
  { id: "mma-c",   sub: "Call",    group: "mma-call", defaultW: 80 },
  { id: "mma-p",   sub: "Put",     group: "mma-put",  defaultW: 80 },
  { id: "tla-c",   sub: "Call",    group: "tla-call", defaultW: 80 },
  { id: "tla-p",   sub: "Put",     group: "tla-put",  defaultW: 80 },
  { id: "smc",     sub: "SMC",     group: "analysis", defaultW: 120, align: "left"  },
  { id: "fib",     sub: "Fib",     group: "analysis", defaultW: 110, align: "left"  },
  { id: "rsi",     sub: "RSI(14)", group: "analysis", defaultW: 70 },
];

// ── Group header definitions ──────────────────────────────────────────────────

const GROUP_DEFS: { label: string; ids: string[]; bg: string; color: string }[] = [
  { label: "",           ids: ["date","time"],                               bg: "#1F4E79", color: "#fff" },
  { label: "Call (CE)",  ids: ["ce-o","ce-h","ce-l","ce-c","call-pp"],       bg: "#2E75B6", color: "#fff" },
  { label: "Put (PE)",   ids: ["pe-o","pe-h","pe-l","pe-c","put-pp"],        bg: "#C55A11", color: "#fff" },
  { label: "Market",     ids: ["future","spot"],                              bg: "#1F4E79", color: "#fff" },
  { label: "Signal",     ids: ["rating"],                                     bg: "#1F4E79", color: "#fff" },
  { label: "MMA",        ids: ["mma-c","mma-p"],                              bg: "#1F4E79", color: "#fff" },
  { label: "TLA",        ids: ["tla-c","tla-p"],                              bg: "#1F4E79", color: "#fff" },
  { label: "Analysis",   ids: ["smc","fib","rsi"],                            bg: "#1F4E79", color: "#fff" },
];

// ── Cell background per group × row parity ────────────────────────────────────

function cellBg(group: Group, even: boolean): string {
  switch (group) {
    case "date":     return "#F3F6FA";
    case "call":     return even ? "#D6E4F2" : "#EAF1F9";
    case "put":      return even ? "#FBE2CE" : "#FDF1E7";
    case "mma-call": return even ? "#D6E4F2" : "#EAF1F9";
    case "mma-put":  return even ? "#FBE2CE" : "#FDF1E7";
    case "tla-call": return even ? "#D6E4F2" : "#EAF1F9";
    case "tla-put":  return even ? "#FBE2CE" : "#FDF1E7";
    default:         return even ? "#FFFFFF" : "#EBF3FA";
  }
}

// ── Conditional format: rank within a group's numeric values per row ──────────

function rankColor(val: number, vals: number[]): { color: string; fontWeight?: number } {
  const sorted = [...new Set(vals.filter(Number.isFinite))].sort((a, b) => a - b);
  if (sorted.length <= 1) return { color: "#1A2533" };
  const idx = sorted.indexOf(val);
  if (idx === sorted.length - 1) return { color: "#1F6FEB", fontWeight: 700 };
  if (idx === sorted.length - 2) return { color: "#2E9E4F" };
  if (idx === 1)                  return { color: "#D8403C" };
  if (idx === 0)                  return { color: "#7A8A9F" };
  return { color: "#1A2533" };
}

// ── Formatting ────────────────────────────────────────────────────────────────

const p2 = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? "—" : n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const p1 = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? "—" : n.toFixed(1);

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
const fmtTime = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
};

// ── Get raw text value per cell (for TSV copy) ────────────────────────────────

function getCellValue(row: DashboardRow, colId: string, pm: PivotMethod): string {
  const pp = (seg: "call" | "put") => pm === "client"
    ? (seg === "call" ? row.callPP : row.putPP)
    : (seg === "call" ? row.callPPClassic : row.putPPClassic);

  switch (colId) {
    case "date":    return fmtDate(row.t);
    case "time":    return fmtTime(row.t);
    case "ce-o":    return p2(row.call.o);
    case "ce-h":    return p2(row.call.h);
    case "ce-l":    return p2(row.call.l);
    case "ce-c":    return p2(row.call.c);
    case "call-pp": return p2(pp("call"));
    case "pe-o":    return p2(row.put.o);
    case "pe-h":    return p2(row.put.h);
    case "pe-l":    return p2(row.put.l);
    case "pe-c":    return p2(row.put.c);
    case "put-pp":  return p2(pp("put"));
    case "future":  return p2(row.futureLtp);
    case "spot":    return p2(row.spotLtp);
    case "rating":  return row.rating.label;
    case "mma-c":   return p2(row.callMMA);
    case "mma-p":   return p2(row.putMMA);
    case "tla-c":   return p2(row.callTLA);
    case "tla-p":   return p2(row.putTLA);
    case "smc":     return row.smc;
    case "fib":     return row.fib;
    case "rsi":     return p1(row.rsi);
    default:        return "—";
  }
}

// ── Rating badge ─────────────────────────────────────────────────────────────

function RatingBadge({ label }: { label: string }) {
  const isGreen = label === "Buy" || label === "Strong Buy";
  const isRed   = label === "Sell" || label === "Strong Sell";
  return (
    <span style={{
      display: "inline-block", padding: "1px 7px", borderRadius: 3,
      fontSize: 10, fontWeight: 700, letterSpacing: "0.04em",
      background: isGreen ? "#dcfce7" : isRed ? "#fee2e2" : "#f1f5f9",
      color:      isGreen ? "#2E9E4F" : isRed ? "#D8403C" : "#8A93A3",
      whiteSpace: "nowrap",
    }}>
      {label}
    </span>
  );
}

// ── Shimmer skeleton ──────────────────────────────────────────────────────────

const SHIMMER_STYLE: React.CSSProperties = {
  background: "linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)",
  backgroundSize: "200% 100%",
  animation: "ws-shimmer 1.5s infinite",
  borderRadius: 2,
  height: 12,
  display: "block",
};

// ── Main component ────────────────────────────────────────────────────────────

export function Worksheet({ rows, pivotMethod, hiddenCols, feedStatus, isLoading }: WorksheetProps) {
  // Visible columns (respects hidden)
  const cols = ALL_COLS.filter(c => !hiddenCols.includes(c.id));

  // Column widths state
  const initWidths = (): Record<string, number> => {
    const w: Record<string, number> = {};
    ALL_COLS.forEach(c => { w[c.id] = c.defaultW; });
    return w;
  };
  const [colWidths, setColWidths] = useState<Record<string, number>>(initWidths);

  // Hover + selection
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);
  const [selRange, setSelRange]     = useState<SelRange | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Ctrl+C copy
  const displayRows = [...rows].reverse(); // newest first

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
      if ((e.ctrlKey || e.metaKey) && e.key === "c" && selRange) {
        copySelection();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [copySelection, selRange]);

  useEffect(() => {
    const onUp = () => setIsDragging(false);
    document.addEventListener("mouseup", onUp);
    return () => document.removeEventListener("mouseup", onUp);
  }, []);

  // Column resize
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

  // Compute total table width
  const totalW = cols.reduce((s, c) => s + (colWidths[c.id] ?? c.defaultW), 0);

  // Frozen column left offsets
  const frozenLeft = (colId: string): number => {
    if (colId === "date") return 0;
    if (colId === "time") return colWidths["date"] ?? 72;
    return 0;
  };

  // Per-row conditional format values for call/put groups
  const callIds = ["ce-o","ce-h","ce-l","ce-c","call-pp"];
  const putIds  = ["pe-o","pe-h","pe-l","pe-c","put-pp"];

  function getCallNums(row: DashboardRow, pm: PivotMethod): number[] {
    return [row.call.o, row.call.h, row.call.l, row.call.c, pm === "client" ? row.callPP : row.callPPClassic];
  }
  function getPutNums(row: DashboardRow, pm: PivotMethod): number[] {
    return [row.put.o, row.put.h, row.put.l, row.put.c, pm === "client" ? row.putPP : row.putPPClassic];
  }
  function getColNum(row: DashboardRow, colId: string, pm: PivotMethod): number | null {
    switch (colId) {
      case "ce-o":    return row.call.o;
      case "ce-h":    return row.call.h;
      case "ce-l":    return row.call.l;
      case "ce-c":    return row.call.c;
      case "call-pp": return pm === "client" ? row.callPP : row.callPPClassic;
      case "pe-o":    return row.put.o;
      case "pe-h":    return row.put.h;
      case "pe-l":    return row.put.l;
      case "pe-c":    return row.put.c;
      case "put-pp":  return pm === "client" ? row.putPP : row.putPPClassic;
      default:        return null;
    }
  }

  // Visible group defs (filter for visible cols only)
  const visibleGroupDefs = GROUP_DEFS.map(gd => ({
    ...gd,
    span: gd.ids.filter(id => cols.some(c => c.id === id)).length,
  })).filter(gd => gd.span > 0);

  // Shared <th> style for both header rows
  const thBase: React.CSSProperties = {
    border: "1px solid #BDC4CF",
    padding: "4px 8px",
    fontFamily: "'Calibri','Segoe UI',system-ui,sans-serif",
    fontSize: 11,
    whiteSpace: "nowrap",
    userSelect: "none",
    position: "sticky",
    top: 0,
    zIndex: 4,
  };

  const tdBase: React.CSSProperties = {
    border: "1px solid #BDC4CF",
    padding: "4px 8px",
    fontFamily: "'Calibri','Segoe UI',system-ui,sans-serif",
    fontSize: 12,
    whiteSpace: "nowrap",
    userSelect: "none",
    textAlign: "right",
  };

  // ── Skeleton rows ─────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div style={{ flex: 1, overflow: "auto", background: "#FFFFFF" }}>
        <style>{`
          @keyframes ws-shimmer {
            0%  { background-position: 200% 0 }
            100%{ background-position: -200% 0 }
          }
        `}</style>
        <table style={{ borderCollapse: "collapse", tableLayout: "fixed", width: totalW, fontFamily: "'Calibri','Segoe UI',system-ui,sans-serif" }}>
          <colgroup>{cols.map(c => <col key={c.id} style={{ width: colWidths[c.id] ?? c.defaultW }} />)}</colgroup>
          <thead>
            <tr>{visibleGroupDefs.map(gd => (
              <th key={gd.label} colSpan={gd.span} style={{ ...thBase, background: gd.bg, color: gd.color, textAlign: "center", fontWeight: 700, fontSize: 11, top: 0 }}>
                {gd.label}
              </th>
            ))}</tr>
            <tr>{cols.map(c => (
              <th key={c.id} style={{ ...thBase, top: 32, background: c.group === "call" ? "#2E75B6" : c.group === "put" ? "#C55A11" : "#1F4E79", color: "#e2e8f0", fontWeight: 600, fontSize: 10, textAlign: (c.align ?? "right") as "left"|"right"|"center" }}>
                {c.sub}
              </th>
            ))}</tr>
          </thead>
          <tbody>
            {Array.from({ length: 5 }).map((_, ri) => (
              <tr key={ri}>
                {cols.map(c => (
                  <td key={c.id} style={{ ...tdBase, background: cellBg(c.group, ri % 2 === 0) }}>
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
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: "#FFFFFF" }}>
        <div style={{ textAlign: "center", color: "#5B6B7F" }}>
          <div style={{ fontSize: 36, marginBottom: 12, opacity: 0.3 }}>📊</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#1A2533", marginBottom: 6 }}>No data yet</div>
          <div style={{ fontSize: 13 }}>Configure your selection above and press <strong>Generate</strong></div>
        </div>
      </div>
    );
  }

  // ── Main Excel table ──────────────────────────────────────────────────────

  return (
    <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <style>{`
        @keyframes ws-shimmer {
          0%  { background-position: 200% 0 }
          100%{ background-position: -200% 0 }
        }
        .ws-row:hover td { filter: brightness(0.96); }
      `}</style>

      {/* Feed interrupted banner */}
      {feedStatus === "interrupted" && (
        <div style={{
          background: "#FEF3C7", borderBottom: "1px solid #FDE68A",
          padding: "5px 14px", fontSize: 12, fontWeight: 600, color: "#92400E",
          flexShrink: 0,
        }}>
          ⚠ Feed interrupted — reconnecting…
        </div>
      )}

      <div style={{ flex: 1, overflow: "auto" }}>
        <table style={{ borderCollapse: "collapse", tableLayout: "fixed", width: totalW, minWidth: "100%" }}>
          <colgroup>
            {cols.map(c => <col key={c.id} style={{ width: colWidths[c.id] ?? c.defaultW }} />)}
          </colgroup>

          <thead>
            {/* ── Group header row ── */}
            <tr>
              {visibleGroupDefs.map((gd) => (
                <th
                  key={gd.label + gd.bg}
                  colSpan={gd.span}
                  style={{
                    ...thBase,
                    background: gd.bg,
                    color: gd.color,
                    textAlign: "center",
                    fontWeight: 700,
                    fontSize: 11,
                    letterSpacing: "0.06em",
                    top: 0,
                    boxShadow: "0 2px 0 #BDC4CF",
                  }}
                >
                  {gd.label}
                </th>
              ))}
            </tr>

            {/* ── Sub-label row ── */}
            <tr>
              {cols.map((c) => {
                const isFrozen = !!c.frozen;
                const subBg = c.group === "call" ? "#2565a0" : c.group === "put" ? "#a34c0e" : "#17426b";
                return (
                  <th
                    key={c.id}
                    style={{
                      ...thBase,
                      top: 32,
                      background: subBg,
                      color: "#e2e8f0",
                      fontWeight: 600,
                      fontSize: 10,
                      textAlign: (c.align ?? "right") as "left"|"right"|"center",
                      position: "sticky",
                      zIndex: isFrozen ? 6 : 4,
                      ...(isFrozen ? { left: frozenLeft(c.id) } : {}),
                      cursor: "default",
                      paddingRight: 10,
                    }}
                  >
                    {c.sub}
                    {/* Resize handle */}
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
            {displayRows.map((row, ri) => {
              const even  = ri % 2 === 0;
              const callNums = getCallNums(row, pivotMethod);
              const putNums  = getPutNums(row, pivotMethod);
              const pp = (seg: "call" | "put") => pivotMethod === "client"
                ? (seg === "call" ? row.callPP : row.putPP)
                : (seg === "call" ? row.callPPClassic : row.putPPClassic);

              return (
                <tr
                  key={row.t}
                  className="ws-row"
                  onMouseEnter={() => setHoveredRow(ri)}
                  onMouseLeave={() => setHoveredRow(null)}
                  style={{ background: hoveredRow === ri ? "#F0F4F8" : undefined }}
                >
                  {cols.map((c, ci) => {
                    const isFrozen  = !!c.frozen;
                    const bg        = cellBg(c.group, even);
                    const isInSel   = selRange !== null
                      && ri >= selRange.r1 && ri <= selRange.r2
                      && ci >= selRange.c1 && ci <= selRange.c2;

                    // Conditional format text color
                    let textStyle: React.CSSProperties = { color: "#1A2533" };
                    if (callIds.includes(c.id)) {
                      const num = getColNum(row, c.id, pivotMethod);
                      if (num !== null) textStyle = rankColor(num, callNums);
                    } else if (putIds.includes(c.id)) {
                      const num = getColNum(row, c.id, pivotMethod);
                      if (num !== null) textStyle = rankColor(num, putNums);
                    } else if (c.id === "rsi") {
                      textStyle = { color: row.rsi !== null ? row.rsi > 70 ? "#D8403C" : row.rsi < 30 ? "#2E9E4F" : "#5B6B7F" : "#5B6B7F" };
                    }

                    // Cell content
                    let content: React.ReactNode;
                    if (c.id === "rating") {
                      content = <RatingBadge label={row.rating.label} />;
                    } else {
                      let val = getCellValue(row, c.id, pivotMethod);
                      // For PP, use active pivot method value
                      if (c.id === "call-pp") val = p2(pp("call"));
                      if (c.id === "put-pp")  val = p2(pp("put"));
                      content = <span style={textStyle}>{val}</span>;
                    }

                    return (
                      <td
                        key={c.id}
                        style={{
                          ...tdBase,
                          background: isInSel ? "rgba(31,111,235,0.12)" : bg,
                          outline: isInSel ? "1px solid #1F6FEB" : "none",
                          outlineOffset: "-1px",
                          textAlign: (c.align ?? "right") as "left"|"right"|"center",
                          position: isFrozen ? "sticky" : "relative",
                          left:    isFrozen ? frozenLeft(c.id) : undefined,
                          zIndex:  isFrozen ? 2 : undefined,
                          ...(isFrozen ? { background: isInSel ? "rgba(31,111,235,0.12)" : bg } : {}),
                        }}
                        onMouseDown={() => { setSelRange({ r1: ri, c1: ci, r2: ri, c2: ci }); setIsDragging(true); }}
                        onMouseEnter={() => {
                          if (isDragging && selRange) {
                            setSelRange({
                              r1: Math.min(selRange.r1, ri), c1: Math.min(selRange.c1, ci),
                              r2: Math.max(selRange.r2, ri), c2: Math.max(selRange.c2, ci),
                            });
                          }
                        }}
                      >
                        {content}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div style={{
        flexShrink: 0, padding: "4px 12px",
        background: "#F3F6FA", borderTop: "1px solid #BDC4CF",
        fontSize: 10, color: "#5B6B7F",
        display: "flex", justifyContent: "space-between",
        fontFamily: "'Calibri','Segoe UI',system-ui,sans-serif",
      }}>
        <span>{rows.length} bar{rows.length !== 1 ? "s" : ""} · Max 15 · Select range + Ctrl/Cmd-C to copy as TSV</span>
        <span>Client PP=(O+H+L+C)/4 · Classic PP=(H+L+C)/3 · MMA=2PP−H · TLA=2PP−L · RSI Wilder(14)</span>
      </div>
    </div>
  );
}

export default Worksheet;
