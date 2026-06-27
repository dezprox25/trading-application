import { useEffect, useRef, useState } from "react";
import { useDashStore } from "./store";
import type { FeedStatus } from "./store";
import { ConfigRow } from "./ConfigRow";
import { TimeframeRow } from "./TimeframeRow";
import { Worksheet } from "./Worksheet";
import { useStore } from "../../store/useStore";
import type { OiSignal } from "../../store/useStore";
import { api } from "../../utils/api";
import type { OHLCBar, DashboardRow } from "../../calc";
import {
  clientPivot4Bar, classicPivot, mma, tla,
  computeRsiSeries, nearestFibLabel, smcNearest, aggregateRating,
} from "../../calc";

// ── Helpers ───────────────────────────────────────────────────────────────────

function tfToMs(tf: string): number {
  if (tf.endsWith("h")) return parseInt(tf, 10) * 60 * 60 * 1000;
  if (tf.endsWith("m")) return parseInt(tf, 10) * 60 * 1000;
  return 5 * 60 * 1000;
}

function oiSignalToVote(signal: OiSignal): number {
  switch (signal) {
    case "STRONG_BULL":  return  1.0;
    case "MILD_BULL":    return  0.4;
    case "NEUTRAL":      return  0.0;
    case "MILD_BEAR":    return -0.4;
    case "STRONG_BEAR":  return -1.0;
    case "DIVERGENCE":   return  0.0;
  }
}

// Normalise a backend OHLC record to the internal OHLCBar shape.
// Backend sends: { openTime, open, high, low, close }
// OHLCBar needs: { t, o, h, l, c }
function normalizeBar(raw: any): OHLCBar | null {
  if (!raw || typeof raw !== "object") return null;
  const t =
    raw.t         != null ? Number(raw.t)                        :
    raw.openTime  != null ? Number(raw.openTime)                 :
    raw.timestamp != null ? new Date(raw.timestamp).getTime()    : null;
  const o = raw.o ?? raw.open;
  const h = raw.h ?? raw.high;
  const l = raw.l ?? raw.low;
  const c = raw.c ?? raw.close;
  if (t == null || o == null || h == null || l == null || c == null) return null;
  if (!Number.isFinite(t) || !Number.isFinite(+o) || !Number.isFinite(+h) ||
      !Number.isFinite(+l) || !Number.isFinite(+c)) return null;
  return { t, o: +o, h: +h, l: +l, c: +c };
}

interface ActiveBar {
  callO: number; callH: number; callL: number; callC: number;
  putO:  number; putH:  number; putL:  number; putC:  number;
  windowStart: number;
}

// ── StatusPanel ───────────────────────────────────────────────────────────────

const STATUS_CONFIGS: Partial<Record<FeedStatus | "custom-pending", {
  icon: string; title: string; message: string; color: string; showRetry?: boolean;
}>> = {
  "connecting": {
    icon: "⟳",
    title: "Connecting…",
    message: "Establishing connection to the market data feed.",
    color: "#2E75B6",
  },
  "reconnecting": {
    icon: "⟳",
    title: "Reconnecting…",
    message: "Connection lost. Attempting to reconnect to the broker automatically.",
    color: "#D97706",
  },
  "market-closed": {
    icon: "◷",
    title: "Market Closed",
    message: "The market is currently closed. Trading hours: Monday – Friday, 9:00 AM – 3:45 PM IST.",
    color: "#5B6B7F",
  },
  "auth-error": {
    icon: "⊙",
    title: "Authentication Required",
    message: "Please authenticate with your broker to access live market data.",
    color: "#D97706",
  },
  "broker-disconnected": {
    icon: "⊘",
    title: "Broker Disconnected",
    message: "Unable to connect to the broker. Please re-authenticate with your broker credentials.",
    color: "#DC2626",
    showRetry: true,
  },
  "session-expired": {
    icon: "⊙",
    title: "Broker Session Expired",
    message: "Your broker session has expired. Please go to the login panel and reconnect.",
    color: "#D97706",
  },
  "api-error": {
    icon: "⚠",
    title: "API Error",
    message: "Unable to retrieve live market data. Please check your connection and try again.",
    color: "#DC2626",
    showRetry: true,
  },
  "no-network": {
    icon: "⊘",
    title: "No Internet Connection",
    message: "Internet connection lost. Reconnecting…",
    color: "#DC2626",
    showRetry: true,
  },
  "custom-pending": {
    icon: "📅",
    title: "Select a Date Range",
    message: "Choose a start and end date in the toolbar above, then click Apply.",
    color: "#5B6B7F",
  },
};

