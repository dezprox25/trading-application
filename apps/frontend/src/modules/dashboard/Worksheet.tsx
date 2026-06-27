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

const GROUP_DEFS: { label: string; ids: string[] }[] = [
  { label: "",           ids: ["date","time"] },
  { label: "Call (CE)",  ids: ["ce-o","ce-h","ce-l","ce-c","call-pp"] },
  { label: "Put (PE)",   ids: ["pe-o","pe-h","pe-l","pe-c","put-pp"] },
  { label: "Market",     ids: ["future","spot"] },
  { label: "Signal",     ids: ["rating"] },
  { label: "MMA",        ids: ["mma-c","mma-p"] },
  { label: "TLA",        ids: ["tla-c","tla-p"] },
  { label: "Analysis",   ids: ["smc","fib","rsi"] },
];

// ── Per-column cell style (plain white / black) ───────────────────────────────

function cellStyle(_colId: string): { bg: string; textColor: string; bold?: boolean } {
  return { bg: "#FFFFFF", textColor: "#000000" };
}

function ratingStyle(_label: string): { bg: string; textColor: string } {
  return { bg: "#FFFFFF", textColor: "#000000" };
}

// ── Formatting ────────────────────────────────────────────────────────────────

const p0 = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? "—" : Math.floor(n).toLocaleString("en-IN");

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
    case "ce-o":    return p0(row.call.o);
    case "ce-h":    return p0(row.call.h);
    case "ce-l":    return p0(row.call.l);
    case "ce-c":    return p0(row.call.c);
    case "call-pp": return p0(pp("call"));
    case "pe-o":    return p0(row.put.o);
    case "pe-h":    return p0(row.put.h);
    case "pe-l":    return p0(row.put.l);
    case "pe-c":    return p0(row.put.c);
    case "put-pp":  return p0(pp("put"));
    case "future":  return p0(row.futureLtp);
    case "spot":    return p0(row.spotLtp);
    case "rating":  return row.rating.label;
    case "mma-c":   return p0(row.callMMA);
    case "mma-p":   return p0(row.putMMA);
    case "tla-c":   return p0(row.callTLA);
    case "tla-p":   return p0(row.putTLA);
    case "smc":     return row.smc;
    case "fib":     return row.fib;
    case "rsi":     return p0(row.rsi);
    default:        return "—";
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

