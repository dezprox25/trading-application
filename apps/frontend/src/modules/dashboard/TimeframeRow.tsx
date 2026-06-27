import { useState, useRef, useEffect } from "react";
import { useDashStore } from "./store";

const TFS_MIN = ["1m", "2m", "3m", "5m", "10m", "15m", "30m", "45m"];
const TFS_HR  = ["1h", "2h", "3h", "4h"];

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

// Candle interval options available inside Custom mode
const CUSTOM_CANDLE_TFS = ["1m", "2m", "3m", "5m", "10m", "15m", "30m", "45m", "1h", "2h", "3h", "4h"];

// Convert a local datetime-local string (YYYY-MM-DDTHH:mm) to a UTC ISO string.
// The browser datetime-local input is in local time; backend expects UTC.
function localToUtcIso(localDt: string): string {
  if (!localDt) return "";
  return new Date(localDt).toISOString();
}

// Returns today's date string in YYYY-MM-DD format (local time).
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Returns the IST market open time string for a date, as a datetime-local value.
// 9:15 AM IST = 03:45 UTC, but datetime-local needs LOCAL time — so just hardcode 09:15 as a
// convenience default; the user can adjust it.
function marketOpenDefault(date: string): string {
  return `${date}T09:15`;
}

function marketCloseDefault(date: string): string {
  return `${date}T15:30`;
}