function StatusPanel({ status, onRetry }: { status: string; onRetry?: () => void }) {
  const cfg = STATUS_CONFIGS[status as keyof typeof STATUS_CONFIGS];
  if (!cfg) return null;
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", flex: 1, padding: 48, textAlign: "center",
      background: "#FFFFFF",
    }}>
      <div style={{ fontSize: 48, marginBottom: 16, color: cfg.color, lineHeight: 1 }}>
        {cfg.icon}
      </div>
      <div style={{
        fontSize: 16, fontWeight: 700, color: "#1A2533", marginBottom: 10,
        fontFamily: "'Calibri','Segoe UI',system-ui,sans-serif",
      }}>
        {cfg.title}
      </div>
      <div style={{
        fontSize: 13, color: "#5B6B7F", maxWidth: 420, lineHeight: 1.65,
        marginBottom: cfg.showRetry ? 24 : 0,
        fontFamily: "'Calibri','Segoe UI',system-ui,sans-serif",
      }}>
        {cfg.message}
      </div>
      {cfg.showRetry && onRetry && (
        <button
          onClick={onRetry}
          style={{
            fontFamily: "'Calibri','Segoe UI',system-ui,sans-serif",
            fontSize: 13, fontWeight: 600,
            padding: "8px 24px", borderRadius: 4,
            border: "1px solid #2E75B6", background: "#2E75B6",
            color: "#fff", cursor: "pointer",
          }}
        >
          Retry
        </button>
      )}
    </div>
  );
}

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
      <div style={{
        padding: "0 16px",
        fontFamily: "'Calibri','Segoe UI',system-ui,sans-serif",
        fontSize: 13, fontWeight: 800, color: "#f1f5f9",
        letterSpacing: "0.04em", whiteSpace: "nowrap",
      }}>
        ◆ SYNERGY <span style={{ opacity: 0.4 }}>·</span> Trading Dashboard
      </div>

      <div style={tickerStyle}>
        <span style={labelStyle}>SPOT</span>
        <span style={valueStyle}>{p2(spotLtp)}</span>
        <DirArrow dir={spotDir} />
      </div>

      <div style={tickerStyle}>
        <span style={labelStyle}>FUT</span>
        <span style={valueStyle}>{p2(futureLtp)}</span>
        <DirArrow dir={futureDir} />
      </div>

      <div style={{ flex: 1 }} />

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
    isGenerated, symbol, timeframe, customRange,
    rows, appendRow, clearRows,
    setFeedStatus, feedStatus,
    setLivePrices,
    pivotMethod, hiddenCols,
  } = useDashStore();

  const [isLoading, setIsLoading] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  const barRef        = useRef<ActiveBar | null>(null);
  const prevRsiCloses = useRef<number[]>([]);
  const swHighRef     = useRef<number>(0);
  const swLowRef      = useRef<number>(Infinity);

  // Effect 1: fetch history and set feed status whenever config changes
  useEffect(() => {
    if (!isGenerated) {
      clearRows();
      setFeedStatus("idle");
      barRef.current = null;
      prevRsiCloses.current = [];
      return;
    }

    // Custom mode but range not yet set
    if (timeframe === "custom" && !customRange) {
      clearRows();
      setFeedStatus("live"); // live status so the status panel shows "custom-pending"
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    barRef.current = null;
    prevRsiCloses.current = [];

    async function init() {
      clearRows();
      setIsLoading(true);
      setFeedStatus("connecting");

      try {
        // 1. Market status check (skip for custom historical range — market may be closed)
        if (timeframe !== "custom") {
          const status = await api.get("/api/market/status");
          if (cancelled) return;

          if (status?.status === "CLOSED") {
            setFeedStatus("market-closed");
            setIsLoading(false);
            return;
          }

          if (!status?.zebuConnected) {
            const m1Status = useStore.getState().module1Status;
            setFeedStatus(m1Status === "authenticated" ? "api-error" : "auth-error");
            setIsLoading(false);
            return;
          }
        }

        // 2. Build the OHLC URL
        const instrument = (symbol.split(" ")[0] ?? "NIFTY").toUpperCase();
        const futSym = `${instrument}-FUT`;
        let url: string;

        if (timeframe === "custom" && customRange) {
          // Custom date range — use historical endpoint with candleTf interval
          url = `/api/market/ohlc-history/${futSym}/${customRange.candleTf}?from=${encodeURIComponent(customRange.from)}&to=${encodeURIComponent(customRange.to)}`;
        } else {
          // Normal mode — latest bars
          url = `/api/market/ohlc/${futSym}/${timeframe}`;
        }

        // 3. Fetch OHLC data
        let bars: OHLCBar[] = [];
        try {
          const raw = await api.get(url);
          if (!cancelled && Array.isArray(raw)) {
            bars = raw.map(normalizeBar).filter(Boolean) as OHLCBar[];
          }
        } catch {
          // OHLC history unavailable — proceed with live-only feed
        }

        if (cancelled) return;

        // 4. Build and append historical rows
        if (bars.length > 0) {
          const closes  = bars.map(b => b.c);
          const rsiSeries = computeRsiSeries(closes);

          let sessionHigh = bars[0].h;
          let sessionLow  = bars[0].l;
          let prevH = bars[0].h;
          let prevL = bars[0].l;

          bars.forEach((bar, i) => {
            if (i > 0) {
              sessionHigh = Math.max(sessionHigh, bar.h);
              sessionLow  = Math.min(sessionLow,  bar.l);
            }

            const pdh = i === 0 ? bar.h : prevH;
            const pdl = i === 0 ? bar.l : prevL;

            const callPP = clientPivot4Bar(bar).pp;
            const putPP  = clientPivot4Bar(bar).pp;

            const row: DashboardRow = {
              t: bar.t,
              call: bar,
              put:  bar,
              futureLtp: bar.c,
              spotLtp:   bar.c,
              callPP, putPP,
              callPPClassic: classicPivot(bar).pp,
              putPPClassic:  classicPivot(bar).pp,
              callMMA: mma(callPP, bar.h),
              callTLA: tla(callPP, bar.l),
              putMMA:  mma(putPP,  bar.h),
              putTLA:  tla(putPP,  bar.l),
              smc: smcNearest(bar.c, sessionHigh, sessionLow, pdh, pdl),
              fib: nearestFibLabel(bar.c, sessionHigh, sessionLow) ?? "—",
              rsi: rsiSeries[i] ?? null,
              rating: aggregateRating([]),
            };
            appendRow(row);

            prevH = bar.h;
            prevL = bar.l;
          });

          prevRsiCloses.current = closes.slice(-50);
          swHighRef.current = bars[bars.length - 1].h;
          swLowRef.current  = bars[bars.length - 1].l;

          // Seed InfoBar live prices from last historical close
          const last = bars[bars.length - 1];
          setLivePrices(last.c, last.c);

          // Prime barRef with the current window if the last historical bar is still active.
          // This prevents the live OI poller from appending a duplicate row for the same window.
          const now         = Date.now();
          const activeTf    = timeframe === "custom" ? (customRange?.candleTf ?? "5m") : timeframe;
          const tfMs        = tfToMs(activeTf);
          const windowStart = Math.floor(now / tfMs) * tfMs;
          if (last.t === windowStart) {
            barRef.current = {
              callO: last.o, callH: last.h, callL: last.l, callC: last.c,
              putO:  last.o, putH:  last.h, putL:  last.l, putC:  last.c,
              windowStart,
            };
          }
        }

        setIsLoading(false);
        setFeedStatus("live");

      } catch (err: unknown) {
        if (cancelled) return;
        const msg = (err as any)?.message?.toLowerCase() ?? "";
        const isNetworkError = !navigator.onLine ||
          msg.includes("failed to fetch") ||
          msg.includes("networkerror") ||
          msg.includes("internet connection");
        const isTimeout = msg.includes("timed out");
        setFeedStatus(isNetworkError || isTimeout ? "no-network" : "api-error");
        setIsLoading(false);
      }
    }

    init();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGenerated, symbol, timeframe, customRange, retryKey]);

  // Effect 2: 500ms live OI polling — builds and updates the active bar.
  // Skipped entirely in custom historical mode (no live stream needed).
  useEffect(() => {
    if (!isGenerated || timeframe === "custom") return;

    const tfMs = tfToMs(timeframe);

    const timer = setInterval(() => {
      const dash = useDashStore.getState();
      if (dash.feedStatus !== "live") return;

      const { oiMetrics: oi, prices } = useStore.getState();
      if (!oi) return;

      const now         = Date.now();
      const windowStart = Math.floor(now / tfMs) * tfMs;

      const futLtp  = prices["NIFTY-FUT"]?.ltp;
      const spotLtp = prices["NIFTY-SPOT"]?.ltp;

      if (!barRef.current || barRef.current.windowStart !== windowStart) {
        // New window — archive previous bar's close to RSI history
        if (barRef.current) {
          prevRsiCloses.current = [...prevRsiCloses.current, barRef.current.callC].slice(-50);
          swHighRef.current = Math.max(swHighRef.current, barRef.current.callH);
          swLowRef.current  = Math.min(swLowRef.current,  barRef.current.callL);
        }

        barRef.current = {
          callO: oi.c_tl, callH: oi.c_tl, callL: oi.c_tl, callC: oi.c_tl,
          putO:  oi.p_tl, putH:  oi.p_tl, putL:  oi.p_tl, putC:  oi.p_tl,
          windowStart,
        };

        const callBar: OHLCBar = { t: windowStart, o: oi.c_tl, h: oi.c_tl, l: oi.c_tl, c: oi.c_tl };
        const putBar:  OHLCBar = { t: windowStart, o: oi.p_tl, h: oi.p_tl, l: oi.p_tl, c: oi.p_tl };
        const callPP = clientPivot4Bar(callBar).pp;
        const putPP  = clientPivot4Bar(putBar).pp;
        const fLtp   = futLtp  ?? callBar.c;
        const sLtp   = spotLtp ?? callBar.c;
        const rsiSer = computeRsiSeries([...prevRsiCloses.current, callBar.c]);
        const rsi    = rsiSer[rsiSer.length - 1] ?? null;

        dash.appendRow({
          t: windowStart,
          call: callBar, put: putBar,
          futureLtp: fLtp, spotLtp: sLtp,
          callPP, putPP,
          callPPClassic: classicPivot(callBar).pp,
          putPPClassic:  classicPivot(putBar).pp,
          callMMA: mma(callPP, callBar.h),
          callTLA: tla(callPP, callBar.l),
          putMMA:  mma(putPP,  putBar.h),
          putTLA:  tla(putPP,  putBar.l),
          smc: smcNearest(fLtp, swHighRef.current, swLowRef.current, swHighRef.current, swLowRef.current),
          fib: nearestFibLabel(fLtp, swHighRef.current, swLowRef.current) ?? "—",
          rsi,
          rating: aggregateRating([oiSignalToVote(oi.callSignal), oiSignalToVote(oi.putSignal)]),
        });

      } else {
        // Same window — update the active bar in place
        const b = barRef.current;
        b.callH = Math.max(b.callH, oi.c_tl);
        b.callL = Math.min(b.callL, oi.c_tl);
        b.callC = oi.c_tl;
        b.putH  = Math.max(b.putH,  oi.p_tl);
        b.putL  = Math.min(b.putL,  oi.p_tl);
        b.putC  = oi.p_tl;

        const callBar: OHLCBar = { t: b.windowStart, o: b.callO, h: b.callH, l: b.callL, c: b.callC };
        const putBar:  OHLCBar = { t: b.windowStart, o: b.putO,  h: b.putH,  l: b.putL,  c: b.putC  };
        const callPP = clientPivot4Bar(callBar).pp;
        const putPP  = clientPivot4Bar(putBar).pp;
        const fLtp   = futLtp  ?? callBar.c;
        const sLtp   = spotLtp ?? callBar.c;
        const rsiSer = computeRsiSeries([...prevRsiCloses.current, callBar.c]);
        const rsi    = rsiSer[rsiSer.length - 1] ?? null;

        dash.updateLatestRow({
          call: callBar, put: putBar,
          callPP, putPP,
          callPPClassic: classicPivot(callBar).pp,
          putPPClassic:  classicPivot(putBar).pp,
          callMMA: mma(callPP, callBar.h),
          callTLA: tla(callPP, callBar.l),
          putMMA:  mma(putPP,  putBar.h),
          putTLA:  tla(putPP,  putBar.l),
          futureLtp: fLtp, spotLtp: sLtp,
          smc: smcNearest(fLtp, swHighRef.current, swLowRef.current, swHighRef.current, swLowRef.current),
          fib: nearestFibLabel(fLtp, swHighRef.current, swLowRef.current) ?? "—",
          rsi,
          rating: aggregateRating([oiSignalToVote(oi.callSignal), oiSignalToVote(oi.putSignal)]),
        });

        if (futLtp != null && spotLtp != null) dash.setLivePrices(spotLtp, futLtp);
      }
    }, 500);

    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGenerated, timeframe]);

  // Determine what to render
  const worksheetFeedStatus: "idle" | "live" | "interrupted" =
    feedStatus === "live"        ? "live"        :
    feedStatus === "interrupted" ? "interrupted" : "idle";

  const statusPanelKey: string | null =
    !isGenerated ? null :
    timeframe === "custom" && !customRange ? "custom-pending" :
    feedStatus === "market-closed"      ? "market-closed"      :
    feedStatus === "auth-error"         ? "auth-error"         :
    feedStatus === "session-expired"    ? "session-expired"    :
    feedStatus === "broker-disconnected"? "broker-disconnected":
    feedStatus === "reconnecting"       ? "reconnecting"       :
    feedStatus === "api-error"          ? "api-error"          :
    feedStatus === "no-network"         ? "no-network"         : null;

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
      {statusPanelKey ? (
        <StatusPanel status={statusPanelKey} onRetry={() => setRetryKey(k => k + 1)} />
      ) : (
        <Worksheet
          rows={rows}
          pivotMethod={pivotMethod}
          hiddenCols={hiddenCols}
          feedStatus={worksheetFeedStatus}
          isLoading={isLoading}
        />
      )}
    </div>
  );
}

export default Dashboard;
