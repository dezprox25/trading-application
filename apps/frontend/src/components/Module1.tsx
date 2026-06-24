import { useQuery } from "@tanstack/react-query";
import { useStore } from "../store/useStore";
import { api, getModule1LatestMetrics } from "../utils/api";
import { Candle } from "@stock/shared";
import { useEffect, useRef, useState, useMemo } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

// ── Types ──────────────────────────────────────────────────────────────────────
type TradeSignal = "STRONG_CALL_BUY" | "CALL_BUY" | "STRONG_PUT_BUY" | "PUT_BUY" | "WAIT";

interface RowNorms {
  c_tl: number; c_mt: number; c_high: number; c_low: number; c_buy: number; c_sell: number;
  p_tl: number; p_mt: number; p_high: number; p_low: number; p_buy: number; p_sell: number;
}

interface MatrixRow extends RowNorms {
  time: string;
  openTime: number;
  signal: TradeSignal;
  isLive: boolean;
  ohlcOpen: number;
  ohlcClose: number;
}

interface MarketRow {
  time: string;
  startTime: string;
  endTime: string;
  vwap: number;
  openRate: number;
  closeRate: number;
  highRate: number;
  lowRate: number;
  diffVolume: number;
  cumVolume: number;
}

interface AlertEntry {
  id: number;
  time: string;
  signal: TradeSignal;
  strike: string;
  ltp: number;
  mtValue: number;
  volume: number;
  oiBuildUp: string;
  stopLoss: number;
  target: number;
}

// ── Constants ──────────────────────────────────────────────────────────────────
const NIFTY_STEP = 50;

// Light-theme signal styles
const SIGNAL_STYLE: Record<TradeSignal, { bg: string; text: string; border: string; label: string; shadow: string }> = {
  STRONG_CALL_BUY: { bg: "#16a34a", text: "#ffffff", border: "#15803d", label: "STRONG CALL BUY", shadow: "0 2px 8px rgba(22,163,74,0.25)" },
  CALL_BUY:        { bg: "#dcfce7", text: "#14532d", border: "#86efac", label: "CALL BUY",         shadow: "0 1px 4px rgba(22,163,74,0.12)" },
  STRONG_PUT_BUY:  { bg: "#dc2626", text: "#ffffff", border: "#b91c1c", label: "STRONG PUT BUY",   shadow: "0 2px 8px rgba(220,38,38,0.25)" },
  PUT_BUY:         { bg: "#fee2e2", text: "#7f1d1d", border: "#fca5a5", label: "PUT BUY",           shadow: "0 1px 4px rgba(220,38,38,0.12)" },
  WAIT:            { bg: "#f1f5f9", text: "#64748b", border: "#e2e8f0", label: "WAIT",              shadow: "none" },
};

// ── Pure helpers ───────────────────────────────────────────────────────────────
const computeMT = (tl: number, high: number, low: number): number =>
  high + low + tl > 0 ? (high + low + tl) / 3 : 0;

const fmtN = (v: number | null | undefined): string => {
  if (v === null || v === undefined) return "—";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000)     return `${sign}${(abs / 1_000).toFixed(1)}K`;
  return `${sign}${abs.toFixed(0)}`;
};

const fmtPrice = (v: number): string =>
  v > 0 ? v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "—";

const fmtMs = (ms: number): string => {
  const d = new Date(ms);
  return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" });
};

const fmtIso = (iso: string | undefined | null): string => {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? "—" :
      d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch { return "—"; }
};

const getTimeframeMins = (tf: string): number => {
  if (tf === "1m") return 1;
  if (tf === "3m") return 3;
  if (tf === "5m") return 5;
  const m = parseInt(tf);
  return isNaN(m) ? 5 : m;
};

// Light-theme heatmap colors
function cellColor(
  value: number,
  reference: number,
  kind: "call-tl" | "put-tl" | "buy" | "sell" | "info"
): { bg: string; text: string; fw: number } {
  if (kind === "info")  return { bg: "transparent",          text: "#5b6b82", fw: 500 };
  if (kind === "buy")   return { bg: "#eff6ff",              text: "#1d4ed8", fw: 700 };
  if (kind === "sell")  return { bg: "#fff7ed",              text: "#c2410c", fw: 700 };

  if (reference <= 0) return { bg: "transparent", text: "#94a3b8", fw: 500 };
  const diff = value - reference;
  const pct  = Math.abs(diff / reference);

  if (kind === "call-tl") {
    if (diff > 0) {
      return pct > 0.035
        ? { bg: "#bbf7d0", text: "#14532d", fw: 800 }   // Strong Bullish — dark green on mint
        : { bg: "#dcfce7", text: "#15803d", fw: 700 };  // Bullish — medium green
    }
    if (diff < 0) {
      return pct > 0.035
        ? { bg: "#fecaca", text: "#7f1d1d", fw: 800 }   // Strong Bearish — dark red on pink
        : { bg: "#fee2e2", text: "#991b1b", fw: 700 };  // Bearish — medium red
    }
  }

  if (kind === "put-tl") {
    // Put side: rising P_TL means more put writing = bearish for P
    if (diff > 0) {
      return pct > 0.035
        ? { bg: "#fecaca", text: "#7f1d1d", fw: 800 }
        : { bg: "#fee2e2", text: "#991b1b", fw: 700 };
    }
    if (diff < 0) {
      return pct > 0.035
        ? { bg: "#bbf7d0", text: "#14532d", fw: 800 }
        : { bg: "#dcfce7", text: "#15803d", fw: 700 };
    }
  }

  return { bg: "transparent", text: "#94a3b8", fw: 500 };
}

function computeSignal(row: RowNorms, prev: RowNorms | null, ohlcOpen: number, ohlcClose: number): TradeSignal {
  const callBase = row.c_tl > row.c_mt && row.c_buy > 0;
  const putBase  = row.p_tl > row.p_mt && row.p_buy > 0;
  const bullTrend = prev ? row.c_tl > prev.c_tl : false;
  const bearTrend = prev ? row.c_tl < prev.c_tl : false;
  const cBullish  = ohlcClose > ohlcOpen;
  const cBearish  = ohlcClose < ohlcOpen;

  if (callBase && Math.abs(row.c_sell) > 0 && row.c_buy > Math.abs(row.c_sell) * 1.5 && bullTrend && cBullish)
    return "STRONG_CALL_BUY";
  if (putBase && Math.abs(row.p_sell) > 0 && row.p_buy > Math.abs(row.p_sell) * 1.5 && bearTrend && cBearish)
    return "STRONG_PUT_BUY";
  if (callBase) return "CALL_BUY";
  if (putBase)  return "PUT_BUY";
  return "WAIT";
}