export function TimeframeRow() {
  const {
    timeframe, setTimeframe, customRange, setCustomRange,
    feedStatus, hiddenCols, toggleColumn,
  } = useDashStore();

  const [colsOpen, setColsOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  // Custom range panel local state
  const today = todayStr();
  const [fromDt,    setFromDt]    = useState(marketOpenDefault(today));
  const [toDt,      setToDt]      = useState(marketCloseDefault(today));
  const [candleTf,  setCandleTf]  = useState("5m");
  const [rangeError, setRangeError] = useState<string | null>(null);

  // Close column popover when clicking outside
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

  const statusColor =
    feedStatus === "live"          ? "#2E9E4F" :
    feedStatus === "interrupted"   ? "#D97706" :
    feedStatus === "connecting"    ? "#2E75B6" :
    feedStatus === "market-closed" ? "#5B6B7F" :
    feedStatus === "auth-error"    ? "#D97706" :
    feedStatus === "api-error"     ? "#DC2626" :
    feedStatus === "no-network"    ? "#DC2626" : "#8A93A3";

  const statusLabel =
    feedStatus === "live"          ? "Live"            :
    feedStatus === "interrupted"   ? "Interrupted"     :
    feedStatus === "connecting"    ? "Connecting"      :
    feedStatus === "market-closed" ? "Market Closed"   :
    feedStatus === "auth-error"    ? "Auth Required"   :
    feedStatus === "api-error"     ? "API Error"       :
    feedStatus === "no-network"    ? "Connection Lost" : "Idle";

  function handleApplyCustomRange() {
    setRangeError(null);
    if (!fromDt || !toDt) {
      setRangeError("Please fill in both start and end date/time.");
      return;
    }
    const from = new Date(fromDt);
    const to   = new Date(toDt);
    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      setRangeError("Invalid date/time.");
      return;
    }
    if (from >= to) {
      setRangeError("Start must be before end.");
      return;
    }
    setCustomRange({ from: localToUtcIso(fromDt), to: localToUtcIso(toDt), candleTf });
  }

  function handleClearCustomRange() {
    setCustomRange(null);
    setTimeframe("5m");
  }

  const inputStyle: React.CSSProperties = {
    fontFamily: "'Calibri','Segoe UI',system-ui,sans-serif",
    fontSize: 11, padding: "2px 6px",
    border: "1px solid #BDC4CF", borderRadius: 3,
    background: "#fff", color: "#1A2533",
    outline: "none",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, color: "#5B6B7F",
    textTransform: "uppercase", letterSpacing: "0.06em",
    whiteSpace: "nowrap",
  };

  return (
    <div style={{ borderBottom: "1px solid #BDC4CF", flexShrink: 0 }}>

      {/* ── Main pill row ───────────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 4,
        padding: "5px 12px",
        background: "#FFFFFF",
        flexWrap: "wrap",
      }}>

        {/* Minute pills */}
        {TFS_MIN.map(tf => (
          <button
            key={tf}
            style={pillStyle(timeframe === tf && timeframe !== "custom")}
            onClick={() => { setTimeframe(tf); setCustomRange(null); }}
          >
            {tf}
          </button>
        ))}

        {/* Divider */}
        <div style={{ width: 1, height: 18, background: "#BDC4CF", margin: "0 4px" }} />

        {/* Hour pills */}
        {TFS_HR.map(tf => (
          <button
            key={tf}
            style={pillStyle(timeframe === tf && timeframe !== "custom")}
            onClick={() => { setTimeframe(tf); setCustomRange(null); }}
          >
            {tf}
          </button>
        ))}

        {/* Divider */}
        <div style={{ width: 1, height: 18, background: "#BDC4CF", margin: "0 4px" }} />

        {/* Custom button */}
        <button
          style={pillStyle(timeframe === "custom")}
          onClick={() => setTimeframe("custom")}
        >
          📅 Custom
        </button>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Feed status indicator */}
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
              <div style={{
                padding: "4px 12px 8px", fontSize: 9, fontWeight: 700,
                color: "#5B6B7F", textTransform: "uppercase",
                letterSpacing: "0.1em", borderBottom: "1px solid #EBF3FA",
              }}>
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

      {/* ── Custom date range panel (shown only when Custom is selected) ── */}
      {timeframe === "custom" && (
        <div style={{
          display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10,
          padding: "6px 12px",
          background: "#F3F6FA",
          borderTop: "1px solid #BDC4CF",
        }}>

          {/* Candle interval inside custom */}
          <span style={labelStyle}>Interval</span>
          <select
            value={candleTf}
            onChange={e => setCandleTf(e.target.value)}
            style={{ ...inputStyle, cursor: "pointer" }}
          >
            {CUSTOM_CANDLE_TFS.map(tf => (
              <option key={tf} value={tf}>{tf}</option>
            ))}
          </select>

          <div style={{ width: 1, height: 18, background: "#BDC4CF" }} />

          {/* Start datetime */}
          <span style={labelStyle}>From</span>
          <input
            type="datetime-local"
            value={fromDt}
            onChange={e => setFromDt(e.target.value)}
            style={inputStyle}
          />

          {/* End datetime */}
          <span style={labelStyle}>To</span>
          <input
            type="datetime-local"
            value={toDt}
            onChange={e => setToDt(e.target.value)}
            style={inputStyle}
          />

          {/* Apply button */}
          <button
            onClick={handleApplyCustomRange}
            style={{
              fontFamily: "'Calibri','Segoe UI',system-ui,sans-serif",
              fontSize: 11, fontWeight: 700,
              padding: "3px 14px", borderRadius: 3,
              border: "1px solid #2E75B6", background: "#2E75B6",
              color: "#fff", cursor: "pointer",
            }}
          >
            Apply
          </button>

          {/* Clear / back to live */}
          <button
            onClick={handleClearCustomRange}
            style={{
              fontFamily: "'Calibri','Segoe UI',system-ui,sans-serif",
              fontSize: 11, fontWeight: 700,
              padding: "3px 10px", borderRadius: 3,
              border: "1px solid #BDC4CF", background: "#fff",
              color: "#5B6B7F", cursor: "pointer",
            }}
          >
            ✕ Clear
          </button>

          {/* Active range summary */}
          {customRange && (
            <span style={{ fontSize: 11, color: "#2E75B6", fontWeight: 600 }}>
              {new Date(customRange.from).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "short", timeStyle: "short" })}
              {" — "}
              {new Date(customRange.to).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "short", timeStyle: "short" })}
              {" · "}{customRange.candleTf}
            </span>
          )}

          {/* Validation error */}
          {rangeError && (
            <span style={{ fontSize: 11, color: "#DC2626", fontWeight: 600 }}>{rangeError}</span>
          )}
        </div>
      )}
    </div>
  );
}

export default TimeframeRow;
