import { useState, useRef, useEffect } from "react";
import { useDashStore } from "./store";

const TFS_MIN = ["1m", "2m", "3m", "5m", "10m", "15m", "30m", "45m"];
const TFS_HR  = ["1h", "2h", "3h", "4h"];

// All column IDs (must match Worksheet COLS order)
const ALL_COL_IDS = [
  "date","time",
  "ce-o","ce-h","ce-l","ce-c","call-pp",
  "pe-o","pe-h","pe-l","pe-c","put-pp",
  "future","spot","rating",
  "mma-c","mma-p","tla-c","tla-p",
  "smc","fib","rsi",
];

const ALL_COL_LABELS: Record<string, string> = {
  date:"Date", time:"Time",
  "ce-o":"CE Open","ce-h":"CE High","ce-l":"CE Low","ce-c":"CE Close","call-pp":"Call PP",
  "pe-o":"PE Open","pe-h":"PE High","pe-l":"PE Low","pe-c":"PE Close","put-pp":"Put PP",
  future:"Future", spot:"Spot", rating:"Rating",
  "mma-c":"MMA Call","mma-p":"MMA Put","tla-c":"TLA Call","tla-p":"TLA Put",
  smc:"SMC", fib:"Fib", rsi:"RSI(14)",
};

export function TimeframeRow() {
  const { timeframe, setTimeframe, feedStatus, hiddenCols, toggleColumn } = useDashStore();
  const [colsOpen, setColsOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  // Close popover when clicking outside
  useEffect(() => {
    if (!colsOpen) return;
    const handler = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setColsOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [colsOpen]);

  const pillStyle = (active: boolean): React.CSSProperties => ({
    fontFamily: "'Calibri','Segoe UI',system-ui,sans-serif",
    fontSize: 11, fontWeight: 700,
    padding: "3px 10px", borderRadius: 3,
    border: `1px solid ${active ? "#2E75B6" : "#BDC4CF"}`,
    background: active ? "#2E75B6" : "transparent",
    color: active ? "#fff" : "#1A2533",
    cursor: "pointer", transition: "all 0.1s",
    whiteSpace: "nowrap" as const,
  });

  const statusColor = feedStatus === "live" ? "#2E9E4F" : feedStatus === "interrupted" ? "#D97706" : "#8A93A3";
  const statusLabel = feedStatus === "live" ? "Live" : feedStatus === "interrupted" ? "Interrupted" : "Idle";

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 4,
      padding: "5px 12px",
      background: "#FFFFFF", borderBottom: "1px solid #BDC4CF",
      flexShrink: 0, flexWrap: "wrap",
    }}>

      {/* Minute pills */}
      {TFS_MIN.map(tf => (
        <button key={tf} style={pillStyle(timeframe === tf)} onClick={() => setTimeframe(tf)}>
          {tf}
        </button>
      ))}

      {/* Divider */}
      <div style={{ width: 1, height: 18, background: "#BDC4CF", margin: "0 4px" }} />

      {/* Hour pills */}
      {TFS_HR.map(tf => (
        <button key={tf} style={pillStyle(timeframe === tf)} onClick={() => setTimeframe(tf)}>
          {tf}
        </button>
      ))}

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Feed status */}
      <div style={{ display: "flex", alignItems: "center", gap: 5, marginRight: 12 }}>
        <span style={{
          width: 7, height: 7, borderRadius: "50%", background: statusColor,
          boxShadow: feedStatus === "live" ? `0 0 0 2px ${statusColor}40` : "none",
          display: "inline-block",
        }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: statusColor }}>{statusLabel}</span>
      </div>

      {/* Columns button + popover */}
      <div style={{ position: "relative" }} ref={popRef}>
        <button
          onClick={() => setColsOpen(o => !o)}
          style={{
            fontFamily: "'Calibri','Segoe UI',system-ui,sans-serif",
            fontSize: 11, fontWeight: 700,
            padding: "3px 10px", borderRadius: 3,
            border: "1px solid #BDC4CF", background: colsOpen ? "#EBF3FA" : "#fff",
            color: "#1A2533", cursor: "pointer",
          }}
        >
          ⛶ Columns
        </button>

        {colsOpen && (
          <div style={{
            position: "absolute", right: 0, top: "calc(100% + 4px)",
            background: "#fff", border: "1px solid #BDC4CF",
            borderRadius: 4, boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
            zIndex: 100, minWidth: 180, padding: "8px 0",
            maxHeight: 360, overflowY: "auto",
          }}>
            <div style={{ padding: "4px 12px 8px", fontSize: 9, fontWeight: 700, color: "#5B6B7F", textTransform: "uppercase", letterSpacing: "0.1em", borderBottom: "1px solid #EBF3FA" }}>
              Show / Hide Columns
            </div>
            {ALL_COL_IDS.map(id => (
              <label
                key={id}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "4px 12px", cursor: "pointer",
                  fontSize: 12, color: "#1A2533",
                  background: hiddenCols.includes(id) ? "#FBF7F0" : "transparent",
                }}
              >
                <input
                  type="checkbox"
                  checked={!hiddenCols.includes(id)}
                  onChange={() => toggleColumn(id)}
                  style={{ accentColor: "#2E75B6" }}
                />
                {ALL_COL_LABELS[id] ?? id}
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default TimeframeRow;
