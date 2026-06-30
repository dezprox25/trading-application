import { useEffect, useRef, useState } from "react";
import { useDashStore } from "./store";
import type { FeedStatus } from "./store";
import { ConfigRow } from "./ConfigRow";
import { TimeframeRow } from "./TimeframeRow";
import { Worksheet } from "./Worksheet";
import { useStore } from "../../store/useStore";
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

function ratingVotes(rsi: number | null, price: number, pp: number, cMMA: number, cTLA: number): number[] {
  const rsiVote  = rsi !== null ? (rsi < 30 ? 1 : rsi > 70 ? -1 : 0) : 0;
  const ppVote   = price > pp   ? 1 : price < pp   ? -1 : 0;
  const mtVote   = price > cMMA ? 1 : price < cTLA ? -1 : 0;
  return [rsiVote, ppVote, mtVote];
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
  const { pivotMethod, setPivotMethod } = useDashStore();

  const labelStyle: React.CSSProperties = {
    fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.5)",
    textTransform: "uppercase", letterSpacing: "0.1em",
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
    generateKey, type,
  } = useDashStore();

  const [isLoading, setIsLoading] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  const barRef        = useRef<ActiveBar | null>(null);
  const prevRsiCloses = useRef<number[]>([]);
  const swHighRef     = useRef<number>(0);
  const swLowRef      = useRef<number>(Infinity);
  const prevOiTin     = useRef<number>(-1);   // tracks OI tick index to detect stale snapshots

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
    barRef.current    = null;
    prevRsiCloses.current = [];
    prevOiTin.current = -1;

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

        // 3b. For live mode, discard any bars that pre-date the current NSE session
        // (09:15 IST = 03:45 UTC). This is a client-side safety net against stale
        // backend data leaking through during edge cases (e.g. missed server-side pruning).
        if (timeframe !== "custom" && bars.length > 0) {
          const nowMs = Date.now();
          const todayMidnightMs = nowMs - (nowMs % (24 * 60 * 60 * 1000));
          const sessionOpenMs = todayMidnightMs + (3 * 60 + 45) * 60 * 1000;
          const cutoffMs = nowMs < sessionOpenMs ? sessionOpenMs - 24 * 60 * 60 * 1000 : sessionOpenMs;
          bars = bars.filter(b => b.t >= cutoffMs);
        }

        if (cancelled) return;

        // 4. Build and append historical rows.
        //
        // KEY INVARIANTS enforced here:
        //   a) Closed bars only — the current live window is owned entirely by Effect 2
        //      (the OI poller). Including an in-progress bar here would mix futures-price
        //      scale (~22 000) with OI scale (~100 M) in the same row when Effect 2's
        //      first Math.max() runs, producing garbage OHLC values.
        //   b) call / put use independent clones of bar — they must be separate objects
        //      so CE and PE columns can diverge once the live OI feed takes over.
        //   c) swHighRef / swLowRef are seeded from the full session cumulative range,
        //      not just the last bar, so SMC and Fib labels are correct from the start.

        // Determine the live window boundary so we can exclude it from historical display.
        const nowForBoundary  = Date.now();
        const activeTfMs      = tfToMs(timeframe === "custom" ? (customRange?.candleTf ?? "5m") : timeframe);
        const liveWindowStart = Math.floor(nowForBoundary / activeTfMs) * activeTfMs;

        // Only show CLOSED bars in the historical table. Current-window bar (if the backend
        // included the active candle) is excluded — Effect 2 will create it from OI data.
        const closedBars = timeframe === "custom"
          ? bars                                          // custom range: show everything
          : bars.filter(b => b.t < liveWindowStart);     // live mode: closed bars only

        if (closedBars.length > 0) {
          const closes    = closedBars.map(b => b.c);
          const rsiSeries = computeRsiSeries(closes);

          let sessionHigh = closedBars[0].h;
          let sessionLow  = closedBars[0].l;
          let prevH = closedBars[0].h;
          let prevL = closedBars[0].l;

          closedBars.forEach((bar, i) => {
            if (i > 0) {
              sessionHigh = Math.max(sessionHigh, bar.h);
              sessionLow  = Math.min(sessionLow,  bar.l);
            }

            const pdh = i === 0 ? bar.h : prevH;
            const pdl = i === 0 ? bar.l : prevL;

            const callPP   = clientPivot4Bar(bar).pp;
            const putPP    = clientPivot4Bar(bar).pp;
            const hCallMMA = mma(callPP, bar.h);
            const hCallTLA = tla(callPP, bar.l);
            const hRsi     = rsiSeries[i] ?? null;

            // Bug fix: clone bar independently for call and put.
            // Sharing the same object reference made CE and PE columns always
            // show identical values and created a silent mutation hazard.
            const callBar: OHLCBar = { ...bar };
            const putBar:  OHLCBar = { ...bar };

            const row: DashboardRow = {
              t: bar.t,
              call: callBar,
              put:  putBar,
              futureLtp: bar.c,
              spotLtp:   bar.c,
              premiumDiscount: 0,
              callPP, putPP,
              callPPClassic: classicPivot(bar).pp,
              putPPClassic:  classicPivot(bar).pp,
              callMMA: hCallMMA,
              callTLA: hCallTLA,
              putMMA:  mma(putPP,  bar.h),
              putTLA:  tla(putPP,  bar.l),
              oiMatrix: null,
              smc: smcNearest(bar.c, sessionHigh, sessionLow, pdh, pdl),
              fib: nearestFibLabel(bar.c, sessionHigh, sessionLow) ?? "—",
              rsi: hRsi,
              rating: aggregateRating(ratingVotes(hRsi, bar.c, callPP, hCallMMA, hCallTLA)),
            };
            appendRow(row);

            prevH = bar.h;
            prevL = bar.l;
          });

          prevRsiCloses.current = closes.slice(-50);

          // Bug fix: seed from full session cumulative high/low, not just the last bar.
          // Using only last bar's range produced wrong SMC and Fib labels for all live rows.
          swHighRef.current = sessionHigh;
          swLowRef.current  = sessionLow;

          const last = closedBars[closedBars.length - 1];
          setLivePrices(last.c, last.c);

          console.log(
            `[Dashboard] History loaded: ${closedBars.length} closed bars | ` +
            `sessionHigh=${sessionHigh} sessionLow=${sessionLow} | last bar t=${last.t}`
          );
        }

        // barRef.current intentionally NOT seeded from history.
        // Effect 2 will initialize the current live window from OI data on its next tick.
        // Seeding from futures prices (~22 000) caused scale corruption when the first
        // OI update applied Math.max(22 000, 100 000 000) to determine the candle High.

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
  }, [isGenerated, symbol, timeframe, customRange, retryKey, generateKey]);

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

      // Debug: log whenever OI tick index advances (confirms live data is flowing)
      if (oi.tin !== prevOiTin.current) {
        console.log(
          `[Dashboard] OI tick — tin=${oi.tin} c_tl=${oi.c_tl} p_tl=${oi.p_tl} ` +
          `src=${oi.dataSource} window=${new Date(windowStart).toISOString()}`
        );
        prevOiTin.current = oi.tin;
      }

      if (!barRef.current || barRef.current.windowStart !== windowStart) {
        // New window — archive previous bar's close to RSI history
        if (barRef.current) {
          prevRsiCloses.current = [...prevRsiCloses.current, barRef.current.callC].slice(-50);
          swHighRef.current = Math.max(swHighRef.current, barRef.current.callH);
          swLowRef.current  = Math.min(swLowRef.current,  barRef.current.callL);
        }

        console.log(
          `[Dashboard] New window at ${new Date(windowStart).toISOString()} ` +
          `c_tl=${oi.c_tl} p_tl=${oi.p_tl} rows=${dash.rows.length}`
        );

        barRef.current = {
          callO: oi.c_tl, callH: oi.c_tl, callL: oi.c_tl, callC: oi.c_tl,
          putO:  oi.p_tl, putH:  oi.p_tl, putL:  oi.p_tl, putC:  oi.p_tl,
          windowStart,
        };

        const callBar:  OHLCBar = { t: windowStart, o: oi.c_tl, h: oi.c_tl, l: oi.c_tl, c: oi.c_tl };
        const putBar:   OHLCBar = { t: windowStart, o: oi.p_tl, h: oi.p_tl, l: oi.p_tl, c: oi.p_tl };
        const callPP   = clientPivot4Bar(callBar).pp;
        const putPP    = clientPivot4Bar(putBar).pp;
        const fLtp     = futLtp  ?? callBar.c;
        const sLtp     = spotLtp ?? callBar.c;
        const rsiSer   = computeRsiSeries([...prevRsiCloses.current, callBar.c]);
        const rsi      = rsiSer[rsiSer.length - 1] ?? null;
        const nCallMMA = mma(callPP, callBar.h);
        const nCallTLA = tla(callPP, callBar.l);

        // Bug fix: spread oi into a plain snapshot object so each stored row has an
        // independent copy — prevents future OI updates from silently mutating this row's
        // oiMatrix reference if the store were ever to allow reference reuse.
        const oiSnapshot = { ...oi };

        dash.appendRow({
          t: windowStart,
          call: callBar, put: putBar,
          futureLtp: fLtp, spotLtp: sLtp,
          premiumDiscount: fLtp - sLtp,
          callPP, putPP,
          callPPClassic: classicPivot(callBar).pp,
          putPPClassic:  classicPivot(putBar).pp,
          callMMA: nCallMMA,
          callTLA: nCallTLA,
          putMMA:  mma(putPP,  putBar.h),
          putTLA:  tla(putPP,  putBar.l),
          oiMatrix: oiSnapshot,
          smc: smcNearest(fLtp, swHighRef.current, swLowRef.current, swHighRef.current, swLowRef.current),
          fib: nearestFibLabel(fLtp, swHighRef.current, swLowRef.current) ?? "—",
          rsi,
          rating: aggregateRating(ratingVotes(rsi, fLtp, callPP, nCallMMA, nCallTLA)),
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

        const callBar:  OHLCBar = { t: b.windowStart, o: b.callO, h: b.callH, l: b.callL, c: b.callC };
        const putBar:   OHLCBar = { t: b.windowStart, o: b.putO,  h: b.putH,  l: b.putL,  c: b.putC  };
        const callPP   = clientPivot4Bar(callBar).pp;
        const putPP    = clientPivot4Bar(putBar).pp;
        const fLtp     = futLtp  ?? callBar.c;
        const sLtp     = spotLtp ?? callBar.c;
        const rsiSer   = computeRsiSeries([...prevRsiCloses.current, callBar.c]);
        const rsi      = rsiSer[rsiSer.length - 1] ?? null;
        const uCallMMA = mma(callPP, callBar.h);
        const uCallTLA = tla(callPP, callBar.l);

        const oiSnapshot = { ...oi };

        dash.updateLatestRow({
          call: callBar, put: putBar,
          callPP, putPP,
          callPPClassic: classicPivot(callBar).pp,
          putPPClassic:  classicPivot(putBar).pp,
          callMMA: uCallMMA,
          callTLA: uCallTLA,
          putMMA:  mma(putPP,  putBar.h),
          putTLA:  tla(putPP,  putBar.l),
          futureLtp: fLtp, spotLtp: sLtp,
          premiumDiscount: fLtp - sLtp,
          oiMatrix: oiSnapshot,
          smc: smcNearest(fLtp, swHighRef.current, swLowRef.current, swHighRef.current, swLowRef.current),
          fib: nearestFibLabel(fLtp, swHighRef.current, swLowRef.current) ?? "—",
          rsi,
          rating: aggregateRating(ratingVotes(rsi, fLtp, callPP, uCallMMA, uCallTLA)),
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
          type={type}
        />
      )}
    </div>
  );
}

export default Dashboard;
