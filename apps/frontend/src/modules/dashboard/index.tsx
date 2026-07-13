import { useEffect, useRef, useState } from "react";
import { useDashStore, scopedKey } from "./store";
import type { FeedStatus } from "./store";
import { ConfigRow } from "./ConfigRow";
import { TimeframeRow } from "./TimeframeRow";
import { Worksheet } from "./Worksheet";
import { exportModule1Excel, istDateStr } from "./excelExport";
import { useStore } from "../../store/useStore";
import { api } from "../../utils/api";
import type { OHLCBar } from "../../calc";
import {
  mmaBar, tlaFromMMA, computeRanking,
  computeRsiSeries, computeEMASeries, computeVWAPSeries,
  nearestFibLabel, smcNearest,
} from "../../calc";
import { formatExpiryForBroker } from "../../data/models";

// ── Helpers ───────────────────────────────────────────────────────────────────

function tfToMs(tf: string): number {
  if (tf.endsWith("h")) return parseInt(tf, 10) * 60 * 60 * 1000;
  if (tf.endsWith("m")) return parseInt(tf, 10) * 60 * 1000;
  return 5 * 60 * 1000;
}

// Sentinel for a bar with no data — p0(NaN) renders "—" and NaN propagates
// cleanly through mmaBar/tlaFromMMA without polluting neighbouring values.
const MISSING_BAR = (t: number): OHLCBar => ({ t, o: NaN, h: NaN, l: NaN, c: NaN });

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
  futO:  number; futH:  number; futL:  number; futC:  number;
  spotO: number; spotH: number; spotL: number; spotC: number;
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
    fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.5)",
    textTransform: "uppercase", letterSpacing: "0.1em",
  };

  return (
    <div style={{
      height: 42, flexShrink: 0,
      background: "#0F2744",
      display: "flex", alignItems: "center",
      borderBottom: "1px solid rgba(255,255,255,0.08)",
      userSelect: "none",
    }}>
      <div style={{
        padding: "0 18px",
        fontFamily: "'Calibri','Segoe UI',system-ui,sans-serif",
        fontSize: 15, fontWeight: 800, color: "#f1f5f9",
        letterSpacing: "0.04em", whiteSpace: "nowrap",
      }}>
        ◆ SYNERGY <span style={{ opacity: 0.4 }}>·</span> Trading Dashboard
      </div>

      <div style={{ flex: 1 }} />

      {/* PP / 4-Bar / Classic labels — hidden per client request; logic kept intact for future use */}
      <div style={{
        display: "none", alignItems: "center", gap: 4,
        padding: "0 16px", borderLeft: "1px solid rgba(255,255,255,0.1)",
      }}>
        <span style={{ ...labelStyle, marginRight: 7 }}>PP</span>
        {(["client", "classic"] as const).map(m => (
          <button
            key={m}
            onClick={() => setPivotMethod(m)}
            style={{
              fontFamily: "'Calibri','Segoe UI',system-ui,sans-serif",
              fontSize: 11, fontWeight: 700,
              padding: "3px 10px", borderRadius: 3,
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
    isGenerated, instrument, timeframe, customRange,
    expiryDate, callStrike, putStrike, type,
    rows, appendRow, clearRows,
    setFeedStatus, feedStatus,
    setLivePrices,
    hiddenCols, colOrder,
    generateKey,
    rehydratePrefs,
  } = useDashStore();

  const [isLoading, setIsLoading] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  const barRef        = useRef<ActiveBar | null>(null);
  const prevRsiCloses = useRef<number[]>([]);
  const swHighRef     = useRef<number>(0);
  const swLowRef      = useRef<number>(Infinity);
  const prevOiTin     = useRef<number>(-1);
  const prevEmaRef    = useRef<number | null>(null);
  const vwapStateRef  = useRef<{ cumTP: number; count: number }>({ cumTP: 0, count: 0 });

  // M-4: Rehydrate user-scoped preferences on login
  const user = useStore((s) => s.user);
  useEffect(() => {
    if (user?.id) {
      rehydratePrefs(user.id);
    }
  }, [user?.id, rehydratePrefs]);

  // Effect 1: fetch history whenever config changes
  useEffect(() => {
    if (!isGenerated) {
      clearRows();
      setFeedStatus("idle");
      barRef.current = null;
      prevRsiCloses.current = [];
      prevEmaRef.current = null;
      vwapStateRef.current = { cumTP: 0, count: 0 };
      return;
    }

    if (timeframe === "custom" && !customRange) {
      clearRows();
      setFeedStatus("live");
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    barRef.current = null;
    prevRsiCloses.current = [];
    prevOiTin.current = -1;
    prevEmaRef.current = null;
    vwapStateRef.current = { cumTP: 0, count: 0 };

    async function init() {
      clearRows();
      setIsLoading(true);
      setFeedStatus("connecting");

      try {
        // 1. Market status check
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

        // 2. Build the futures OHLC URL from the selected underlying
        const inst   = (instrument || "NIFTY").toUpperCase();
        const futSym = `${inst}-FUT`;
        let futUrl: string;

        if (timeframe === "custom" && customRange) {
          futUrl = `/api/market/ohlc-history/${futSym}/${customRange.candleTf}?from=${encodeURIComponent(customRange.from)}&to=${encodeURIComponent(customRange.to)}`;
        } else {
          futUrl = `/api/market/ohlc/${futSym}/${timeframe}`;
        }

        // 3. C-1: Derive option symbols from store config.
        const expiryFmt = formatExpiryForBroker(expiryDate);
        const includesCall = type === "Call" || type === "Call+Put";
        const includesPut  = type === "Put"  || type === "Call+Put";
        const ceSymbol = (expiryFmt && includesCall && callStrike) ? `${instrument}${expiryFmt}C${callStrike}` : null;
        const peSymbol = (expiryFmt && includesPut  && putStrike)  ? `${instrument}${expiryFmt}P${putStrike}`  : null;

        // 4. Fetch all OHLC series in parallel (futures required; options + spot best-effort)
        const tf = timeframe === "custom" ? customRange!.candleTf : timeframe;
        const [rawFut, rawCe, rawPe, rawSpot] = await Promise.all([
          api.get(futUrl).catch(() => null),
          ceSymbol ? api.get(`/api/market/ohlc/${ceSymbol}/${tf}`).catch(() => null) : Promise.resolve(null),
          peSymbol ? api.get(`/api/market/ohlc/${peSymbol}/${tf}`).catch(() => null)  : Promise.resolve(null),
          // M-5: fetch NIFTY-SPOT OHLC for accurate historical spot column
          timeframe !== "custom"
            ? api.get(`/api/market/ohlc/NIFTY-SPOT/${tf}`).catch(() => null)
            : Promise.resolve(null),
        ]);

        if (cancelled) return;

        // 5. Normalize and build lookup maps
        let futBars: OHLCBar[] = Array.isArray(rawFut)
          ? rawFut.map(normalizeBar).filter(Boolean) as OHLCBar[]
          : [];

        const ceMap   = new Map<number, OHLCBar>();
        const peMap   = new Map<number, OHLCBar>();
        const spotMap = new Map<number, OHLCBar>(); // t → full Spot OHLC bar

        if (Array.isArray(rawCe)) {
          rawCe.forEach(r => { const b = normalizeBar(r); if (b) ceMap.set(b.t, b); });
        }
        if (Array.isArray(rawPe)) {
          rawPe.forEach(r => { const b = normalizeBar(r); if (b) peMap.set(b.t, b); });
        }
        if (Array.isArray(rawSpot)) {
          rawSpot.forEach(r => { const b = normalizeBar(r); if (b) spotMap.set(b.t, b); });
        }

        if (process.env.NODE_ENV === "development" && (ceMap.size > 0 || peMap.size > 0)) {
          console.log(`[C-1] Option OHLC loaded — CE bars: ${ceMap.size} PE bars: ${peMap.size} Spot bars: ${spotMap.size}`);
        }
        if (process.env.NODE_ENV === "development" && ceSymbol && ceMap.size === 0) {
          console.warn(`[C-1] CE OHLC empty for ${ceSymbol} — Call rows will show "—". Check: (a) strike within ATM±1000, (b) option ticks hitting aggregateOHLC in dataFeed.ts`);
        }
        if (process.env.NODE_ENV === "development" && peSymbol && peMap.size === 0) {
          console.warn(`[C-1] PE OHLC empty for ${peSymbol} — Put rows will show "—". Check: (a) strike within ATM±1000, (b) option ticks hitting aggregateOHLC in dataFeed.ts`);
        }

        // 6. Client-side session filter for live mode
        if (timeframe !== "custom" && futBars.length > 0) {
          const nowMs = Date.now();
          const todayMidnightMs = nowMs - (nowMs % (24 * 60 * 60 * 1000));
          const sessionOpenMs = todayMidnightMs + (3 * 60 + 45) * 60 * 1000;
          const cutoffMs = nowMs < sessionOpenMs ? sessionOpenMs - 24 * 60 * 60 * 1000 : sessionOpenMs;
          futBars = futBars.filter(b => b.t >= cutoffMs);
        }

        if (cancelled) return;

        // 7. Build historical rows (closed bars only for live mode)
        const nowForBoundary  = Date.now();
        const activeTfMs      = tfToMs(timeframe === "custom" ? (customRange?.candleTf ?? "5m") : timeframe);
        const liveWindowStart = Math.floor(nowForBoundary / activeTfMs) * activeTfMs;

        const closedBars = timeframe === "custom"
          ? futBars
          : futBars.filter(b => b.t < liveWindowStart);

        if (closedBars.length > 0) {
          const futCloses       = closedBars.map(b => b.c);
          const rsiSeries       = computeRsiSeries(futCloses);
          const spotBarsForCalc = closedBars.map(b => spotMap.get(b.t) ?? b);
          const spotCloses      = spotBarsForCalc.map(sb => sb.c);
          const emaSeries       = computeEMASeries(spotCloses, 20);
          const vwapSeries      = computeVWAPSeries(spotBarsForCalc);

          // Seed live-bar EMA / VWAP continuation state
          prevEmaRef.current = emaSeries[emaSeries.length - 1] ?? null;
          let cumTPForState = 0;
          spotBarsForCalc.forEach(sb => { cumTPForState += (sb.h + sb.l + sb.c) / 3; });
          vwapStateRef.current = { cumTP: cumTPForState, count: closedBars.length };

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

            // No cross-instrument fallback: a row with no CE/PE bar renders "—".
            const callBar: OHLCBar = ceMap.get(bar.t) ?? MISSING_BAR(bar.t);
            const putBar:  OHLCBar = peMap.get(bar.t) ?? MISSING_BAR(bar.t);
            const spotBar: OHLCBar = spotMap.get(bar.t) ?? bar;

            const cMMA = mmaBar(callBar);  const cTLA = tlaFromMMA(cMMA, callBar.h);
            const pMMA = mmaBar(putBar);   const pTLA = tlaFromMMA(pMMA, putBar.h);
            const fMMA = mmaBar(bar);      const fTLA = tlaFromMMA(fMMA, bar.h);
            const sMMA = mmaBar(spotBar);  const sTLA = tlaFromMMA(sMMA, spotBar.h);
            const { value: rankVal, winner: rankWin } = computeRanking(cMMA, pMMA);
            const hRsi = rsiSeries[i] ?? null;

            appendRow({
              t: bar.t,
              call: callBar, put: putBar, future: bar, spot: spotBar,
              callMMA: cMMA,   callTLA: cTLA,
              putMMA:  pMMA,   putTLA:  pTLA,
              futureMMA: fMMA, futureTLA: fTLA,
              spotMMA:   sMMA, spotTLA:   sTLA,
              ranking: rankVal, rankingWinner: rankWin,
              oiMatrix: null,
              smc: smcNearest(bar.c, sessionHigh, sessionLow, pdh, pdl),
              fib: nearestFibLabel(bar.c, sessionHigh, sessionLow) ?? "—",
              rsi: hRsi,
              ema:  emaSeries[i]  ?? null,
              vwap: vwapSeries[i] ?? null,
            });

            prevH = bar.h;
            prevL = bar.l;
          });

          prevRsiCloses.current = futCloses.slice(-50);
          swHighRef.current = sessionHigh;
          swLowRef.current  = sessionLow;

          const last        = closedBars[closedBars.length - 1];
          const lastSpotBar = spotMap.get(last.t) ?? last;
          setLivePrices(lastSpotBar.c, last.c);

          console.log(
            `[Dashboard] History loaded: ${closedBars.length} closed bars | ` +
            `sessionHigh=${sessionHigh} sessionLow=${sessionLow} | last bar t=${last.t}`
          );
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
  }, [isGenerated, instrument, timeframe, customRange, retryKey, generateKey, expiryDate, callStrike, putStrike, type]);

  // Effect 2: 500ms live OI polling — builds and updates the active bar.
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

      if (!futLtp) return;

      // Freshness guard: Future/Spot must never silently re-stamp a stale cached price into
      // a brand-new row as if it were live. If no "tick" socket event has updated this
      // symbol within FRESH_TTL_MS, render "—" for that side's OHLC instead — the same
      // honest-missing-data treatment Call/Put already get when no option tick has arrived.
      // The raw futLtp/spotLtp values (always the last real known price) still feed ranking/
      // SMC/Fibonacci below, unchanged — only the rendered OHLC bar goes blank when stale.
      const FRESH_TTL_MS = 8000;
      const futUpdatedAt  = prices["NIFTY-FUT"]?.lastUpdated?.getTime();
      const futFresh      = futUpdatedAt  !== undefined && (now - futUpdatedAt)  < FRESH_TTL_MS;
      const spotUpdatedAt = prices["NIFTY-SPOT"]?.lastUpdated?.getTime();
      const spotFresh     = spotUpdatedAt !== undefined && (now - spotUpdatedAt) < FRESH_TTL_MS;

      // C-1: derive option symbols dynamically and use option LTP for CE/PE bars.
      const { expiryDate: expDate, instrument: inst, callStrike: cs, putStrike: ps, type: t } =
        useDashStore.getState();
      const exFmt    = formatExpiryForBroker(expDate);
      const ceSymbol = (exFmt && t !== "Put"  && cs) ? `${inst}${exFmt}C${cs}` : null;
      const peSymbol = (exFmt && t !== "Call" && ps) ? `${inst}${exFmt}P${ps}`  : null;
      // No fallback to futLtp — null means "no option tick yet" and renders as "—".
      const ceLtp = ceSymbol ? (prices[ceSymbol]?.ltp ?? null) : null;
      const peLtp = peSymbol ? (prices[peSymbol]?.ltp ?? null) : null;

      if (oi.tin !== prevOiTin.current) {
        console.log(
          `[Dashboard] OI tick — tin=${oi.tin} futLtp=${futLtp} ceLtp=${ceLtp ?? "—"} peLtp=${peLtp ?? "—"} ` +
          `src=${oi.dataSource} window=${new Date(windowStart).toISOString()}`
        );
        if (process.env.NODE_ENV === "development") {
          if (ceSymbol && ceLtp === null) console.warn(`[Dashboard] No live tick for CE ${ceSymbol} — Call live bar will show "—"`);
          if (peSymbol && peLtp === null) console.warn(`[Dashboard] No live tick for PE ${peSymbol} — Put live bar will show "—"`);
        }
        prevOiTin.current = oi.tin;
      }

      if (!barRef.current || barRef.current.windowStart !== windowStart) {
        // Finalize previous live bar into running EMA / VWAP state
        if (barRef.current) {
          const pb = barRef.current;
          if (prevEmaRef.current !== null) {
            const k = 2 / (20 + 1);
            prevEmaRef.current = pb.spotC * k + prevEmaRef.current * (1 - k);
          }
          vwapStateRef.current.cumTP += (pb.spotH + pb.spotL + pb.spotC) / 3;
          vwapStateRef.current.count++;
          // RSI closes and session high/low track the FUTURE series only —
          // option premiums must never feed either (history seeds them from
          // futCloses/fut H-L above, so live continuation must match).
          if (!isNaN(pb.futC)) {
            prevRsiCloses.current = [...prevRsiCloses.current, pb.futC].slice(-50);
          }
          if (!isNaN(pb.futH)) swHighRef.current = Math.max(swHighRef.current, pb.futH);
          if (!isNaN(pb.futL)) swLowRef.current  = Math.min(swLowRef.current,  pb.futL);
        }

        if (dash.rows.length === 0) {
          console.log(`[AutoGenerate] ✓ First candle created — futLtp=${futLtp} ceLtp=${ceLtp} peLtp=${peLtp} t=${new Date(windowStart).toISOString()}`);
        }

        const sLtp = spotLtp ?? futLtp;
        // NaN = "no option tick yet this session" — renders "—", never another
        // instrument's price.
        const ceN  = ceLtp ?? NaN;
        const peN  = peLtp ?? NaN;
        barRef.current = {
          callO: ceN, callH: ceN, callL: ceN, callC: ceN,
          putO:  peN, putH:  peN, putL:  peN, putC:  peN,
          futO:  futLtp, futH: futLtp, futL:  futLtp, futC:  futLtp,
          spotO: sLtp,   spotH: sLtp,  spotL: sLtp,   spotC: sLtp,
          windowStart,
        };

        const callBar: OHLCBar = { t: windowStart, o: ceN, h: ceN, l: ceN, c: ceN };
        const putBar:  OHLCBar = { t: windowStart, o: peN, h: peN, l: peN, c: peN };
        const futBar:  OHLCBar = futFresh  ? { t: windowStart, o: futLtp, h: futLtp, l: futLtp, c: futLtp } : MISSING_BAR(windowStart);
        const spotBar: OHLCBar = spotFresh ? { t: windowStart, o: sLtp,   h: sLtp,   l: sLtp,   c: sLtp   } : MISSING_BAR(windowStart);

        // Session high/low = FUTURE series only, including the forming bar —
        // same semantics as the historical builder (never Call/Put values).
        const sessHigh = Math.max(swHighRef.current, futLtp);
        const sessLow  = Math.min(swLowRef.current,  futLtp);

        const cMMA = mmaBar(callBar);  const cTLA = tlaFromMMA(cMMA, callBar.h);
        const pMMA = mmaBar(putBar);   const pTLA = tlaFromMMA(pMMA, putBar.h);
        const fMMA = mmaBar(futBar);   const fTLA = tlaFromMMA(fMMA, futBar.h);
        const sMMA = mmaBar(spotBar);  const sTLA = tlaFromMMA(sMMA, spotBar.h);
        const { value: rankVal, winner: rankWin } = computeRanking(cMMA, pMMA);

        // RSI is always computed from Future closes — never option premiums.
        const rsiSer = computeRsiSeries([...prevRsiCloses.current, futLtp]);
        const rsi    = rsiSer[rsiSer.length - 1] ?? null;
        const k2     = 2 / (20 + 1);
        const ema    = prevEmaRef.current !== null ? sLtp * k2 + prevEmaRef.current * (1 - k2) : null;
        const tp     = (spotBar.h + spotBar.l + spotBar.c) / 3;
        const vwap   = (vwapStateRef.current.cumTP + tp) / (vwapStateRef.current.count + 1);

        dash.appendRow({
          t: windowStart,
          call: callBar, put: putBar, future: futBar, spot: spotBar,
          callMMA: cMMA,   callTLA: cTLA,
          putMMA:  pMMA,   putTLA:  pTLA,
          futureMMA: fMMA, futureTLA: fTLA,
          spotMMA:   sMMA, spotTLA:   sTLA,
          ranking: rankVal, rankingWinner: rankWin,
          oiMatrix: { ...oi },
          smc: smcNearest(futLtp, sessHigh, sessLow, sessHigh, sessLow),
          fib: nearestFibLabel(futLtp, sessHigh, sessLow) ?? "—",
          rsi, ema, vwap,
        });

      } else {
        const b = barRef.current;
        // Only update call/put OHLC when a real tick arrived (ceLtp/peLtp !== null).
        // First valid tick after bar open also back-fills the Open that was set to NaN.
        if (ceLtp !== null) {
          b.callH = isNaN(b.callH) ? ceLtp : Math.max(b.callH, ceLtp);
          b.callL = isNaN(b.callL) ? ceLtp : Math.min(b.callL, ceLtp);
          if (isNaN(b.callO)) b.callO = ceLtp;
          b.callC = ceLtp;
        }
        if (peLtp !== null) {
          b.putH = isNaN(b.putH) ? peLtp : Math.max(b.putH, peLtp);
          b.putL = isNaN(b.putL) ? peLtp : Math.min(b.putL, peLtp);
          if (isNaN(b.putO)) b.putO = peLtp;
          b.putC = peLtp;
        }
        b.futH  = Math.max(b.futH,  futLtp);
        b.futL  = Math.min(b.futL,  futLtp);
        b.futC  = futLtp;
        const sLtp = spotLtp ?? futLtp;
        b.spotH = Math.max(b.spotH, sLtp);
        b.spotL = Math.min(b.spotL, sLtp);
        b.spotC = sLtp;

        const callBar: OHLCBar = { t: b.windowStart, o: b.callO, h: b.callH, l: b.callL, c: b.callC };
        const putBar:  OHLCBar = { t: b.windowStart, o: b.putO,  h: b.putH,  l: b.putL,  c: b.putC  };
        // b.futO/H/L/C and b.spotO/H/L/C keep tracking the last real price internally
        // (needed so Math.max/min stay correct once fresh ticks resume) — the bar actually
        // rendered goes blank when stale rather than re-stamping a stale number
        // (see FRESH_TTL_MS above).
        const futBar:  OHLCBar = futFresh  ? { t: b.windowStart, o: b.futO,  h: b.futH,  l: b.futL,  c: b.futC  } : MISSING_BAR(b.windowStart);
        const spotBar: OHLCBar = spotFresh ? { t: b.windowStart, o: b.spotO, h: b.spotH, l: b.spotL, c: b.spotC } : MISSING_BAR(b.windowStart);

        // Session high/low = FUTURE series only, including the forming bar —
        // same semantics as the historical builder (never Call/Put values).
        const sessHigh = Math.max(swHighRef.current, b.futH);
        const sessLow  = Math.min(swLowRef.current,  b.futL);

        const cMMA = mmaBar(callBar);  const cTLA = tlaFromMMA(cMMA, callBar.h);
        const pMMA = mmaBar(putBar);   const pTLA = tlaFromMMA(pMMA, putBar.h);
        const fMMA = mmaBar(futBar);   const fTLA = tlaFromMMA(fMMA, futBar.h);
        const sMMA = mmaBar(spotBar);  const sTLA = tlaFromMMA(sMMA, spotBar.h);
        const { value: rankVal, winner: rankWin } = computeRanking(cMMA, pMMA);

        // RSI is always computed from Future closes — never option premiums.
        const rsiSer = computeRsiSeries([...prevRsiCloses.current, futLtp]);
        const rsi    = rsiSer[rsiSer.length - 1] ?? null;
        const k2     = 2 / (20 + 1);
        const ema    = prevEmaRef.current !== null ? sLtp * k2 + prevEmaRef.current * (1 - k2) : null;
        const tp     = (spotBar.h + spotBar.l + spotBar.c) / 3;
        const vwap   = (vwapStateRef.current.cumTP + tp) / (vwapStateRef.current.count + 1);

        dash.updateLatestRow({
          call: callBar, put: putBar, future: futBar, spot: spotBar,
          callMMA: cMMA,   callTLA: cTLA,
          putMMA:  pMMA,   putTLA:  pTLA,
          futureMMA: fMMA, futureTLA: fTLA,
          spotMMA:   sMMA, spotTLA:   sTLA,
          ranking: rankVal, rankingWinner: rankWin,
          oiMatrix: { ...oi },
          smc: smcNearest(futLtp, sessHigh, sessLow, sessHigh, sessLow),
          fib: nearestFibLabel(futLtp, sessHigh, sessLow) ?? "—",
          rsi, ema, vwap,
        });

        if (spotLtp != null) dash.setLivePrices(spotLtp, futLtp);
      }
    }, 500);

    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGenerated, timeframe]);

  // Effect 3: automatic end-of-day Excel export. Once NSE closes (15:45 IST,
  // Mon–Fri) this fires exactly once per trading day and flags itself done in
  // localStorage, so a page refresh after the download already happened does
  // not trigger a second one. Checked on a 60s poll rather than a single
  // timer-at-close because the tab may not be open exactly at market close.
  useEffect(() => {
    if (!isGenerated) return;

    const tryAutoExport = () => {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Kolkata", hour12: false,
        weekday: "short", hour: "numeric", minute: "numeric",
      }).formatToParts(new Date());
      const partMap: Record<string, string> = {};
      parts.forEach(p => { partMap[p.type] = p.value; });
      if (partMap.weekday === "Sat" || partMap.weekday === "Sun") return;

      const minutesNow = parseInt(partMap.hour, 10) * 60 + parseInt(partMap.minute, 10);
      const MARKET_CLOSE_MIN = 15 * 60 + 45; // 3:45 PM IST — matches backend isMarketOpenTime
      if (minutesNow < MARKET_CLOSE_MIN) return;

      const flagKey = scopedKey(`m1_eod_export_${istDateStr()}`);
      try {
        if (localStorage.getItem(flagKey) === "1") return;
      } catch { return; }

      const dash = useDashStore.getState();
      if (dash.rows.length === 0) return;

      const exported = exportModule1Excel({
        rows: dash.rows, hiddenCols: dash.hiddenCols, colOrder: dash.colOrder,
        type: dash.type, instrument: dash.instrument, timeframe: dash.timeframe,
      });
      if (exported) {
        try { localStorage.setItem(flagKey, "1"); } catch { /* noop */ }
      }
    };

    tryAutoExport();
    const timer = setInterval(tryAutoExport, 60000);
    return () => clearInterval(timer);
  }, [isGenerated]);

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
      height: "calc(100vh - 60px)", width: "100%",
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
          hiddenCols={hiddenCols}
          colOrder={colOrder}
          feedStatus={worksheetFeedStatus}
          isLoading={isLoading}
          type={type}
        />
      )}
    </div>
  );
}

export default Dashboard;