export function Worksheet({ rows, pivotMethod, hiddenCols, feedStatus, isLoading }: WorksheetProps) {
  const cols = ALL_COLS.filter(c => !hiddenCols.includes(c.id));

  const initWidths = (): Record<string, number> => {
    const w: Record<string, number> = {};
    ALL_COLS.forEach(c => { w[c.id] = c.defaultW; });
    return w;
  };
  const [colWidths, setColWidths] = useState<Record<string, number>>(initWidths);

  const [hoveredRow, setHoveredRow]   = useState<number | null>(null);
  const [selRange, setSelRange]        = useState<SelRange | null>(null);
  const [isDragging, setIsDragging]   = useState(false);

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

  const frozenLeft = (colId: string): number => {
    if (colId === "date") return 0;
    if (colId === "time") return colWidths["date"] ?? 72;
    return 0;
  };

  const visibleGroupDefs = GROUP_DEFS.map(gd => ({
    ...gd,
    span: gd.ids.filter(id => cols.some(c => c.id === id)).length,
  })).filter(gd => gd.span > 0);

  const thBase: React.CSSProperties = {
    border: "1px solid #BDC4CF",
    padding: "2px 6px",
    fontFamily: "'Calibri','Segoe UI',system-ui,sans-serif",
    fontSize: 10,
    fontWeight: 600,
    whiteSpace: "nowrap",
    userSelect: "none",
    position: "sticky",
    top: 0,
    zIndex: 4,
    background: "#F3F6FA",
    color: "#1A2533",
    textAlign: "center",
  };

  const tdBase: React.CSSProperties = {
    border: "1px solid #BDC4CF",
    padding: "2px 6px",
    fontFamily: "'Calibri','Segoe UI',system-ui,sans-serif",
    fontSize: 11,
    whiteSpace: "nowrap",
    userSelect: "none",
    textAlign: "center",
    height: 22,
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
              <th key={gd.label} colSpan={gd.span} style={{ ...thBase, top: 0 }}>{gd.label}</th>
            ))}</tr>
            <tr>{cols.map(c => (
              <th key={c.id} style={{ ...thBase, top: 24 }}>{c.sub}</th>
            ))}</tr>
          </thead>
          <tbody>
            {Array.from({ length: 5 }).map((_, ri) => (
              <tr key={ri}>
                {cols.map(c => {
                  const cs = cellStyle(c.id);
                  return (
                    <td key={c.id} style={{ ...tdBase, background: cs.bg }}>
                      <span style={SHIMMER_STYLE} />
                    </td>
                  );
                })}
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
        <div style={{ textAlign: "center", color: "#9CA3AF" }}>
          <div style={{ fontSize: 36, marginBottom: 12, opacity: 0.3 }}>📊</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#1A2533", marginBottom: 6 }}>No data yet</div>
          <div style={{ fontSize: 13, color: "#5B6B7F" }}>Configure your selection above and press <strong>Generate</strong></div>
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

      <div style={{ flex: 1, overflow: "auto", background: "#FFFFFF" }}>
        <table style={{ borderCollapse: "collapse", tableLayout: "fixed", width: totalW, minWidth: "100%" }}>
          <colgroup>
            {cols.map(c => <col key={c.id} style={{ width: colWidths[c.id] ?? c.defaultW }} />)}
          </colgroup>

          <thead>
            {/* ── Group header row (uniform style, no section colors) ── */}
            <tr>
              {visibleGroupDefs.map((gd) => (
                <th
                  key={gd.label + gd.ids.join()}
                  colSpan={gd.span}
                  style={{
                    ...thBase,
                    top: 0,
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.05em",
                    boxShadow: "0 1px 0 #555555",
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
                return (
                  <th
                    key={c.id}
                    style={{
                      ...thBase,
                      top: 24,
                      position: "sticky",
                      zIndex: isFrozen ? 6 : 4,
                      ...(isFrozen ? { left: frozenLeft(c.id) } : {}),
                      cursor: "default",
                    }}
                  >
                    {c.sub}
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
              const pp = (seg: "call" | "put") => pivotMethod === "client"
                ? (seg === "call" ? row.callPP : row.putPP)
                : (seg === "call" ? row.callPPClassic : row.putPPClassic);

              return (
                <tr
                  key={row.t}
                  className="ws-row"
                  onMouseEnter={() => setHoveredRow(ri)}
                  onMouseLeave={() => setHoveredRow(null)}
                >
                  {cols.map((c, ci) => {
                    const isFrozen = !!c.frozen;
                    const isInSel  = selRange !== null
                      && ri >= selRange.r1 && ri <= selRange.r2
                      && ci >= selRange.c1 && ci <= selRange.c2;

                    // Cell style: rating is dynamic, all others are per-column
                    const cs = c.id === "rating"
                      ? ratingStyle(row.rating.label)
                      : cellStyle(c.id);

                    const textColor = cs.textColor;

                    // Cell value
                    let val: string;
                    if (c.id === "call-pp") val = p0(pp("call"));
                    else if (c.id === "put-pp") val = p0(pp("put"));
                    else val = getCellValue(row, c.id, pivotMethod);

                    return (
                      <td
                        key={c.id}
                        style={{
                          ...tdBase,
                          background: isInSel ? "rgba(31,111,235,0.45)" : cs.bg,
                          outline: isInSel ? "1px solid #1F6FEB" : "none",
                          outlineOffset: "-1px",
                          textAlign: (c.align ?? "center") as "left" | "right" | "center",
                          color: textColor,
                          fontWeight: (cs as { bold?: boolean }).bold ? 700 : 400,
                          position: isFrozen ? "sticky" : "relative",
                          left:   isFrozen ? frozenLeft(c.id) : undefined,
                          zIndex: isFrozen ? 2 : undefined,
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
                        {val}
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
        flexShrink: 0, padding: "3px 12px",
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
