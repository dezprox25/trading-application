import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { createChart, CandlestickSeries, CrosshairMode } from "lightweight-charts";
import type { IChartApi, UTCTimestamp } from "lightweight-charts";
import { useStore } from "../store/useStore";
import { api } from "../utils/api";

// ── Types ─────────────────────────────────────────────────────────────────────

interface OHLCBar {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  symbol?: string;
  timeframe?: string;
}

interface Instrument {
  symbol: string;
  name?: string;
  exchange?: string;
  instrumentType?: string;
}

type ViewMode = "live" | "historical";

// ── Constants ─────────────────────────────────────────────────────────────────

const INTERVALS = [
  { label: "1m",  value: "1m"  },
  { label: "3m",  value: "3m"  },
  { label: "5m",  value: "5m"  },
  { label: "15m", value: "15m" },
  { label: "30m", value: "30m" },
  { label: "1h",  value: "1h"  },
  { label: "1d",  value: "1d"  },
];

const PLAY_SPEEDS = [
  { label: "0.5×", ms: 2000 },
  { label: "1×",   ms: 1000 },
  { label: "2×",   ms: 500  },
  { label: "5×",   ms: 200  },
];

const FALLBACK_INSTRUMENTS: Instrument[] = [
  { symbol: "NIFTY-SPOT",     name: "NIFTY 50",             exchange: "NSE", instrumentType: "INDEX"  },
  { symbol: "NIFTY-FUT",      name: "NIFTY FUTURES",        exchange: "NFO", instrumentType: "FUTIDX" },
  { symbol: "BANKNIFTY-SPOT", name: "BANK NIFTY",           exchange: "NSE", instrumentType: "INDEX"  },
  { symbol: "BANKNIFTY-FUT",  name: "BANKNIFTY FUTURES",    exchange: "NFO", instrumentType: "FUTIDX" },
  { symbol: "FINNIFTY-FUT",   name: "FINNIFTY FUTURES",     exchange: "NFO", instrumentType: "FUTIDX" },
  { symbol: "MIDCPNIFTY-FUT", name: "MIDCPNIFTY FUTURES",  exchange: "NFO", instrumentType: "FUTIDX" },
  { symbol: "SENSEX-SPOT",    name: "BSE SENSEX",           exchange: "BSE", instrumentType: "INDEX"  },
  { symbol: "RELIANCE",       name: "Reliance Industries",  exchange: "NSE", instrumentType: "EQ"     },
  { symbol: "TCS",            name: "Tata Consultancy",     exchange: "NSE", instrumentType: "EQ"     },
  { symbol: "INFY",           name: "Infosys Limited",      exchange: "NSE", instrumentType: "EQ"     },
  { symbol: "SBIN",           name: "State Bank of India",  exchange: "NSE", instrumentType: "EQ"     },
  { symbol: "HDFCBANK",       name: "HDFC Bank",            exchange: "NSE", instrumentType: "EQ"     },
  { symbol: "ICICIBANK",      name: "ICICI Bank",           exchange: "NSE", instrumentType: "EQ"     },
  { symbol: "WIPRO",          name: "Wipro Limited",        exchange: "NSE", instrumentType: "EQ"     },
  { symbol: "BAJFINANCE",     name: "Bajaj Finance",        exchange: "NSE", instrumentType: "EQ"     },
  { symbol: "AXISBANK",       name: "Axis Bank",            exchange: "NSE", instrumentType: "EQ"     },
  { symbol: "KOTAKBANK",      name: "Kotak Mahindra Bank",  exchange: "NSE", instrumentType: "EQ"     },
  { symbol: "HINDUNILVR",     name: "Hindustan Unilever",   exchange: "NSE", instrumentType: "EQ"     },
  { symbol: "ASIANPAINT",     name: "Asian Paints",         exchange: "NSE", instrumentType: "EQ"     },
  { symbol: "MARUTI",         name: "Maruti Suzuki India",  exchange: "NSE", instrumentType: "EQ"     },
  { symbol: "TATAMOTORS",     name: "Tata Motors",          exchange: "NSE", instrumentType: "EQ"     },
  { symbol: "LT",             name: "Larsen & Toubro",      exchange: "NSE", instrumentType: "EQ"     },
  { symbol: "SUNPHARMA",      name: "Sun Pharmaceutical",   exchange: "NSE", instrumentType: "EQ"     },
  { symbol: "TITAN",          name: "Titan Company",        exchange: "NSE", instrumentType: "EQ"     },
  { symbol: "ONGC",           name: "Oil & Natural Gas",    exchange: "NSE", instrumentType: "EQ"     },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const getToday = (): string => {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
};

const fmtTime = (ms: number): string => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

const fmtTimestamp = (ms: number): string => {
  const d = new Date(ms);
  return d.toLocaleString("en-IN", {
    year: "numeric", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
};

const fmtPrice = (v: number | undefined | null): string => {
  if (v === null || v === undefined) return "—";
  return v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const fmtVol = (v: number | undefined | null): string => {
  if (v === null || v === undefined) return "—";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toLocaleString("en-IN");
};

function normalizeInstrument(raw: Record<string, unknown>): Instrument {
  return {
    symbol: String(raw.symbol ?? raw.tradingSymbol ?? raw.trading_symbol ?? ""),
    name: String(raw.name ?? raw.companyName ?? raw.description ?? ""),
    exchange: String(raw.exchange ?? raw.exch ?? ""),
    instrumentType: String(raw.instrumentType ?? raw.instrument_type ?? raw.pGroup ?? ""),
  };
}

// ── Module 1: Market Data Explorer ───────────────────────────────────────────

export const Module1 = () => {
  // ── Mode & Controls ────────────────────────────────────────────────────────
  const [mode, setMode] = useState<ViewMode>("live");
  const [selectedDate, setSelectedDate] = useState(getToday());
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playSpeedMs, setPlaySpeedMs] = useState(1000);

  // ── Instrument Explorer ────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [exchangeFilter, setExchangeFilter] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState("ALL");

  // ── Store ──────────────────────────────────────────────────────────────────
  const selectedSymbol    = useStore((s) => s.selectedSymbol);
  const setSelectedSymbol = useStore((s) => s.setSelectedSymbol);
  const selectedTimeframe = useStore((s) => s.selectedTimeframe);
  const setSelectedTimeframe = useStore((s) => s.setSelectedTimeframe);
  const prices            = useStore((s) => s.prices);

  const liveLtp = prices[selectedSymbol]?.ltp ?? null;

  // ── Refs ───────────────────────────────────────────────────────────────────
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef          = useRef<IChartApi | null>(null);
  const seriesRef         = useRef<any>(null);
  const playTimerRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevLtpRef        = useRef<number | null>(null);
  const [ltpFlash, setLtpFlash] = useState<"up" | "down" | null>(null);

  // ── Data Queries ───────────────────────────────────────────────────────────

  const { data: rawInstruments } = useQuery<Instrument[]>({
    queryKey: ["instruments"],
    queryFn: async () => {
      try {
        const data = await api.get("/api/market/instruments");
        if (Array.isArray(data) && data.length > 0)
          return (data as Record<string, unknown>[]).map(normalizeInstrument);
      } catch {}
      return FALLBACK_INSTRUMENTS;
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const instruments = rawInstruments ?? FALLBACK_INSTRUMENTS;

  const { data: liveBars = [], isLoading: liveLoading } = useQuery<OHLCBar[]>({
    queryKey: ["ohlc-live", selectedSymbol, selectedTimeframe],
    queryFn: () => api.get(`/api/market/ohlc/${selectedSymbol}/${selectedTimeframe}?limit=200`),
    enabled: mode === "live" && !!selectedSymbol,
    refetchInterval: mode === "live" ? 10000 : false,
    staleTime: 5000,
  });

  const {
    data: histBars = [],
    isLoading: histLoading,
    isError: histError,
    refetch: refetchHist,
  } = useQuery<OHLCBar[]>({
    queryKey: ["ohlc-history", selectedSymbol, selectedTimeframe, selectedDate],
    queryFn: () =>
      api.get(`/api/market/ohlc-history/${selectedSymbol}/${selectedTimeframe}?date=${selectedDate}`),
    enabled: mode === "historical" && !!selectedSymbol && !!selectedDate,
    staleTime: 60 * 1000,
    retry: false,
  });

  // ── Derived Data ───────────────────────────────────────────────────────────

  const allCandles: OHLCBar[] = mode === "live" ? liveBars : histBars;
  const isLoading = mode === "live" ? liveLoading : histLoading;

  // Chart progressively reveals candles in historical mode (playback effect)
  const chartCandles: OHLCBar[] = useMemo(
    () => (mode === "historical" ? allCandles.slice(0, currentIndex + 1) : allCandles),
    [mode, allCandles, currentIndex],
  );

  // Merge live LTP into the latest candle close when in live mode
  const displayCandles = useMemo(() => {
    if (mode !== "live" || !liveLtp || chartCandles.length === 0) return chartCandles;
    const copy = [...chartCandles];
    copy[copy.length - 1] = { ...copy[copy.length - 1], close: liveLtp };
    return copy;
  }, [chartCandles, liveLtp, mode]);

  const selectedCandle: OHLCBar | null =
    mode === "historical"
      ? allCandles[currentIndex] ?? null
      : displayCandles.length > 0
      ? displayCandles[displayCandles.length - 1]
      : null;

  const priceChange =
    displayCandles.length > 1
      ? displayCandles[displayCandles.length - 1].close -
        displayCandles[displayCandles.length - 1].open
      : null;

  // Instrument explorer filters
  const exchanges = useMemo(() => {
    const s = new Set(instruments.map((i) => i.exchange).filter(Boolean) as string[]);
    return ["ALL", ...Array.from(s).sort()];
  }, [instruments]);
  const types = useMemo(() => {
    const s = new Set(instruments.map((i) => i.instrumentType).filter(Boolean) as string[]);
    return ["ALL", ...Array.from(s).sort()];
  }, [instruments]);
  const filteredInstruments = useMemo(() => {
    const q = search.toLowerCase().trim();
    return instruments.filter((inst) => {
      if (exchangeFilter !== "ALL" && inst.exchange !== exchangeFilter) return false;
      if (typeFilter !== "ALL" && inst.instrumentType !== typeFilter) return false;
      if (!q) return true;
      return inst.symbol.toLowerCase().includes(q) || (inst.name ?? "").toLowerCase().includes(q);
    });
  }, [instruments, search, exchangeFilter, typeFilter]);

  // ── Chart Initialisation (once, on mount) ──────────────────────────────────
  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { color: "#ffffff" },
        textColor: "#5b6b82",
        fontFamily: "'Inter', sans-serif",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "#f1f5f9" },
        horzLines: { color: "#f1f5f9" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "#2563eb", style: 1, labelBackgroundColor: "#2563eb" },
        horzLine: { color: "#2563eb", style: 1, labelBackgroundColor: "#2563eb" },
      },
      rightPriceScale: {
        borderColor: "#e2e8f0",
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        borderColor: "#e2e8f0",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 8,
        fixLeftEdge: false,
        fixRightEdge: false,
      },
      handleScroll: true,
      handleScale: true,
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#16a34a",
      downColor: "#dc2626",
      borderVisible: false,
      wickUpColor: "#16a34a",
      wickDownColor: "#dc2626",
    });

    chartRef.current = chart;
    seriesRef.current = series;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // ── Chart Data Update ──────────────────────────────────────────────────────
  useEffect(() => {
    const series = seriesRef.current;
    const chart  = chartRef.current;
    if (!series || !chart) return;

    if (displayCandles.length === 0) {
      series.setData([]);
      return;
    }

    const chartData = displayCandles
      .filter((b) => b.openTime > 0 && !isNaN(b.open) && !isNaN(b.close))
      .map((b) => ({
        time: Math.floor(b.openTime / 1000) as UTCTimestamp,
        open:  b.open,
        high:  b.high,
        low:   b.low,
        close: b.close,
      }));

    try {
      series.setData(chartData);
      // Scroll to end of data in live mode; keep position in historical
      if (mode === "live") chart.timeScale().scrollToRealTime();
    } catch {
      // Silently swallow out-of-order data errors during rapid updates
    }
  }, [displayCandles, mode]);

  // ── Reset index when candles reload ───────────────────────────────────────
  useEffect(() => {
    setCurrentIndex(allCandles.length > 0 ? allCandles.length - 1 : 0);
    setIsPlaying(false);
  }, [allCandles]);

  // ── Playback ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (playTimerRef.current) {
      clearInterval(playTimerRef.current);
      playTimerRef.current = null;
    }
    if (!isPlaying) return;

    playTimerRef.current = setInterval(() => {
      setCurrentIndex((prev) => {
        if (prev >= allCandles.length - 1) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, playSpeedMs);

    return () => {
      if (playTimerRef.current) clearInterval(playTimerRef.current);
    };
  }, [isPlaying, playSpeedMs, allCandles.length]);

  // ── LTP Flash ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (liveLtp !== null && prevLtpRef.current !== null && liveLtp !== prevLtpRef.current) {
      setLtpFlash(liveLtp > prevLtpRef.current ? "up" : "down");
      const t = setTimeout(() => setLtpFlash(null), 500);
      return () => clearTimeout(t);
    }
    if (liveLtp !== null) prevLtpRef.current = liveLtp;
  }, [liveLtp]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleModeSwitch = useCallback((m: ViewMode) => {
    setMode(m);
    setIsPlaying(false);
    setCurrentIndex(0);
  }, []);

  const handleStepForward = () =>
    setCurrentIndex((i) => Math.min(i + 1, allCandles.length - 1));

  const handleStepBackward = () =>
    setCurrentIndex((i) => Math.max(i - 1, 0));

  const handlePlayPause = () => setIsPlaying((p) => !p);

  const handleScrubber = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCurrentIndex(Number(e.target.value));
    setIsPlaying(false);
  };

  const handleTimeClick = (idx: number) => {
    setCurrentIndex(idx);
    setIsPlaying(false);
  };

  const handleSymbolSelect = (sym: string) => {
    setSelectedSymbol(sym);
    setIsPlaying(false);
    setCurrentIndex(0);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  const timeRef = useRef<HTMLDivElement>(null);

  // Auto-scroll time selector to active item
  useEffect(() => {
    if (!timeRef.current || mode !== "historical") return;
    const active = timeRef.current.querySelector(".ts-item.active") as HTMLElement | null;
    if (active) active.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [currentIndex, mode]);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600;700;800;900&display=swap');

        /* ── Root ───────────────────────────────────── */
        .m1-root {
          display: flex;
          flex-direction: column;
          height: calc(100vh - 60px);
          background: #f5f7fa;
          font-family: 'Inter', sans-serif;
          overflow: hidden;
        }

        /* ── Top Control Bar ────────────────────────── */
        .m1-ctrl {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 16px;
          background: #ffffff;
          border-bottom: 1.5px solid #d8e0ea;
          flex-shrink: 0;
          flex-wrap: wrap;
          box-shadow: 0 1px 4px rgba(15,32,51,0.05);
        }

        .m1-sym-tag {
          font-size: 16px;
          font-weight: 900;
          color: #102033;
          letter-spacing: -0.01em;
          margin-right: 4px;
        }

        .m1-ltp {
          font-family: 'JetBrains Mono', monospace;
          font-size: 15px;
          font-weight: 700;
          color: #102033;
          padding: 3px 10px;
          border-radius: 5px;
          background: #f8fafc;
          border: 1.5px solid #e2e8f0;
          transition: color 0.15s, background 0.15s;
        }
        .m1-ltp.up   { color: #16a34a; background: #f0fdf4; border-color: #bbf7d0; }
        .m1-ltp.down { color: #dc2626; background: #fef2f2; border-color: #fecaca; }

        .m1-chg {
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          font-weight: 700;
          padding: 2px 7px;
          border-radius: 4px;
        }
        .m1-chg.pos { color: #16a34a; background: #f0fdf4; }
        .m1-chg.neg { color: #dc2626; background: #fef2f2; }

        .m1-divider { width: 1px; height: 22px; background: #d8e0ea; margin: 0 2px; }

        /* ── Mode Toggle ────────────────────────────── */
        .m1-mode-grp {
          display: flex;
          border: 1.5px solid #d8e0ea;
          border-radius: 7px;
          overflow: hidden;
        }
        .m1-mode-btn {
          font-family: 'Inter', sans-serif;
          font-size: 11px;
          font-weight: 700;
          padding: 5px 14px;
          border: none;
          background: transparent;
          color: #5b6b82;
          cursor: pointer;
          transition: all 0.12s;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .m1-mode-btn.active { background: #102033; color: #ffffff; }
        .m1-mode-btn:not(.active):hover { background: #f1f5f9; }

        /* ── Interval Selector ──────────────────────── */
        .m1-tf-grp { display: flex; gap: 3px; }
        .m1-tf {
          font-family: 'Inter', sans-serif;
          font-size: 10px;
          font-weight: 700;
          padding: 5px 9px;
          border: 1.5px solid #d8e0ea;
          border-radius: 5px;
          background: transparent;
          color: #5b6b82;
          cursor: pointer;
          transition: all 0.12s;
          letter-spacing: 0.03em;
        }
        .m1-tf.active { background: #2563eb; border-color: #2563eb; color: #ffffff; }
        .m1-tf:not(.active):hover { border-color: #2563eb; color: #2563eb; }

        /* ── Date Picker ────────────────────────────── */
        .m1-date-lbl { font-size: 9px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.08em; }
        .m1-date-inp {
          font-family: 'Inter', sans-serif;
          font-size: 11px;
          font-weight: 600;
          padding: 5px 8px;
          border: 1.5px solid #d8e0ea;
          border-radius: 5px;
          background: #ffffff;
          color: #102033;
          cursor: pointer;
          outline: none;
        }
        .m1-date-inp:focus { border-color: #2563eb; }

        .m1-live-badge {
          margin-left: auto;
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-size: 10px;
          font-weight: 700;
          color: #16a34a;
          background: #f0fdf4;
          border: 1px solid #bbf7d0;
          padding: 4px 10px;
          border-radius: 20px;
        }
        .m1-live-dot {
          width: 6px; height: 6px;
          border-radius: 50%;
          background: #16a34a;
          animation: m1-pulse 1.4s ease infinite;
        }
        @keyframes m1-pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }

        /* ── Body ───────────────────────────────────── */
        .m1-body {
          display: grid;
          grid-template-columns: 1fr 280px;
          flex: 1;
          overflow: hidden;
          min-height: 0;
        }

        /* ── Left Panel ─────────────────────────────── */
        .m1-left {
          display: flex;
          flex-direction: column;
          border-right: 1.5px solid #d8e0ea;
          background: #ffffff;
          overflow: hidden;
          min-height: 0;
        }

        /* ── Chart ──────────────────────────────────── */
        .m1-chart-wrap {
          flex: 1;
          min-height: 0;
          position: relative;
        }
        .m1-chart-inner {
          position: absolute;
          inset: 0;
        }

        .m1-chart-empty {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100%;
          color: #94a3b8;
          font-size: 13px;
          font-weight: 500;
          flex-direction: column;
          gap: 8px;
        }

        /* ── OHLC Panel ─────────────────────────────── */
        .m1-ohlc {
          display: flex;
          align-items: stretch;
          border-top: 1.5px solid #d8e0ea;
          background: #f8fafc;
          flex-shrink: 0;
          padding: 0;
        }
        .m1-ohlc-cell {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 8px 6px;
          border-right: 1px solid #e2e8f0;
          gap: 2px;
        }
        .m1-ohlc-cell:last-child { border-right: none; }
        .m1-ohlc-key {
          font-size: 8px;
          font-weight: 700;
          color: #94a3b8;
          text-transform: uppercase;
          letter-spacing: 0.1em;
        }
        .m1-ohlc-val {
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          font-weight: 600;
          color: #102033;
          white-space: nowrap;
        }
        .m1-ohlc-val.green { color: #16a34a; }
        .m1-ohlc-val.red   { color: #dc2626; }
        .m1-ohlc-val.blue  { color: #2563eb; }
        .m1-ohlc-val.purple { color: #7c3aed; }

        /* ── Time Selector (historical) ─────────────── */
        .m1-times-wrap {
          border-top: 1.5px solid #d8e0ea;
          background: #f8fafc;
          flex-shrink: 0;
          overflow: hidden;
        }
        .m1-times-label {
          font-size: 8px;
          font-weight: 700;
          color: #94a3b8;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          padding: 4px 10px 2px;
        }
        .m1-times-scroll {
          display: flex;
          overflow-x: auto;
          padding: 0 8px 6px;
          gap: 4px;
          scrollbar-width: none;
        }
        .m1-times-scroll::-webkit-scrollbar { display: none; }

        .ts-item {
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          font-weight: 600;
          padding: 4px 8px;
          border: 1.5px solid #e2e8f0;
          border-radius: 4px;
          background: #ffffff;
          color: #5b6b82;
          cursor: pointer;
          white-space: nowrap;
          flex-shrink: 0;
          transition: all 0.1s;
        }
        .ts-item:hover { border-color: #2563eb; color: #2563eb; }
        .ts-item.active {
          background: #2563eb;
          border-color: #2563eb;
          color: #ffffff;
        }

        /* ── Playback Controls ──────────────────────── */
        .m1-playback {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          border-top: 1.5px solid #d8e0ea;
          background: #ffffff;
          flex-shrink: 0;
        }
        .m1-pb-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 30px;
          height: 30px;
          border: 1.5px solid #d8e0ea;
          border-radius: 6px;
          background: #f8fafc;
          color: #5b6b82;
          cursor: pointer;
          font-size: 13px;
          transition: all 0.12s;
          flex-shrink: 0;
        }
        .m1-pb-btn:hover { border-color: #2563eb; color: #2563eb; background: #eff6ff; }
        .m1-pb-btn.play  { background: #2563eb; border-color: #2563eb; color: #ffffff; width: 34px; height: 34px; }
        .m1-pb-btn.play:hover { background: #1d4ed8; }

        .m1-scrubber {
          flex: 1;
          accent-color: #2563eb;
          cursor: pointer;
          height: 4px;
        }

        .m1-pb-pos {
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          font-weight: 600;
          color: #5b6b82;
          white-space: nowrap;
          min-width: 60px;
        }

        .m1-speed-sel {
          font-family: 'Inter', sans-serif;
          font-size: 10px;
          font-weight: 700;
          padding: 4px 6px;
          border: 1.5px solid #d8e0ea;
          border-radius: 5px;
          background: #f8fafc;
          color: #5b6b82;
          cursor: pointer;
          outline: none;
        }

        /* ── Right Sidebar ──────────────────────────── */
        .m1-sidebar {
          display: flex;
          flex-direction: column;
          background: #f8fafc;
          overflow: hidden;
        }
        .m1-sb-hdr {
          padding: 10px 12px 8px;
          font-size: 9px;
          font-weight: 800;
          color: #5b6b82;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          border-bottom: 1.5px solid #d8e0ea;
          background: #ffffff;
          flex-shrink: 0;
        }
        .m1-sb-search-wrap {
          padding: 8px 8px 4px;
          flex-shrink: 0;
        }
        .m1-sb-search {
          width: 100%;
          box-sizing: border-box;
          padding: 7px 10px;
          border: 1.5px solid #d8e0ea;
          border-radius: 6px;
          background: #ffffff;
          font-family: 'Inter', sans-serif;
          font-size: 11px;
          color: #102033;
          outline: none;
          transition: border-color 0.15s;
        }
        .m1-sb-search::placeholder { color: #c8d5e3; }
        .m1-sb-search:focus { border-color: #2563eb; }
        .m1-sb-filters {
          display: flex;
          gap: 5px;
          padding: 0 8px 6px;
          flex-shrink: 0;
        }
        .m1-sb-filter {
          flex: 1;
          padding: 4px 5px;
          border: 1.5px solid #d8e0ea;
          border-radius: 5px;
          background: #ffffff;
          font-family: 'Inter', sans-serif;
          font-size: 10px;
          font-weight: 600;
          color: #5b6b82;
          cursor: pointer;
          outline: none;
        }
        .m1-sb-count {
          padding: 0 10px 5px;
          font-size: 9px;
          font-weight: 600;
          color: #94a3b8;
          flex-shrink: 0;
        }
        .m1-inst-list {
          flex: 1;
          overflow-y: auto;
        }
        .m1-inst-list::-webkit-scrollbar { width: 4px; }
        .m1-inst-list::-webkit-scrollbar-thumb { background: #d8e0ea; border-radius: 2px; }

        .m1-inst-item {
          display: flex;
          align-items: center;
          gap: 7px;
          padding: 8px 10px;
          cursor: pointer;
          border-bottom: 1px solid #f1f5f9;
          border-left: 3px solid transparent;
          transition: background 0.1s;
        }
        .m1-inst-item:hover { background: #f1f5f9; }
        .m1-inst-item.active { background: #eff6ff; border-left-color: #2563eb; }

        .m1-inst-info { flex: 1; min-width: 0; }
        .m1-inst-sym {
          font-size: 11px;
          font-weight: 700;
          color: #102033;
          font-family: 'JetBrains Mono', monospace;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .m1-inst-item.active .m1-inst-sym { color: #1d4ed8; }
        .m1-inst-name {
          font-size: 9px;
          font-weight: 500;
          color: #94a3b8;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          margin-top: 1px;
        }
        .m1-inst-exch {
          font-size: 8px;
          font-weight: 700;
          color: #5b6b82;
          background: #f1f5f9;
          border: 1px solid #e2e8f0;
          padding: 2px 4px;
          border-radius: 3px;
          flex-shrink: 0;
        }
        .m1-inst-item.active .m1-inst-exch {
          background: #dbeafe;
          border-color: #bfdbfe;
          color: #1d4ed8;
        }
        .m1-inst-empty {
          padding: 24px 12px;
          text-align: center;
          color: #94a3b8;
          font-size: 11px;
        }

        /* ── State messages ─────────────────────────── */
        .m1-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 10px;
          height: 100%;
          color: #94a3b8;
          font-size: 12px;
          text-align: center;
          padding: 20px;
        }
        .m1-state button {
          font-family: 'Inter', sans-serif;
          font-size: 11px;
          font-weight: 700;
          padding: 6px 16px;
          border: 1.5px solid #d8e0ea;
          border-radius: 6px;
          background: #fff;
          color: #5b6b82;
          cursor: pointer;
          margin-top: 4px;
        }
        .m1-state button:hover { border-color: #2563eb; color: #2563eb; }
      `}</style>

      <div className="m1-root">

        {/* ── TOP CONTROL BAR ──────────────────────────────────────────── */}
        <div className="m1-ctrl">

          {/* Symbol + LTP */}
          <span className="m1-sym-tag">{selectedSymbol}</span>
          {liveLtp !== null && (
            <span className={`m1-ltp${ltpFlash === "up" ? " up" : ltpFlash === "down" ? " down" : ""}`}>
              {fmtPrice(liveLtp)}
            </span>
          )}
          {priceChange !== null && priceChange !== 0 && (
            <span className={`m1-chg${priceChange > 0 ? " pos" : " neg"}`}>
              {priceChange > 0 ? "▲" : "▼"} {Math.abs(priceChange).toFixed(2)}
            </span>
          )}

          <div className="m1-divider" />

          {/* Mode Toggle */}
          <div className="m1-mode-grp">
            <button
              className={`m1-mode-btn${mode === "live" ? " active" : ""}`}
              onClick={() => handleModeSwitch("live")}
            >
              ◉ Live
            </button>
            <button
              className={`m1-mode-btn${mode === "historical" ? " active" : ""}`}
              onClick={() => handleModeSwitch("historical")}
            >
              ⏱ Historical
            </button>
          </div>

          <div className="m1-divider" />

          {/* Interval selector */}
          <div className="m1-tf-grp">
            {INTERVALS.map((iv) => (
              <button
                key={iv.value}
                className={`m1-tf${selectedTimeframe === iv.value ? " active" : ""}`}
                onClick={() => { setSelectedTimeframe(iv.value); setCurrentIndex(0); }}
              >
                {iv.label}
              </button>
            ))}
          </div>

          {/* Date picker (historical only) */}
          {mode === "historical" && (
            <>
              <div className="m1-divider" />
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span className="m1-date-lbl">Date</span>
                <input
                  type="date"
                  className="m1-date-inp"
                  value={selectedDate}
                  max={getToday()}
                  onChange={(e) => { setSelectedDate(e.target.value); setCurrentIndex(0); setIsPlaying(false); }}
                />
              </div>
            </>
          )}

          {/* Live indicator */}
          {mode === "live" && (
            <div className="m1-live-badge" style={{ marginLeft: "auto" }}>
              <span className="m1-live-dot" />
              LIVE
            </div>
          )}

          {/* Historical position badge */}
          {mode === "historical" && allCandles.length > 0 && (
            <div style={{ marginLeft: "auto", fontSize: 10, fontWeight: 700, color: "#5b6b82" }}>
              {selectedDate} · {allCandles.length} candles
            </div>
          )}
        </div>

        {/* ── BODY ─────────────────────────────────────────────────────── */}
        <div className="m1-body">

          {/* ── LEFT PANEL ────────────────────────────────────────────── */}
          <div className="m1-left">

            {/* Candlestick Chart */}
            <div className="m1-chart-wrap">
              <div className="m1-chart-inner" ref={chartContainerRef}>
                {isLoading && displayCandles.length === 0 && (
                  <div className="m1-chart-empty">
                    <div style={{ fontSize: 24, opacity: 0.3 }}>⏳</div>
                    <div>Loading candles for <strong>{selectedSymbol}</strong>…</div>
                  </div>
                )}
                {!isLoading && displayCandles.length === 0 && mode === "historical" && !histError && (
                  <div className="m1-chart-empty">
                    <div style={{ fontSize: 24, opacity: 0.3 }}>📅</div>
                    <div>No candles found for {selectedDate}.</div>
                    <div style={{ fontSize: 11, color: "#c8d5e3" }}>Try a different date or interval.</div>
                  </div>
                )}
                {histError && mode === "historical" && (
                  <div className="m1-chart-empty">
                    <div style={{ fontSize: 24, opacity: 0.3 }}>⚠️</div>
                    <div>Could not load historical data.</div>
                    <button style={{ fontFamily: "'Inter',sans-serif", fontSize: 11, fontWeight: 700, padding: "5px 14px", border: "1.5px solid #d8e0ea", borderRadius: 6, cursor: "pointer", background: "#fff", color: "#5b6b82", marginTop: 6 }} onClick={() => refetchHist()}>Retry</button>
                  </div>
                )}
                {!isLoading && displayCandles.length === 0 && mode === "live" && (
                  <div className="m1-chart-empty">
                    <div style={{ fontSize: 24, opacity: 0.3 }}>📡</div>
                    <div>Awaiting market data feed for <strong>{selectedSymbol}</strong>…</div>
                  </div>
                )}
              </div>
            </div>

            {/* OHLC Data Panel */}
            <div className="m1-ohlc">
              {[
                { key: "OPEN",      val: fmtPrice(selectedCandle?.open),   cls: "" },
                { key: "HIGH",      val: fmtPrice(selectedCandle?.high),   cls: "green" },
                { key: "LOW",       val: fmtPrice(selectedCandle?.low),    cls: "red" },
                { key: "CLOSE",     val: fmtPrice(selectedCandle?.close),  cls: priceChange !== null ? (priceChange >= 0 ? "green" : "red") : "" },
                { key: "VOLUME",    val: fmtVol(selectedCandle?.volume),   cls: "blue" },
                { key: "TIMESTAMP", val: selectedCandle ? fmtTimestamp(selectedCandle.openTime) : "—", cls: "purple" },
              ].map(({ key, val, cls }) => (
                <div key={key} className="m1-ohlc-cell">
                  <span className="m1-ohlc-key">{key}</span>
                  <span className={`m1-ohlc-val${cls ? ` ${cls}` : ""}`}>{val}</span>
                </div>
              ))}
            </div>

            {/* Time Selector (historical mode only) */}
            {mode === "historical" && allCandles.length > 0 && (
              <div className="m1-times-wrap">
                <div className="m1-times-label">Select Time</div>
                <div className="m1-times-scroll" ref={timeRef}>
                  {allCandles.map((bar, idx) => (
                    <div
                      key={bar.openTime}
                      className={`ts-item${idx === currentIndex ? " active" : ""}`}
                      onClick={() => handleTimeClick(idx)}
                    >
                      {fmtTime(bar.openTime)}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Playback Controls (historical mode only) */}
            {mode === "historical" && (
              <div className="m1-playback">
                {/* Step Backward */}
                <button className="m1-pb-btn" onClick={handleStepBackward} title="Step backward" disabled={currentIndex === 0}>
                  ⏮
                </button>

                {/* Play / Pause */}
                <button className={`m1-pb-btn play`} onClick={handlePlayPause} title={isPlaying ? "Pause" : "Play"}>
                  {isPlaying ? "⏸" : "▶"}
                </button>

                {/* Step Forward */}
                <button className="m1-pb-btn" onClick={handleStepForward} title="Step forward" disabled={currentIndex >= allCandles.length - 1}>
                  ⏭
                </button>

                {/* Scrubber */}
                <input
                  type="range"
                  className="m1-scrubber"
                  min={0}
                  max={Math.max(0, allCandles.length - 1)}
                  value={currentIndex}
                  onChange={handleScrubber}
                />

                {/* Position indicator */}
                <span className="m1-pb-pos">
                  {allCandles.length > 0
                    ? `${currentIndex + 1} / ${allCandles.length}`
                    : "0 / 0"}
                </span>

                {/* Speed selector */}
                <select
                  className="m1-speed-sel"
                  value={playSpeedMs}
                  onChange={(e) => setPlaySpeedMs(Number(e.target.value))}
                  title="Playback speed"
                >
                  {PLAY_SPEEDS.map((s) => (
                    <option key={s.ms} value={s.ms}>{s.label}</option>
                  ))}
                </select>

                {/* Time display */}
                {selectedCandle && (
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, fontWeight: 700, color: "#2563eb", minWidth: 40 }}>
                    {fmtTime(selectedCandle.openTime)}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* ── RIGHT SIDEBAR: Instrument Explorer ─────────────────────── */}
          <div className="m1-sidebar">
            <div className="m1-sb-hdr">Instrument Explorer</div>

            <div className="m1-sb-search-wrap">
              <input
                className="m1-sb-search"
                type="text"
                placeholder="Search symbol or name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <div className="m1-sb-filters">
              <select className="m1-sb-filter" value={exchangeFilter} onChange={(e) => setExchangeFilter(e.target.value)}>
                {exchanges.map((ex) => <option key={ex} value={ex}>{ex}</option>)}
              </select>
              <select className="m1-sb-filter" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                {types.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div className="m1-sb-count">{filteredInstruments.length} of {instruments.length} instruments</div>

            <div className="m1-inst-list">
              {filteredInstruments.length === 0 ? (
                <div className="m1-inst-empty">No instruments match your search.</div>
              ) : filteredInstruments.map((inst) => (
                <div
                  key={inst.symbol}
                  className={`m1-inst-item${inst.symbol === selectedSymbol ? " active" : ""}`}
                  onClick={() => handleSymbolSelect(inst.symbol)}
                >
                  <div className="m1-inst-info">
                    <div className="m1-inst-sym">{inst.symbol}</div>
                    {inst.name && <div className="m1-inst-name">{inst.name}</div>}
                  </div>
                  {inst.exchange && <div className="m1-inst-exch">{inst.exchange}</div>}
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </>
  );
};

export default Module1;