// ── Module 1 ──────────────────────────────────────────────────────────────────
export const Module1 = ({ isSplit = false }: { isSplit?: boolean }) => {
  const [cfgExchange,   setCfgExchange]   = useState("NFO");
  const [cfgInstrument, setCfgInstrument] = useState("OPTIDX");
  const [cfgOptionType, setCfgOptionType] = useState("CE");
  const [cfgMarketType, setCfgMarketType] = useState("REGULAR");
  const [alertHistory,  setAlertHistory]  = useState<AlertEntry[]>([]);
  const alertIdRef  = useRef(0);
  const prevSigRef  = useRef<TradeSignal>("WAIT");
  const prevFutRef  = useRef(0);
  const prevSpotRef = useRef(0);
  const [futFlash,  setFutFlash]  = useState<"up" | "down" | null>(null);
  const [spotFlash, setSpotFlash] = useState<"up" | "down" | null>(null);

  const selectedSymbol       = useStore((s) => s.selectedSymbol);
  const selectedTimeframe    = useStore((s) => s.selectedTimeframe);
  const setSelectedTimeframe = useStore((s) => s.setSelectedTimeframe);
  const prices               = useStore((s) => s.prices);
  const latestOiMetrics      = useStore((s) => s.latestOiMetrics);

  const spotLtp = prices["NIFTY-SPOT"]?.ltp ?? 0;
  const futLtp  = prices[selectedSymbol]?.ltp ?? 0;

  useEffect(() => {
    if (futLtp > 0 && prevFutRef.current > 0 && futLtp !== prevFutRef.current) {
      setFutFlash(futLtp > prevFutRef.current ? "up" : "down");
      const t = setTimeout(() => setFutFlash(null), 400);
      return () => clearTimeout(t);
    }
    if (futLtp > 0) prevFutRef.current = futLtp;
  }, [futLtp]);

  useEffect(() => {
    if (spotLtp > 0 && prevSpotRef.current > 0 && spotLtp !== prevSpotRef.current) {
      setSpotFlash(spotLtp > prevSpotRef.current ? "up" : "down");
      const t = setTimeout(() => setSpotFlash(null), 400);
      return () => clearTimeout(t);
    }
    if (spotLtp > 0) prevSpotRef.current = spotLtp;
  }, [spotLtp]);

  // ── Queries (DO NOT MODIFY — API integration layer) ────────────────────────
  const { data: ohlcBars = [], isLoading, refetch: refetchOhlc } = useQuery<Candle[]>({
    queryKey: ["ohlc", selectedSymbol, selectedTimeframe],
    queryFn: () => api.get(`/api/market/ohlc/${selectedSymbol}/${selectedTimeframe}`),
    enabled: !!selectedSymbol,
    refetchInterval: 10000,
    staleTime: 5000,
  });

  useQuery({
    queryKey: ["initial-spot-price"],
    queryFn: async () => {
      try {
        const res = await api.get("/api/market/spot/NIFTY-SPOT");
        if (res?.ltp) useStore.getState().updatePrice("NIFTY-SPOT", res.ltp);
      } catch {}
      return null;
    },
    refetchInterval: 10000,
  });

  useQuery({
    queryKey: ["initial-futures-price", selectedSymbol],
    queryFn: async () => {
      try {
        const res = await api.get(`/api/market/futures/${selectedSymbol}`);
        if (res?.ltp) useStore.getState().updatePrice(selectedSymbol, res.ltp);
      } catch {}
      return null;
    },
    enabled: !!selectedSymbol,
    refetchInterval: 10000,
  });

  useQuery({
    queryKey: ["module1-initial-latest-oi"],
    queryFn: async () => {
      try {
        const data = await getModule1LatestMetrics();
        if (data && !useStore.getState().latestOiMetrics) {
          useStore.getState().setLatestOiMetrics(data);
        }
        return data;
      } catch { return null; }
    },
    retry: false,
  });

  // ── Data computation (preserves existing logic exactly) ────────────────────
  const stepMs = getTimeframeMins(selectedTimeframe) * 60 * 1000;

  const continuousBars = useMemo((): Candle[] => {
    if (ohlcBars.length === 0) return [];
    const nowMs = latestOiMetrics ? new Date(latestOiMetrics.timestamp).getTime() : Date.now();
    const activeBoundary = Math.floor(nowMs / stepMs) * stepMs;
    const latestCompletedBoundary = activeBoundary - stepMs;
    const bars: Candle[] = [];
    for (let i = 15; i >= 0; i--) {
      const targetTime = latestCompletedBoundary - i * stepMs;
      let bar = ohlcBars.find((b) => b.openTime === targetTime);
      if (!bar) {
        const candidates = ohlcBars.filter((b) => b.openTime < targetTime);
        bar = candidates.length > 0
          ? { ...candidates[candidates.length - 1], openTime: targetTime }
          : { ...ohlcBars[0], openTime: targetTime };
      }
      bars.push(bar);
    }
    return bars;
  }, [ohlcBars, latestOiMetrics, stepMs]);

  const tableRows = useMemo(() =>
    continuousBars.map((bar) => ({
      time: fmtMs(bar.openTime),
      open: bar.open, high: bar.high, low: bar.low, close: bar.close,
      volume: bar.volume, openTime: bar.openTime,
    })),
  [continuousBars]);

  const latestRow = tableRows.length > 0 ? tableRows[tableRows.length - 1] : null;

  const buildFallbackOiMetrics = (rowIndex: number, useLiveValues = false) => {
    const row = tableRows[rowIndex];
    if (!row) return [];
    const previous   = tableRows[rowIndex - 1] || row;
    const rowsToDate = tableRows.slice(0, rowIndex + 1);
    const baseClose  = latestRow ? latestRow.close : 1;
    const baseLow    = latestRow ? latestRow.low   : 1;
    const liveCallBase = latestOiMetrics?.c_tl ?? null;
    const livePutBase  = latestOiMetrics?.p_tl ?? null;

    const callTotal     = liveCallBase !== null && baseClose > 0 ? Math.round(liveCallBase * (row.close / baseClose))     : row.close;
    const prevCallTotal = liveCallBase !== null && baseClose > 0 ? Math.round(liveCallBase * (previous.close / baseClose)) : previous.close;
    const putTotal      = livePutBase  !== null && baseLow  > 0 ? Math.round(livePutBase  * (row.low   / baseLow))        : row.low;
    const prevPutTotal  = livePutBase  !== null && baseLow  > 0 ? Math.round(livePutBase  * (previous.low / baseLow))     : previous.low;
    const futuresTotal  = useLiveValues && futLtp > 0 ? futLtp : row.close;
    const callDelta     = callTotal     - prevCallTotal;
    const putDelta      = putTotal      - prevPutTotal;
    const futuresDelta  = futuresTotal  - previous.close;

    const sessionHigh = liveCallBase !== null && baseClose > 0
      ? Math.max(...rowsToDate.map((item) => Math.round(liveCallBase * (item.high / baseClose))))
      : Math.max(...rowsToDate.map((item) => item.high));
    const sessionLow = liveCallBase !== null && baseClose > 0
      ? Math.min(...rowsToDate.map((item) => Math.round(liveCallBase * (item.low / baseClose))))
      : Math.min(...rowsToDate.map((item) => item.low));
    const putHigh = livePutBase !== null && baseLow > 0
      ? Math.max(...rowsToDate.map((item) => Math.round(livePutBase * (item.high / baseLow))))
      : Math.max(...rowsToDate.map((item) => item.high));
    const putLow = livePutBase !== null && baseLow > 0
      ? Math.min(...rowsToDate.map((item) => Math.round(livePutBase * (item.low / baseLow))))
      : Math.min(...rowsToDate.map((item) => item.low));

    return [
      { label: "C_TL",  value: callTotal },
      { label: "C_Hig", value: sessionHigh },
      { label: "C_Low", value: sessionLow },
      { label: "C_Buy", value: Math.max(callDelta, 0) },
      { label: "C_Sell",value: Math.min(callDelta, 0) },
      { label: "F_Buy", value: Math.max(futuresDelta, 0) },
      { label: "F_Sell",value: Math.min(futuresDelta, 0) },
      { label: "P_TL",  value: putTotal },
      { label: "P_Hig", value: putHigh },
      { label: "P_Low", value: putLow },
      { label: "P_Buy", value: Math.max(putDelta, 0) },
      { label: "P_Sell",value: Math.min(putDelta, 0) },
    ];
  };

  const getMV = (metrics: Array<{ label: string; value: number | null }>, label: string): number =>
    metrics.find((m) => m.label === label)?.value ?? 0;

  // ── Build matrix rows ──────────────────────────────────────────────────────
  const matrixRows = useMemo((): MatrixRow[] => {
    if (tableRows.length === 0) return [];
    const result: MatrixRow[] = [];
    const reversed = [...tableRows].reverse().slice(0, 15);

    for (let idx = 0; idx < reversed.length; idx++) {
      const hasLive   = !!latestOiMetrics;
      const isLive    = hasLive && idx === 0;
      const candleIdx = hasLive ? idx - 1 : idx;
      const ohlcRow   = reversed[candleIdx] ?? reversed[0];

      const displayTime = isLive && latestOiMetrics
        ? fmtIso(latestOiMetrics.timestamp) : ohlcRow?.time ?? "—";

      let raw: Array<{ label: string; value: number | null }> = [];
      if (isLive && latestOiMetrics) {
        raw = [
          { label: "C_TL",  value: latestOiMetrics.c_tl  },
          { label: "C_Hig", value: latestOiMetrics.c_hig },
          { label: "C_Low", value: latestOiMetrics.c_low  },
          { label: "C_Buy", value: latestOiMetrics.c_buy  },
          { label: "C_Sell",value: latestOiMetrics.c_sell },
          { label: "P_TL",  value: latestOiMetrics.p_tl  },
          { label: "P_Hig", value: latestOiMetrics.p_hig },
          { label: "P_Low", value: latestOiMetrics.p_low  },
          { label: "P_Buy", value: latestOiMetrics.p_buy  },
          { label: "P_Sell",value: latestOiMetrics.p_sell },
        ];
      } else {
        const rowIndex = tableRows.length - 1 - (isLive ? 0 : candleIdx);
        if (rowIndex >= 0) raw = buildFallbackOiMetrics(rowIndex, isLive) as any[];
      }

      const c_tl  = getMV(raw, "C_TL");
      const c_hig = getMV(raw, "C_Hig");
      const c_low = getMV(raw, "C_Low");
      const c_buy = getMV(raw, "C_Buy");
      const c_sell= getMV(raw, "C_Sell");
      const c_mt  = computeMT(c_tl, c_hig, c_low);
      const p_tl  = getMV(raw, "P_TL");
      const p_hig = getMV(raw, "P_Hig");
      const p_low = getMV(raw, "P_Low");
      const p_buy = getMV(raw, "P_Buy");
      const p_sell= getMV(raw, "P_Sell");
      const p_mt  = computeMT(p_tl, p_hig, p_low);

      const norms: RowNorms = {
        c_tl, c_mt, c_high: c_hig, c_low, c_buy, c_sell,
        p_tl, p_mt, p_high: p_hig, p_low, p_buy, p_sell,
      };

      const prev = result.length > 0 ? result[result.length - 1] : null;
      const signal = computeSignal(norms, prev, ohlcRow?.open ?? 0, ohlcRow?.close ?? 0);

      result.push({
        ...norms,
        time: displayTime, openTime: ohlcRow?.openTime ?? 0,
        signal, isLive,
        ohlcOpen: ohlcRow?.open ?? 0, ohlcClose: ohlcRow?.close ?? 0,
      });
    }
    return result;
  }, [tableRows, latestOiMetrics, futLtp]);

  // ── Market data rows ───────────────────────────────────────────────────────
  const marketRows = useMemo((): MarketRow[] => {
    let cumTypicalVol = 0, cumVol = 0, cumVolume = 0;
    return continuousBars.slice(-12).map((bar, idx, arr) => {
      const typical = (bar.high + bar.low + bar.close) / 3;
      cumTypicalVol += typical * (bar.volume || 0);
      cumVol        += bar.volume || 0;
      cumVolume     += bar.volume || 0;
      const vwap    = cumVol > 0 ? cumTypicalVol / cumVol : typical;
      const diffVol = idx > 0 ? (bar.volume || 0) - (arr[idx - 1].volume || 0) : bar.volume || 0;
      return {
        time: fmtMs(bar.openTime), startTime: fmtMs(bar.openTime),
        endTime: fmtMs(bar.openTime + stepMs - 60000),
        vwap, openRate: bar.open, closeRate: bar.close,
        highRate: bar.high, lowRate: bar.low, diffVolume: diffVol, cumVolume,
      };
    }).reverse();
  }, [continuousBars, stepMs]);

  // ── ATM levels ─────────────────────────────────────────────────────────────
  const atmStrike = spotLtp > 0 ? Math.round(spotLtp / NIFTY_STEP) * NIFTY_STEP : 0;
  const atmLevels = [-150, -100, -50, 0, 50, 100, 150].map((off) => ({
    label: off === 0 ? "ATM" : off > 0 ? `ATM+${off}` : `ATM${off}`,
    strike: atmStrike + off, isAtm: off === 0,
  }));

  // ── Alert accumulation ─────────────────────────────────────────────────────
  useEffect(() => {
    const liveRow = matrixRows.find((r) => r.isLive);
    if (!liveRow || liveRow.signal === prevSigRef.current || liveRow.signal === "WAIT") return;
    prevSigRef.current = liveRow.signal;
    const sl  = futLtp > 0 ? +(futLtp * (liveRow.signal.includes("STRONG") ? 0.995 : 0.997)).toFixed(1) : 0;
    const tgt = futLtp > 0 ? +(futLtp * (liveRow.signal.includes("STRONG") ? 1.008 : 1.005)).toFixed(1) : 0;
    setAlertHistory((prev) => [{
      id: ++alertIdRef.current,
      time: liveRow.time, signal: liveRow.signal,
      strike: atmStrike > 0 ? String(atmStrike) : "—",
      ltp: futLtp,
      mtValue: liveRow.signal.includes("PUT") ? liveRow.p_mt : liveRow.c_mt,
      volume: latestRow?.volume ?? 0,
      oiBuildUp: liveRow.signal.includes("CALL") ? "CALL BUILD" : "PUT BUILD",
      stopLoss: sl, target: tgt,
    }, ...prev].slice(0, 20));
  }, [matrixRows]);

  // ── Chart data ─────────────────────────────────────────────────────────────
  const chartData = useMemo(() =>
    continuousBars.slice(-12).map((bar) => {
      const mRow = matrixRows.find((r) => r.openTime === bar.openTime);
      return { time: fmtMs(bar.openTime), price: bar.close, mt: mRow?.c_mt || null, volume: bar.volume || 0 };
    }),
  [continuousBars, matrixRows]);

  const currentSignal = matrixRows[0]?.signal ?? "WAIT";
  const sigStyle = SIGNAL_STYLE[currentSignal];
  const spread = futLtp > 0 && spotLtp > 0 ? futLtp - spotLtp : 0;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700;800;900&display=swap');

        /* ── ROOT ──────────────────────────────────── */
        .m1-root {
          background: #f5f7fa;
          min-height: 100vh;
          font-family: 'Inter', sans-serif;
          color: #102033;
        }

        /* ── CONFIG BAR ────────────────────────────── */
        .m1-cfg {
          display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
          padding: 6px 14px;
          background: #ffffff;
          border-bottom: 1.5px solid #d8e0ea;
          box-shadow: 0 1px 4px rgba(15,32,51,0.06);
        }
        .m1-lbl {
          font-size: 9px; font-weight: 700; color: #94a3b8;
          text-transform: uppercase; letter-spacing: 0.08em;
        }
        .m1-sel {
          background: #ffffff; border: 1.5px solid #d8e0ea; color: #102033;
          font-family: 'Inter', sans-serif; font-size: 11px; font-weight: 600;
          padding: 3px 6px; border-radius: 4px; cursor: pointer; outline: none;
          min-width: 80px; transition: border-color 0.15s;
        }
        .m1-sel:focus { border-color: #16a34a; }
        .m1-tf {
          background: #ffffff; border: 1.5px solid #d8e0ea; color: #5b6b82;
          font-family: 'Inter', sans-serif; font-size: 11px; font-weight: 700;
          padding: 3px 10px; border-radius: 4px; cursor: pointer; transition: all 0.12s;
        }
        .m1-tf.on { background: #16a34a; border-color: #16a34a; color: #fff; }
        .m1-tf:hover:not(.on) { border-color: #16a34a; color: #16a34a; }
        .m1-get {
          background: #102033; border: 1.5px solid #102033; color: #ffffff;
          font-family: 'Inter', sans-serif; font-size: 11px; font-weight: 800;
          padding: 4px 14px; border-radius: 4px; cursor: pointer;
          letter-spacing: 0.05em; text-transform: uppercase; transition: all 0.12s;
        }
        .m1-get:hover { background: #1e3a5f; border-color: #1e3a5f; }
        .m1-ticker {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 3px 8px; background: #f8fafc; border: 1.5px solid #d8e0ea;
          border-radius: 4px;
        }
        .m1-divider { width: 1px; height: 20px; background: #d8e0ea; margin: 0 2px; }

        /* ── MAIN GRID ─────────────────────────────── */
        .m1-grid {
          display: grid;
          grid-template-columns: 1fr 272px;
          gap: 0;
          height: calc(100vh - 118px);
          overflow: hidden;
        }
        .m1-grid.split { grid-template-columns: 1fr; height: auto; }

        .m1-left { display: flex; flex-direction: column; overflow: hidden; border-right: 1.5px solid #d8e0ea; }
        .m1-right { display: flex; flex-direction: column; overflow: hidden; background: #f8fafc; }

        /* ── SECTION HEADER ────────────────────────── */
        .m1-hdr {
          padding: 5px 12px;
          background: #f8fafc;
          border-bottom: 1.5px solid #d8e0ea;
          border-top: 1.5px solid #d8e0ea;
          font-family: 'Inter', sans-serif;
          font-size: 9px; font-weight: 800; text-transform: uppercase;
          letter-spacing: 0.1em; color: #5b6b82;
          display: flex; align-items: center; justify-content: space-between;
          flex-shrink: 0;
        }

        /* ── MATRIX TABLE ──────────────────────────── */
        .m1-matrix-wrap {
          flex: 1; overflow: auto;
        }
        .m1-matrix-wrap::-webkit-scrollbar { width: 5px; height: 5px; }
        .m1-matrix-wrap::-webkit-scrollbar-track { background: #f1f5f9; }
        .m1-matrix-wrap::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }

        .m1-tbl { width: 100%; border-collapse: collapse; table-layout: fixed; font-family: 'JetBrains Mono', monospace; }

        .m1-th-grp {
          position: sticky; top: 0; z-index: 10;
          font-family: 'Inter', sans-serif;
          font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em;
          padding: 5px 4px; text-align: center;
          background: #f1f5f9;
          border-bottom: 1px solid #e2e8f0;
          border-right: 1px solid #e2e8f0;
        }
        .m1-th {
          position: sticky; top: 24px; z-index: 10;
          font-family: 'Inter', sans-serif;
          font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em;
          padding: 4px 3px; text-align: right; white-space: nowrap;
          background: #f8fafc;
          border-bottom: 1.5px solid #d8e0ea;
          border-right: 1px solid #e2e8f0;
          color: #5b6b82;
        }
        .m1-th:first-child { text-align: left; padding-left: 8px; }

        .m1-tr { border-bottom: 1px solid #f1f5f9; transition: background 0.1s; }
        .m1-tr:hover { background: #f0fdf4 !important; }
        .m1-tr.live { background: #f0fdf4; }

        .m1-td {
          font-size: 10px; padding: 4px 3px; text-align: right;
          border-right: 1px solid #f1f5f9; white-space: nowrap;
          overflow: hidden; text-overflow: ellipsis;
          color: #102033;
        }
        .m1-td:first-child { text-align: left; padding-left: 8px; }
        .m1-td.spc { background: #f5f7fa; border-right: 2px solid #d8e0ea; width: 6px; padding: 0; }

        .m1-sig-badge {
          display: inline-flex; align-items: center; justify-content: center;
          padding: 2px 5px; border-radius: 3px; border: 1px solid transparent;
          font-family: 'Inter', sans-serif;
          font-size: 8px; font-weight: 800; letter-spacing: 0.03em;
          white-space: nowrap; text-transform: uppercase;
        }

        /* ── RIGHT PANEL ───────────────────────────── */
        .m1-scroll { overflow-y: auto; }
        .m1-scroll::-webkit-scrollbar { width: 4px; }
        .m1-scroll::-webkit-scrollbar-track { background: #f8fafc; }
        .m1-scroll::-webkit-scrollbar-thumb { background: #d8e0ea; border-radius: 2px; }

        .m1-atm-row {
          display: flex; align-items: center; justify-content: space-between;
          padding: 5px 12px; border-bottom: 1px solid #f1f5f9;
          font-size: 11px; transition: background 0.1s;
        }
        .m1-atm-row:hover { background: #f1f5f9; }
        .m1-atm-row.atm { background: #f0fdf4; border-left: 3px solid #16a34a; }

        .m1-alert-row {
          padding: 7px 10px; border-bottom: 1px solid #f1f5f9;
          transition: background 0.1s;
        }
        .m1-alert-row:hover { background: #f8fafc; }

        /* ── MARKET DATA TABLE ─────────────────────── */
        .m1-mkt { width: 100%; border-collapse: collapse; table-layout: fixed; font-family: 'JetBrains Mono', monospace; font-size: 10px; }
        .m1-mkt-th {
          background: #f8fafc; border-bottom: 1.5px solid #d8e0ea;
          padding: 4px 6px; text-align: right;
          font-family: 'Inter', sans-serif; font-size: 9px; font-weight: 700;
          text-transform: uppercase; letter-spacing: 0.04em; color: #5b6b82; white-space: nowrap;
        }
        .m1-mkt-th:first-child { text-align: left; }
        .m1-mkt-td { padding: 3px 6px; text-align: right; border-bottom: 1px solid #f1f5f9; border-right: 1px solid #f1f5f9; white-space: nowrap; color: #102033; }
        .m1-mkt-td:first-child { text-align: left; }
        .m1-mkt-tr:hover { background: #f8fafc; }

        /* ── FLASH ANIMATIONS ──────────────────────── */
        @keyframes m1-up   { 0%,100%{color:inherit} 50%{color:#16a34a} }
        @keyframes m1-down { 0%,100%{color:inherit} 50%{color:#dc2626} }
        .fup   { animation: m1-up   0.4s ease; }
        .fdown { animation: m1-down 0.4s ease; }

        @keyframes m1-pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        .live-dot { animation: m1-pulse 1.4s ease infinite; }

        /* ── CHART AREA ────────────────────────────── */
        .m1-charts { display: grid; grid-template-columns: 1fr 1fr; gap: 0; background: #ffffff; flex-shrink: 0; border-top: 1.5px solid #d8e0ea; }
        .m1-chart-block { padding: 8px 8px 4px; border-right: 1px solid #e2e8f0; }
        .m1-chart-block:last-child { border-right: none; }
        .m1-chart-label { font-family: 'Inter', sans-serif; font-size: 9px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 4px; }
      `}</style>

      <div className="m1-root">

        {/* ── CONFIG PANEL ─────────────────────────────────────────────────── */}
        <div className="m1-cfg">

          {/* Live tickers */}
          <div className="m1-ticker">
            <span className="m1-lbl">SPOT</span>
            <span style={{ fontSize: 12, fontWeight: 800, color: spotFlash === "up" ? "#16a34a" : spotFlash === "down" ? "#dc2626" : "#102033" }}
              className={spotFlash ? (spotFlash === "up" ? "fup" : "fdown") : ""}>
              {fmtPrice(spotLtp)}
            </span>
            {spotFlash && <span style={{ fontSize: 9, color: spotFlash === "up" ? "#16a34a" : "#dc2626" }}>{spotFlash === "up" ? "▲" : "▼"}</span>}
          </div>

          <div className="m1-ticker">
            <span className="m1-lbl">FUT</span>
            <span style={{ fontSize: 12, fontWeight: 800, color: futFlash === "up" ? "#16a34a" : futFlash === "down" ? "#dc2626" : "#102033" }}
              className={futFlash ? (futFlash === "up" ? "fup" : "fdown") : ""}>
              {fmtPrice(futLtp)}
            </span>
            {spread !== 0 && (
              <span style={{ fontSize: 9, color: spread > 0 ? "#16a34a" : "#dc2626" }}>
                {spread > 0 ? "+" : ""}{spread.toFixed(1)}
              </span>
            )}
          </div>

          <div className="m1-divider" />

          <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <span className="m1-lbl">EXCH</span>
            <select className="m1-sel" value={cfgExchange} onChange={(e) => setCfgExchange(e.target.value)}>
              {["NSE", "BSE", "NFO", "BFO"].map((v) => <option key={v}>{v}</option>)}
            </select>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <span className="m1-lbl">INST</span>
            <select className="m1-sel" value={cfgInstrument} onChange={(e) => setCfgInstrument(e.target.value)}>
              {["OPTIDX", "OPTSTK", "FUTIDX", "FUTSTK"].map((v) => <option key={v}>{v}</option>)}
            </select>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <span className="m1-lbl">SYMBOL</span>
            <span style={{ fontSize: 12, fontWeight: 800, color: "#102033", padding: "3px 8px", background: "#f8fafc", border: "1.5px solid #d8e0ea", borderRadius: 4 }}>
              {selectedSymbol.replace("-FUT", "")}
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <span className="m1-lbl">TYPE</span>
            <select className="m1-sel" value={cfgOptionType} onChange={(e) => setCfgOptionType(e.target.value)}>
              {["CE", "PE", "CE+PE"].map((v) => <option key={v}>{v}</option>)}
            </select>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <span className="m1-lbl">STRIKE</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#102033", padding: "3px 8px", background: "#f8fafc", border: "1.5px solid #d8e0ea", borderRadius: 4, minWidth: 52 }}>
              {atmStrike > 0 ? atmStrike.toLocaleString() : "—"}
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <span className="m1-lbl">MKT</span>
            <select className="m1-sel" value={cfgMarketType} onChange={(e) => setCfgMarketType(e.target.value)}>
              {["REGULAR", "BLOCK"].map((v) => <option key={v}>{v}</option>)}
            </select>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <span className="m1-lbl">INTERVAL</span>
            {["1m", "3m", "5m"].map((tf) => (
              <button key={tf} className={`m1-tf${selectedTimeframe === tf ? " on" : ""}`}
                onClick={() => setSelectedTimeframe(tf)}>
                {tf.toUpperCase()}
              </button>
            ))}
          </div>

          <button className="m1-get" onClick={() => refetchOhlc()}>GET STATISTICS</button>

          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
            <span className="live-dot" style={{ width: 7, height: 7, borderRadius: "50%", background: "#16a34a", display: "inline-block", boxShadow: "0 0 0 2px rgba(22,163,74,0.2)" }} />
            <span style={{ fontSize: 10, fontWeight: 700, color: "#16a34a" }}>LIVE</span>
            <span style={{ fontSize: 10, color: "#94a3b8", marginLeft: 4 }}>{selectedTimeframe.toUpperCase()} · {selectedSymbol}</span>
          </div>
        </div>

        {/* ── MAIN GRID ──────────────────────────────────────────────────────── */}
        <div className={`m1-grid${isSplit ? " split" : ""}`}>

          {/* ── LEFT: MATRIX + MARKET DATA + CHARTS ──────────────────────── */}
          <div className="m1-left">

            <div className="m1-hdr">
              <span style={{ color: "#102033" }}>CORE ANALYSIS MATRIX</span>
              <span style={{ color: "#94a3b8", fontWeight: 600 }}>
                C_MT = (C_High + C_Low + C_TL) / 3 &nbsp;·&nbsp; P_MT = (P_High + P_Low + P_TL) / 3
              </span>
            </div>

            {/* ── MATRIX ──────────────────────────────────────────────────── */}
            <div className="m1-matrix-wrap" style={{ maxHeight: isSplit ? 320 : undefined }}>
              <table className="m1-tbl">
                <colgroup>
                  <col style={{ width: "6%" }} />
                  <col style={{ width: "7%" }} /><col style={{ width: "7%" }} />
                  <col style={{ width: "7%" }} /><col style={{ width: "7%" }} />
                  <col style={{ width: "6%" }} /><col style={{ width: "6%" }} />
                  <col style={{ width: "6px" }} />
                  <col style={{ width: "7%" }} /><col style={{ width: "7%" }} />
                  <col style={{ width: "7%" }} /><col style={{ width: "7%" }} />
                  <col style={{ width: "6%" }} /><col style={{ width: "6%" }} />
                  <col style={{ width: "9%" }} />
                </colgroup>
                <thead>
                  <tr>
                    <th className="m1-th-grp" style={{ textAlign: "left", color: "#5b6b82" }}>TIME</th>
                    <th className="m1-th-grp" colSpan={6}
                      style={{ color: "#15803d", background: "#f0fdf4", borderLeft: "2px solid #86efac" }}>
                      CALL SIDE
                    </th>
                    <th className="m1-th-grp" style={{ width: 6, padding: 0, background: "#f5f7fa", borderRight: "2px solid #d8e0ea" }} />
                    <th className="m1-th-grp" colSpan={6}
                      style={{ color: "#991b1b", background: "#fff5f5", borderLeft: "2px solid #fca5a5" }}>
                      PUT SIDE
                    </th>
                    <th className="m1-th-grp" style={{ color: "#1d4ed8", background: "#eff6ff" }}>SIGNAL</th>
                  </tr>
                  <tr>
                    <th className="m1-th" style={{ textAlign: "left", paddingLeft: 8 }}>TIME</th>
                    <th className="m1-th" style={{ color: "#374151", borderLeft: "2px solid #86efac" }}>C_TL</th>
                    <th className="m1-th" style={{ color: "#2563eb" }}>C_MT</th>
                    <th className="m1-th" style={{ color: "#5b6b82" }}>C_High</th>
                    <th className="m1-th" style={{ color: "#5b6b82" }}>C_Low</th>
                    <th className="m1-th" style={{ color: "#1d4ed8" }}>C_Buy</th>
                    <th className="m1-th" style={{ color: "#c2410c" }}>C_Sell</th>
                    <th className="m1-th" style={{ width: 6, padding: 0, background: "#f5f7fa", borderRight: "2px solid #d8e0ea" }} />
                    <th className="m1-th" style={{ color: "#374151", borderLeft: "2px solid #fca5a5" }}>P_TL</th>
                    <th className="m1-th" style={{ color: "#be185d" }}>P_MT</th>
                    <th className="m1-th" style={{ color: "#5b6b82" }}>P_High</th>
                    <th className="m1-th" style={{ color: "#5b6b82" }}>P_Low</th>
                    <th className="m1-th" style={{ color: "#1d4ed8" }}>P_Buy</th>
                    <th className="m1-th" style={{ color: "#c2410c" }}>P_Sell</th>
                    <th className="m1-th" style={{ color: "#1d4ed8", textAlign: "center" }}>SIG</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr><td colSpan={15} style={{ textAlign: "center", padding: "40px 0", color: "#94a3b8", fontSize: 12 }}>
                      Loading market data…
                    </td></tr>
                  ) : matrixRows.length === 0 ? (
                    <tr><td colSpan={15} style={{ textAlign: "center", padding: "40px 0", color: "#94a3b8", fontSize: 12 }}>
                      Awaiting market data feed…
                    </td></tr>
                  ) : matrixRows.map((row, idx) => {
                    const cTl  = cellColor(row.c_tl,  row.c_mt,  "call-tl");
                    const pTl  = cellColor(row.p_tl,  row.p_mt,  "put-tl");
                    const cBuy = cellColor(row.c_buy,  row.c_tl,  "buy");
                    const cSll = cellColor(row.c_sell, row.c_tl,  "sell");
                    const pBuy = cellColor(row.p_buy,  row.p_tl,  "buy");
                    const pSll = cellColor(row.p_sell, row.p_tl,  "sell");
                    const inf  = cellColor(0, 0, "info");
                    const ss   = SIGNAL_STYLE[row.signal];

                    return (
                      <tr key={idx} className={`m1-tr${row.isLive ? " live" : ""}`}>
                        {/* TIME */}
                        <td className="m1-td" style={{ color: row.isLive ? "#15803d" : "#5b6b82", fontWeight: row.isLive ? 800 : 500 }}>
                          {row.isLive && (
                            <span className="live-dot" style={{ display: "inline-block", width: 5, height: 5, borderRadius: "50%", background: "#16a34a", marginRight: 4, verticalAlign: "middle" }} />
                          )}
                          {row.time}
                        </td>
                        {/* C_TL */}
                        <td className="m1-td" style={{ background: cTl.bg, color: cTl.text, fontWeight: cTl.fw, borderLeft: "2px solid #86efac" }}>
                          {fmtN(row.c_tl)}
                        </td>
                        {/* C_MT */}
                        <td className="m1-td" style={{ color: "#2563eb", fontWeight: 600 }}>
                          {fmtN(row.c_mt)}
                        </td>
                        {/* C_High */}
                        <td className="m1-td" style={{ color: inf.text }}>{fmtN(row.c_high)}</td>
                        {/* C_Low */}
                        <td className="m1-td" style={{ color: inf.text }}>{fmtN(row.c_low)}</td>
                        {/* C_Buy */}
                        <td className="m1-td" style={{ background: row.c_buy > 0 ? cBuy.bg : "transparent", color: row.c_buy > 0 ? cBuy.text : "#cbd5e1", fontWeight: row.c_buy > 0 ? 700 : 400 }}>
                          {fmtN(row.c_buy)}
                        </td>
                        {/* C_Sell */}
                        <td className="m1-td" style={{ background: row.c_sell < 0 ? cSll.bg : "transparent", color: row.c_sell < 0 ? cSll.text : "#cbd5e1", fontWeight: row.c_sell < 0 ? 700 : 400 }}>
                          {fmtN(row.c_sell)}
                        </td>
                        {/* SPACER */}
                        <td className="m1-td spc" />
                        {/* P_TL */}
                        <td className="m1-td" style={{ background: pTl.bg, color: pTl.text, fontWeight: pTl.fw, borderLeft: "2px solid #fca5a5" }}>
                          {fmtN(row.p_tl)}
                        </td>
                        {/* P_MT */}
                        <td className="m1-td" style={{ color: "#be185d", fontWeight: 600 }}>
                          {fmtN(row.p_mt)}
                        </td>
                        {/* P_High */}
                        <td className="m1-td" style={{ color: inf.text }}>{fmtN(row.p_high)}</td>
                        {/* P_Low */}
                        <td className="m1-td" style={{ color: inf.text }}>{fmtN(row.p_low)}</td>
                        {/* P_Buy */}
                        <td className="m1-td" style={{ background: row.p_buy > 0 ? pBuy.bg : "transparent", color: row.p_buy > 0 ? pBuy.text : "#cbd5e1", fontWeight: row.p_buy > 0 ? 700 : 400 }}>
                          {fmtN(row.p_buy)}
                        </td>
                        {/* P_Sell */}
                        <td className="m1-td" style={{ background: row.p_sell < 0 ? pSll.bg : "transparent", color: row.p_sell < 0 ? pSll.text : "#cbd5e1", fontWeight: row.p_sell < 0 ? 700 : 400 }}>
                          {fmtN(row.p_sell)}
                        </td>
                        {/* SIGNAL */}
                        <td className="m1-td" style={{ textAlign: "center" }}>
                          <span className="m1-sig-badge"
                            style={{ background: ss.bg, color: ss.text, borderColor: ss.border, boxShadow: row.isLive ? ss.shadow : "none" }}>
                            {row.signal === "STRONG_CALL_BUY" ? "S-C-BUY" :
                             row.signal === "STRONG_PUT_BUY"  ? "S-P-BUY" :
                             row.signal === "CALL_BUY"        ? "C-BUY"   :
                             row.signal === "PUT_BUY"         ? "P-BUY"   : "WAIT"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* ── MARKET DATA TABLE ─────────────────────────────────────────── */}
            {!isSplit && (
              <>
                <div className="m1-hdr">
                  <span style={{ color: "#102033" }}>LIVE MARKET DATA</span>
                  <span>VWAP · OHLC · VOLUME ANALYSIS</span>
                </div>
                <div style={{ overflowX: "auto", maxHeight: 192, background: "#ffffff" }}>
                  <table className="m1-mkt">
                    <thead>
                      <tr>
                        {["TIME", "VWAP", "OPEN", "CLOSE", "HIGH", "LOW", "START", "END", "DIFF VOL", "CUM VOL"].map((h) => (
                          <th key={h} className="m1-mkt-th">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {marketRows.length === 0 ? (
                        <tr><td colSpan={10} style={{ textAlign: "center", padding: "20px 0", color: "#94a3b8", fontSize: 11 }}>No market data</td></tr>
                      ) : marketRows.map((r, idx) => {
                        const closeUp = r.closeRate >= r.openRate;
                        const diffUp  = r.diffVolume >= 0;
                        return (
                          <tr key={idx} className="m1-mkt-tr">
                            <td className="m1-mkt-td" style={{ color: "#2563eb", fontWeight: 700 }}>{r.time}</td>
                            <td className="m1-mkt-td" style={{ color: "#7c3aed", fontWeight: 600 }}>{r.vwap.toFixed(1)}</td>
                            <td className="m1-mkt-td" style={{ color: "#5b6b82" }}>{r.openRate.toFixed(1)}</td>
                            <td className="m1-mkt-td" style={{ color: closeUp ? "#15803d" : "#991b1b", fontWeight: 700 }}>{r.closeRate.toFixed(1)}</td>
                            <td className="m1-mkt-td" style={{ color: "#15803d" }}>{r.highRate.toFixed(1)}</td>
                            <td className="m1-mkt-td" style={{ color: "#991b1b" }}>{r.lowRate.toFixed(1)}</td>
                            <td className="m1-mkt-td" style={{ color: "#94a3b8" }}>{r.startTime}</td>
                            <td className="m1-mkt-td" style={{ color: "#94a3b8" }}>{r.endTime}</td>
                            <td className="m1-mkt-td" style={{ color: diffUp ? "#1d4ed8" : "#c2410c", fontWeight: 600 }}>
                              {diffUp ? "+" : ""}{fmtN(r.diffVolume)}
                            </td>
                            <td className="m1-mkt-td" style={{ color: "#5b6b82" }}>{fmtN(r.cumVolume)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {/* ── CHARTS (secondary) ───────────────────────────────────────── */}
            {!isSplit && chartData.length > 0 && (
              <>
                <div className="m1-hdr">
                  <span style={{ color: "#102033" }}>CHARTS</span>
                  <span>PRICE vs MT · VOLUME</span>
                </div>
                <div className="m1-charts">
                  <div className="m1-chart-block">
                    <div className="m1-chart-label">Price vs C_MT</div>
                    <ResponsiveContainer width="100%" height={110}>
                      <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="time" tick={{ fill: "#94a3b8", fontSize: 8, fontFamily: "Inter" }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fill: "#94a3b8", fontSize: 8, fontFamily: "Inter" }} tickLine={false} axisLine={false} width={52} tickFormatter={(v) => v.toFixed(0)} />
                        <Tooltip contentStyle={{ background: "#fff", border: "1.5px solid #d8e0ea", borderRadius: 6, fontFamily: "Inter", fontSize: 10 }}
                          labelStyle={{ color: "#102033", fontWeight: 700 }} itemStyle={{ color: "#5b6b82" }} />
                        <Line type="monotone" dataKey="price" stroke="#2563eb" strokeWidth={1.5} dot={false} name="Price" />
                        <Line type="monotone" dataKey="mt"    stroke="#16a34a" strokeWidth={1.5} dot={false} name="C_MT" strokeDasharray="4 2" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="m1-chart-block">
                    <div className="m1-chart-label">Volume Analysis</div>
                    <ResponsiveContainer width="100%" height={110}>
                      <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="time" tick={{ fill: "#94a3b8", fontSize: 8, fontFamily: "Inter" }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fill: "#94a3b8", fontSize: 8, fontFamily: "Inter" }} tickLine={false} axisLine={false} width={52} tickFormatter={(v) => fmtN(v)} />
                        <Tooltip contentStyle={{ background: "#fff", border: "1.5px solid #d8e0ea", borderRadius: 6, fontFamily: "Inter", fontSize: 10 }}
                          labelStyle={{ color: "#102033", fontWeight: 700 }} itemStyle={{ color: "#5b6b82" }}
                          formatter={(v: any) => fmtN(v)} />
                        <Bar dataKey="volume" fill="#bfdbfe" name="Volume" radius={[2, 2, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* ── RIGHT: ATM + SIGNAL + ALERTS ─────────────────────────────── */}
          {!isSplit && (
            <div className="m1-right">

              {/* Current Signal Box */}
              <div style={{
                margin: "10px", padding: "12px",
                background: sigStyle.bg, border: `1.5px solid ${sigStyle.border}`,
                borderRadius: 8, boxShadow: sigStyle.shadow, textAlign: "center",
              }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: sigStyle.text, opacity: 0.75, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>
                  CURRENT SIGNAL
                </div>
                <div style={{ fontSize: 15, fontWeight: 900, color: sigStyle.text, letterSpacing: "0.04em", fontFamily: "Inter" }}>
                  {sigStyle.label}
                </div>
                {matrixRows[0] && (
                  <div style={{ marginTop: 6, display: "flex", justifyContent: "space-around", fontSize: 9, color: sigStyle.text, opacity: 0.7, fontFamily: "JetBrains Mono" }}>
                    <span>C_MT: {fmtN(matrixRows[0].c_mt)}</span>
                    <span>P_MT: {fmtN(matrixRows[0].p_mt)}</span>
                  </div>
                )}
              </div>

              {/* Signal Conditions */}
              <div className="m1-hdr"><span>SIGNAL CONDITIONS</span></div>
              <div style={{ padding: "6px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
                {[
                  { key: "CALL BUY",      ok: matrixRows[0] ? matrixRows[0].c_tl > matrixRows[0].c_mt && matrixRows[0].c_buy > 0     : false, desc: "C_TL > C_MT ∧ C_Buy > 0"    },
                  { key: "PUT BUY",       ok: matrixRows[0] ? matrixRows[0].p_tl > matrixRows[0].p_mt && matrixRows[0].p_buy > 0     : false, desc: "P_TL > P_MT ∧ P_Buy > 0"    },
                  { key: "STR CALL BUY", ok: currentSignal === "STRONG_CALL_BUY", desc: "+ C_Buy > C_Sell×1.5 ∧ Bullish" },
                  { key: "STR PUT BUY",  ok: currentSignal === "STRONG_PUT_BUY",  desc: "+ P_Buy > P_Sell×1.5 ∧ Bearish" },
                ].map(({ key, ok, desc }) => (
                  <div key={key} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0", borderBottom: "1px solid #f1f5f9" }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
                      background: ok ? "#16a34a" : "#e2e8f0", border: ok ? "1px solid #15803d" : "1px solid #cbd5e1" }} />
                    <span style={{ fontFamily: "Inter", fontWeight: 700, color: ok ? "#15803d" : "#94a3b8", minWidth: 80, fontSize: 9 }}>{key}</span>
                    <span style={{ fontFamily: "JetBrains Mono", color: "#c8d5e3", fontSize: 8 }}>{desc}</span>
                  </div>
                ))}
              </div>

              {/* ATM Strike Panel */}
              <div className="m1-hdr">
                <span>ATM STRIKE PANEL</span>
                <span style={{ color: "#102033", fontWeight: 800, fontFamily: "JetBrains Mono" }}>{fmtPrice(spotLtp)}</span>
              </div>
              <div className="m1-scroll" style={{ maxHeight: 190 }}>
                {atmStrike === 0 ? (
                  <div style={{ textAlign: "center", padding: "20px 0", color: "#94a3b8", fontSize: 11 }}>Awaiting spot price…</div>
                ) : atmLevels.map(({ label, strike, isAtm }) => (
                  <div key={label} className={`m1-atm-row${isAtm ? " atm" : ""}`}>
                    <span style={{ fontSize: 10, fontWeight: isAtm ? 800 : 600, color: isAtm ? "#15803d" : "#5b6b82" }}>{label}</span>
                    <span style={{ fontSize: 12, fontWeight: isAtm ? 900 : 700, color: isAtm ? "#102033" : "#5b6b82", fontFamily: "JetBrains Mono" }}>
                      {strike.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>

              {/* Alert Panel */}
              <div className="m1-hdr" style={{ marginTop: "auto" }}>
                <span>ALERTS</span>
                <span style={{ color: "#16a34a", fontWeight: 800 }}>{alertHistory.length} SIGNALS</span>
              </div>
              <div className="m1-scroll" style={{ flex: 1, minHeight: 0 }}>
                {alertHistory.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "20px 0", color: "#94a3b8", fontSize: 11 }}>No signals yet. Awaiting triggers…</div>
                ) : alertHistory.map((alert) => {
                  const as = SIGNAL_STYLE[alert.signal];
                  return (
                    <div key={alert.id} className="m1-alert-row">
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                        <span style={{ fontSize: 9, fontWeight: 800, color: as.text, background: as.bg, border: `1px solid ${as.border}`, padding: "2px 6px", borderRadius: 3 }}>
                          {as.label}
                        </span>
                        <span style={{ fontSize: 9, color: "#94a3b8" }}>{alert.time}</span>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 3, fontFamily: "JetBrains Mono", fontSize: 9 }}>
                        <span style={{ color: "#94a3b8" }}>STK: <span style={{ color: "#102033", fontWeight: 600 }}>{alert.strike}</span></span>
                        <span style={{ color: "#94a3b8" }}>LTP: <span style={{ color: "#2563eb", fontWeight: 700 }}>{fmtPrice(alert.ltp)}</span></span>
                        <span style={{ color: "#94a3b8" }}>MT: <span style={{ color: "#7c3aed", fontWeight: 600 }}>{fmtN(alert.mtValue)}</span></span>
                        <span style={{ color: "#94a3b8" }}>SL: <span style={{ color: "#991b1b" }}>{fmtPrice(alert.stopLoss)}</span></span>
                        <span style={{ color: "#94a3b8" }}>TGT: <span style={{ color: "#15803d" }}>{fmtPrice(alert.target)}</span></span>
                        <span style={{ color: "#94a3b8", fontSize: 8 }}>{alert.oiBuildUp}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default Module1;
