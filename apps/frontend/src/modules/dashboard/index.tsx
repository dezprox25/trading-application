import { useEffect, useState } from "react";
import { useDashStore } from "./store";
import { ConfigRow } from "./ConfigRow";
import { TimeframeRow } from "./TimeframeRow";
import { Worksheet } from "./Worksheet";
import { mockFeed } from "../../data/mock";
import type { DashboardRow } from "../../calc";

// ── InfoBar ───────────────────────────────────────────────────────────────────

function InfoBar() {
  const { spotLtp, futureLtp, spotDir, futureDir, pivotMethod, setPivotMethod } = useDashStore();

  const p2 = (n: number | null) =>
    n == null ? "—" : n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const DirArrow = ({ dir }: { dir: "up" | "down" | null }) =>
    dir === "up"   ? <span style={{ color: "#4ade80", marginLeft: 2 }}>▲</span> :
    dir === "down" ? <span style={{ color: "#f87171", marginLeft: 2 }}>▼</span> : null;

  const tickerStyle: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 4,
    padding: "0 14px", borderLeft: "1px solid rgba(255,255,255,0.1)",
    fontFamily: "'Calibri','Segoe UI',system-ui,sans-serif",
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.5)",
    textTransform: "uppercase", letterSpacing: "0.1em",
  };
  const valueStyle: React.CSSProperties = {
    fontSize: 13, fontWeight: 700, color: "#f1f5f9",
  };

  return (
    <div style={{
      height: 36, flexShrink: 0,
      background: "#0F2744",
      display: "flex", alignItems: "center",
      borderBottom: "1px solid rgba(255,255,255,0.08)",
      userSelect: "none",
    }}>
      {/* Brand */}
      <div style={{
        padding: "0 16px",
        fontFamily: "'Calibri','Segoe UI',system-ui,sans-serif",
        fontSize: 13, fontWeight: 800, color: "#f1f5f9",
        letterSpacing: "0.04em", whiteSpace: "nowrap",
      }}>
        ◆ SYNERGY <span style={{ opacity: 0.4 }}>·</span> Trading Dashboard
      </div>

      {/* SPOT */}
      <div style={tickerStyle}>
        <span style={labelStyle}>SPOT</span>
        <span style={valueStyle}>{p2(spotLtp)}</span>
        <DirArrow dir={spotDir} />
      </div>

      {/* FUT */}
      <div style={tickerStyle}>
        <span style={labelStyle}>FUT</span>
        <span style={valueStyle}>{p2(futureLtp)}</span>
        <DirArrow dir={futureDir} />
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* PP method toggle */}
      <div style={{
        display: "flex", alignItems: "center", gap: 3,
        padding: "0 14px", borderLeft: "1px solid rgba(255,255,255,0.1)",
      }}>
        <span style={{ ...labelStyle, marginRight: 6 }}>PP</span>
        {(["client", "classic"] as const).map(m => (
          <button
            key={m}
            onClick={() => setPivotMethod(m)}
            style={{
              fontFamily: "'Calibri','Segoe UI',system-ui,sans-serif",
              fontSize: 10, fontWeight: 700,
              padding: "2px 8px", borderRadius: 2,
              border: "1px solid rgba(255,255,255,0.2)",
              background: pivotMethod === m ? "#2E75B6" : "transparent",
              color: pivotMethod === m ? "#fff" : "rgba(255,255,255,0.5)",
              cursor: "pointer", letterSpacing: "0.05em",
              textTransform: "capitalize",
            }}
          >
            {m === "client" ? "4-Bar" : "Classic"}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Dashboard ────────────────────────────────────────────────────────────────

export function Dashboard() {
  const {
    isGenerated,
    rows, appendRow, updateLatestRow,
    setFeedStatus, feedStatus,
    setLivePrices,
    pivotMethod, hiddenCols,
  } = useDashStore();

  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isGenerated) {
      mockFeed.stop();
      setFeedStatus("idle");
      return;
    }

    setIsLoading(true);

    // Small delay to let the UI paint the skeleton state
    const seedTimer = setTimeout(() => {
      const history = mockFeed.generateHistory(14);
      history.forEach(row => appendRow(row));
      setIsLoading(false);
      setFeedStatus("live");

      mockFeed.start(
        // New bar callback
        (row: DashboardRow) => {
          appendRow(row);
          setLivePrices(row.spotLtp, row.futureLtp);
        },
        // Tick update callback
        (partial) => {
          updateLatestRow(partial as Partial<DashboardRow>);
          if (partial.spotLtp != null && partial.futureLtp != null) {
            setLivePrices(partial.spotLtp, partial.futureLtp);
          }
        },
      );
    }, 400);

    return () => {
      clearTimeout(seedTimer);
      mockFeed.stop();
      setFeedStatus("idle");
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGenerated]);

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      height: "100%", width: "100%",
      background: "#FFFFFF",
      fontFamily: "'Calibri','Segoe UI',system-ui,sans-serif",
      overflow: "hidden",
    }}>
      <InfoBar />
      <ConfigRow />
      <TimeframeRow />
      <Worksheet
        rows={rows}
        pivotMethod={pivotMethod}
        hiddenCols={hiddenCols}
        feedStatus={feedStatus}
        isLoading={isLoading}
      />
    </div>
  );
}

export default Dashboard;
