import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useStore } from "../store/useStore";
import { api } from "../utils/api";
import { exportModule2ToExcel } from "../utils/excelModule2Export";
import { colorClassStyle } from "../modules/dashboard/cellColorRules";

const formatExpiryLabel = (dateStr: string): string => {
  try {
    const d = new Date(dateStr + "T00:00:00");
    const months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
    return `${String(d.getDate()).padStart(2,"0")}-${months[d.getMonth()]}-${d.getFullYear()}`;
  } catch {
    return dateStr;
  }
};

// ── ALL ORIGINAL LOGIC — UNTOUCHED ───────────────────────────────────────────

const parseStrikeSymbol = (symbol: string) => {
  const match = symbol.match(/(\d+)(CE|PE)$/);
  if (match) return { strikePrice: match[1], optionType: match[2] };
  return { strikePrice: symbol, optionType: "" };
};

const ensureFullStrikesData = (session: any) => {
  if (!session) return session;
  const nextSession = JSON.parse(JSON.stringify(session));
  if (!nextSession.strikes) nextSession.strikes = {};
  let currentSelected = [...nextSession.selectedStrikes];
  const maxAllowed = nextSession.sessionType === "mixed" ? 20 : 10;
  if (currentSelected.length > maxAllowed) currentSelected = currentSelected.slice(0, maxAllowed);
  nextSession.selectedStrikes = currentSelected;
  currentSelected.forEach((strike: string) => {
    if (!nextSession.strikes[strike]) {
      nextSession.strikes[strike] = { strike, dayOpen: 0, dayHigh: 0, dayLow: 0, grid: [], trendBadge: "FLAT", isDowntrendActive: false, isDeepLoss: false, pctChange: 0 };
    }
  });
  return nextSession;
};

// ── Design tokens ─────────────────────────────────────────────────────────────
const GREEN = "#047857";
const RED = "#E53935";
const AMBER = "#D97706";

// ── Shared sub-components ─────────────────────────────────────────────────────

function TrendBadge({ badge }: { badge: string }) {
  const cfg: Record<string, { label: string; color: string; bg: string; border: string; pulse?: boolean }> = {
    L_TO_H:   { label: "L→H ▲", color: GREEN, bg: "rgba(4,120,87,0.1)",   border: "rgba(4,120,87,0.25)" },
    H_TO_L:   { label: "H→L ▼", color: RED,   bg: "rgba(229,57,53,0.1)",  border: "rgba(229,57,53,0.25)", pulse: true },
    REVERSAL: { label: "REV ⚡", color: AMBER, bg: "rgba(217,119,6,0.1)",  border: "rgba(217,119,6,0.25)", pulse: true },
    FLAT:     { label: "FLAT",   color: "#64748b", bg: "rgba(100,116,139,0.08)", border: "rgba(100,116,139,0.2)" },
  };
  const c = cfg[badge] || cfg.FLAT;
  return (
    <span
      className={c.pulse ? "animate-pulse" : ""}
      style={{
        display: "inline-flex", alignItems: "center",
        padding: "2px 8px", borderRadius: 6,
        fontSize: 10, fontFamily: "'Inter', sans-serif",
        fontWeight: 700, letterSpacing: "0.03em",
        color: c.color, background: c.bg, border: `1px solid ${c.border}`,
      }}
    >
      {c.label}
    </span>
  );
}

function SegmentedControl<K extends string>({
  options, value, onChange, size = "sm",
}: {
  options: { key: K; label: string }[];
  value: K;
  onChange: (v: K) => void;
  size?: "sm" | "xs";
}) {
  return (
    <div style={{ display: "inline-flex", gap: 3, padding: 3, background: "var(--trading-bg)", border: "1.5px solid var(--trading-border)", borderRadius: 8 }}>
      {options.map((o) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          style={{
            padding: size === "xs" ? "4px 10px" : "6px 14px",
            borderRadius: 6, border: "none",
            fontFamily: "'Inter', sans-serif",
            fontSize: size === "xs" ? 11 : 12, fontWeight: 700,
            cursor: "pointer", transition: "all 0.15s",
            background: value === o.key ? GREEN : "transparent",
            color: value === o.key ? "#fff" : "var(--trading-text-muted)",
            boxShadow: value === o.key ? "0 1px 6px rgba(4,120,87,0.25)" : "none",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function SelectField({ label, value, onChange, options, disabled = false }: {
  label: string; value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontFamily: "'Inter', sans-serif", fontSize: 11, fontWeight: 600, color: "var(--trading-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
        {label}
      </label>
      <div style={{ position: "relative" }}>
        <select
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          style={{
            width: "100%", padding: "9px 32px 9px 12px",
            fontFamily: "'Inter', sans-serif", fontSize: 13, fontWeight: 500,
            color: "var(--trading-text-active)", background: "var(--trading-bg)",
            border: "1.5px solid var(--trading-border)", borderRadius: 8,
            outline: "none", cursor: disabled ? "not-allowed" : "pointer",
            opacity: disabled ? 0.6 : 1, appearance: "none", WebkitAppearance: "none",
          }}
        >
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: GREEN, pointerEvents: "none", fontSize: 12 }}>▾</span>
      </div>
    </div>
  );
}

export const Module2 = ({ isSplit = false }: { isSplit?: boolean }) => {
  const activeSession = useStore((s) => s.activeSession);
  const setActiveSession = useStore((s) => s.setActiveSession);
  const module2BrokerStatus = useStore((s) => s.module2BrokerStatus);
  const [isConfigExpanded, setIsConfigExpanded] = useState(!isSplit);

  const [indexSymbol, setIndexSymbol] = useState("NIFTY50");
  const [expiryDate, setExpiryDate] = useState("");
  const [sessionType, setSessionType] = useState<"CE" | "PE" | "mixed">("mixed");
  const [selectedStrikes, setSelectedStrikes] = useState<string[]>([]);
  const [strikeWarning, setStrikeWarning] = useState<string | null>(null);

  const handleSessionTypeChange = (newType: "CE" | "PE" | "mixed") => {
    setSessionType(newType);
    setStrikeWarning(null);
    setSelectedStrikes((prev) => {
      if (newType === "CE") {
        return prev.filter((s) => s.toUpperCase().endsWith("CE")).slice(0, 10);
      }
      if (newType === "PE") {
        return prev.filter((s) => s.toUpperCase().endsWith("PE")).slice(0, 10);
      }
      return prev;
    });
  };

  // 1. Index Symbol Query (API-driven)
  const { data: indexesData, isLoading: isIndexesLoading, isError: isIndexesError } = useQuery({
    queryKey: ["module2-indexes"],
    queryFn: async () => {
      console.log("[MODULE2][CONFIG] Loading indexes");
      const res = await api.get("/api/module2/indexes");
      console.log("[MODULE2][CONFIG] Indexes received:", res?.indexes?.length || 0);
      return res;
    },
    staleTime: 60 * 60 * 1000,
  });

  const indexOptions: { value: string; label: string }[] = isIndexesLoading
    ? [{ value: "", label: "Loading indexes…" }]
    : isIndexesError
    ? [{ value: "", label: "Error loading indexes" }]
    : (indexesData?.indexes || []).map((idx: { symbol: string; label: string }) => ({
        value: idx.symbol,
        label: idx.label,
      }));

  // Auto-set default index if current indexSymbol is invalid
  useEffect(() => {
    const available = indexesData?.indexes || [];
    if (available.length > 0) {
      if (!available.some((idx: any) => idx.symbol === indexSymbol)) {
        setIndexSymbol(available[0].symbol);
      }
    }
  }, [indexesData, indexSymbol]);

  // 2. Options Expiry Query (API-driven)
  const { data: expiriesData, isLoading: isExpiriesLoading, isError: isExpiriesError } = useQuery({
    queryKey: ["module2-expiries", indexSymbol],
    queryFn: async () => {
      console.log(`[MODULE2][CONFIG] Loading expiries for ${indexSymbol}`);
      const res = await api.get(`/api/module2/expiries?symbol=${indexSymbol}`);
      console.log("[MODULE2][CONFIG] Expiries received:", res?.expiries?.length || 0);
      return res;
    },
    enabled: !!indexSymbol,
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });

  const expiryOptions: { value: string; label: string }[] = isExpiriesLoading
    ? [{ value: "", label: "Loading expiries…" }]
    : isExpiriesError
    ? [{ value: "", label: "Error loading expiries" }]
    : (expiriesData?.expiries || []).length === 0
    ? [{ value: "", label: "No expiries available" }]
    : (expiriesData?.expiries || []).map((date: string) => ({
        value: date,
        label: formatExpiryLabel(date),
      }));

  // When Index changes, reset expiry and selected strikes
  useEffect(() => {
    setExpiryDate("");
    setSelectedStrikes([]);
    setStrikeWarning(null);
  }, [indexSymbol]);

  // Auto-select first API-provided expiry when expiries list updates
  useEffect(() => {
    const expiries: string[] = expiriesData?.expiries || [];
    if (expiries.length > 0) {
      if (!expiryDate || !expiries.includes(expiryDate)) {
        setExpiryDate(expiries[0]);
      }
    } else {
      setExpiryDate("");
    }
  }, [expiriesData]);

  // When Expiry changes, clear previously selected strikes
  useEffect(() => {
    setSelectedStrikes([]);
    setStrikeWarning(null);
  }, [expiryDate]);

  // 3. Option Chain / Strikes Query (API-driven)
  const { data: chainData, isLoading: isStrikesLoading, isError: isStrikesError } = useQuery({
    queryKey: ["module2-option-chain", indexSymbol, expiryDate],
    queryFn: async () => {
      console.log(`[MODULE2][CONFIG] Loading option contracts for ${indexSymbol} @ ${expiryDate}`);
      const res = await api.get(`/api/module2/option-chain?symbol=${indexSymbol}&expiry=${expiryDate}`);
      
      const strikes = res?.strikes || [];
      let ceCount = 0;
      let peCount = 0;
      strikes.forEach((s: any) => {
        if (s.CE) ceCount++;
        if (s.PE) peCount++;
      });

      console.log(`[MODULE2][CONFIG] Contracts received: ${strikes.length}`);
      console.log(`[MODULE2][CONFIG] Available strikes: ${strikes.length}`);
      console.log(`[MODULE2][CONFIG] CE contracts: ${ceCount}`);
      console.log(`[MODULE2][CONFIG] PE contracts: ${peCount}`);

      return res;
    },
    enabled: !!indexSymbol && !!expiryDate,
    retry: 1,
  });

  // Session Start Mutation with strict contract validation
  const startSessionMutation = useMutation({
    mutationFn: async () => {
      console.log("[MODULE2][TRACKER] Start button clicked");
      console.log("[MODULE2][TRACKER] selected index:", indexSymbol);
      console.log("[MODULE2][TRACKER] expiry:", expiryDate);
      console.log("[MODULE2][TRACKER] session type:", sessionType);
      console.log("[MODULE2][TRACKER] selected strikes:", selectedStrikes);

      // Validate contract limits (max 10 CE, max 10 PE, max 20 total)
      const ceCount = selectedStrikes.filter((st) => st.toUpperCase().endsWith("CE")).length;
      const peCount = selectedStrikes.filter((st) => st.toUpperCase().endsWith("PE")).length;

      if (selectedStrikes.length > 20) {
        const msg = "Validation Error: Cannot select more than 20 total option contracts.";
        console.error("[MODULE2][CONFIG]", msg);
        alert(msg);
        throw new Error(msg);
      }
      if (ceCount > 10) {
        const msg = "Validation Error: Cannot select more than 10 Call (CE) strikes.";
        console.error("[MODULE2][CONFIG]", msg);
        alert(msg);
        throw new Error(msg);
      }
      if (peCount > 10) {
        const msg = "Validation Error: Cannot select more than 10 Put (PE) strikes.";
        console.error("[MODULE2][CONFIG]", msg);
        alert(msg);
        throw new Error(msg);
      }

      // Validate that every selected strike contract actually exists in the API response
      const validContractSymbols = new Set<string>();
      (chainData?.strikes || []).forEach((s: any) => {
        if (s.CE) validContractSymbols.add(s.CE);
        if (s.PE) validContractSymbols.add(s.PE);
      });

      const invalidStrikes = selectedStrikes.filter((st) => !validContractSymbols.has(st));
      if (invalidStrikes.length > 0) {
        const msg = `Validation Error: Contract(s) ${invalidStrikes.join(", ")} do not exist in the API instrument data.`;
        console.error("[MODULE2][CONFIG]", msg);
        alert(msg);
        throw new Error(msg);
      }

      console.log("[MODULE2][TRACKER] Starting tracker request to /api/module2/session/start");
      const res = await api.post("/api/module2/session/start", { sessionType, indexSymbol, expiryDate, selectedStrikes });
      console.log("[MODULE2][TRACKER] Response:", res);
      return res;
    },
    onSuccess: (data) => {
      console.log("[MODULE2][TRACKER] Mutation success, active session updated");
      setActiveSession(data);
    },
    onError: (error: any) => {
      console.error("[MODULE2][TRACKER] Request failed:", error?.message || error);
    }
  });

  // Session Stop Mutation with guaranteed local state reset
  const stopSessionMutation = useMutation({
    mutationFn: async () => {
      console.log("[MODULE2][TRACKER] Stop button clicked");
      const currentSessionId = activeSession?.sessionId;
      console.log(`[MODULE2][TRACKER] Stopping session=${currentSessionId || "unknown"}`);

      // Optimistically clear local session state immediately so UI updates instantly
      setActiveSession(null);
      setSelectedStrikes([]);
      setStrikeWarning(null);

      try {
        const res = await api.post("/api/module2/session/stop", { sessionId: currentSessionId });
        return res;
      } catch (err: any) {
        console.warn("[MODULE2][TRACKER] Stop network notice (state cleared locally):", err?.message || err);
        return { status: "success", message: "Session cleared locally" };
      }
    },
    onSuccess: () => {
      console.log("[MODULE2][TRACKER] Session stopped successfully");
      setActiveSession(null);
      setSelectedStrikes([]);
      setStrikeWarning(null);
    },
    onError: () => {
      setActiveSession(null);
      setSelectedStrikes([]);
      setStrikeWarning(null);
    }
  });

  const { data: marketStatus } = useQuery<{ status: "LIVE" | "CLOSED" }>({
    queryKey: ["market-status"],
    queryFn: () => api.get("/api/market/status"),
    refetchInterval: 15000,
  });

  const isClosed = marketStatus?.status === "CLOSED";

  const toggleStrikeSelection = (strike: string) => {
    setStrikeWarning(null);
    setSelectedStrikes((prev) => {
      if (prev.includes(strike)) return prev.filter((s) => s !== strike);
      const isCE = strike.toUpperCase().endsWith("CE");
      const isPE = strike.toUpperCase().endsWith("PE");
      const ceCount = prev.filter((s) => s.toUpperCase().endsWith("CE")).length;
      const peCount = prev.filter((s) => s.toUpperCase().endsWith("PE")).length;

      if (prev.length >= 20) {
        setStrikeWarning("Maximum limit of 20 total option contracts reached.");
        return prev;
      }
      if (isCE && ceCount >= 10) {
        setStrikeWarning("Maximum limit of 10 Call (CE) strikes reached.");
        return prev;
      }
      if (isPE && peCount >= 10) {
        setStrikeWarning("Maximum limit of 10 Put (PE) strikes reached.");
        return prev;
      }
      return [...prev, strike];
    });
  };

  const currentSession = activeSession ? ensureFullStrikesData(activeSession) : null;
  const sessionDataSource = currentSession?.dataSource || "UNAVAILABLE";
  const isLiveInteractive = sessionDataSource === "LIVE_INTERACTIVE_API";

  const sortedTimestamps = (() => {
    if (!currentSession?.strikes) return [];
    const tsSet = new Set<string>();
    Object.values(currentSession.strikes).forEach((s: any) => { s.grid.forEach((c: any) => { if (c.timestamp) tsSet.add(c.timestamp); }); });
    return Array.from(tsSet).sort();
  })();

  // All selected strikes are displayed always
  const allSelectedStrikes: string[] = currentSession?.selectedStrikes || [];
  const ceStrikesList = allSelectedStrikes.filter((s) => s.endsWith("CE"));
  const peStrikesList = allSelectedStrikes.filter((s) => s.endsWith("PE"));

  const handleExportExcel = async () => {
    if (!currentSession) return;
    try {
      await exportModule2ToExcel(currentSession, sortedTimestamps);
    } catch (err) {
      console.error("Excel export failed:", err);
    }
  };

  // ── RENDER ──────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');

        @keyframes m2-enter {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .m2-section { animation: m2-enter 0.35s ease both; }

        @keyframes m2-pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.03); opacity: 0.95; }
        }

        .m2-th {
          font-family: 'Inter', sans-serif; font-size: 16px; font-weight: 700;
          letter-spacing: 0.05em; text-transform: uppercase;
          padding: 12px 16px; white-space: nowrap;
          color: var(--trading-text-muted);
          background: var(--trading-bg);
          border-bottom: 1.5px solid var(--trading-border);
          position: sticky; top: 0; z-index: 2;
        }
        .m2-td {
          font-family: 'Inter', sans-serif; font-size: 24px;
          padding: 12px 16px; white-space: nowrap;
          border-bottom: 1px solid var(--trading-border);
          color: var(--trading-text-active);
        }
        .m2-tr:hover td:not(.m2-sticky-cell) { opacity: 0.95; }
        .m2-tr:hover .m2-sticky-cell {
          background-image: linear-gradient(rgba(4,120,87,0.03), rgba(4,120,87,0.03)) !important;
        }

        .m2-strike-chip {
          display: flex; flex-direction: column; align-items: center;
          padding: 8px 8px; border-radius: 8px; cursor: pointer;
          transition: all 0.15s; border: 1.5px solid var(--trading-border);
          background: var(--trading-bg);
        }
        .m2-strike-chip:hover { border-color: ${GREEN}; background: rgba(4,120,87,0.04); }

        .m2-ce-btn, .m2-pe-btn {
          flex: 1; padding: 6px 0; border-radius: 6px;
          font-family: 'Inter', sans-serif; font-size: 14px; font-weight: 700;
          cursor: pointer; transition: all 0.15s; border: 1.5px solid transparent;
        }
        .m2-ce-btn { color: ${GREEN}; background: rgba(4,120,87,0.08); border-color: rgba(4,120,87,0.2); }
        .m2-ce-btn:hover { background: rgba(4,120,87,0.14); }
        .m2-ce-btn.active { background: ${GREEN}; color: #fff; border-color: ${GREEN}; }
        .m2-pe-btn { color: ${RED}; background: rgba(229,57,53,0.08); border-color: rgba(229,57,53,0.2); }
        .m2-pe-btn:hover { background: rgba(229,57,53,0.14); }
        .m2-pe-btn.active { background: ${RED}; color: #fff; border-color: ${RED}; }

        .m2-cta {
          width: 100%; padding: 13px; border-radius: 8px;
          font-family: 'Inter', sans-serif; font-size: 14px; font-weight: 700;
          cursor: pointer; border: none; background: ${GREEN}; color: #fff;
          transition: all 0.2s; box-shadow: 0 4px 14px rgba(4,120,87,0.3);
        }
        .m2-cta:hover:not(:disabled) { opacity: 0.9; }
        .m2-cta:disabled { opacity: 0.45; cursor: not-allowed; }

        .m2-excel-btn {
          display: inline-flex; alignItems: center; gap: 6px;
          font-family: 'Inter', sans-serif; font-size: 12px; font-weight: 700;
          padding: 8px 16px; border-radius: 8px; cursor: pointer;
          border: 1.5px solid ${GREEN}; background: rgba(4,120,87,0.08);
          color: ${GREEN}; transition: all 0.15s;
        }
        .m2-excel-btn:hover:not(:disabled) { background: ${GREEN}; color: #fff; }
        .m2-excel-btn:disabled { opacity: 0.45; cursor: not-allowed; }
      `}</style>

      <div style={{ minHeight: isSplit ? "auto" : "100vh", background: isSplit ? "transparent" : "var(--trading-bg)", fontFamily: "'Inter', sans-serif" }}>
        <div style={{ maxWidth: "100%", margin: "0 auto", padding: isSplit ? "12px 12px 20px" : "24px 24px 40px", display: "flex", flexDirection: "column", gap: isSplit ? 12 : 20 }}>

          {/* Header */}
          {isSplit ? (
            <div
              className="m2-section"
              style={{
                background: "var(--trading-surface)",
                border: "1.5px solid var(--trading-border)",
                borderRadius: 10,
                padding: "10px 16px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: GREEN, textTransform: "uppercase", letterSpacing: "0.05em" }}>M2 · Strike Tracker</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--trading-text-active)", borderLeft: "1px solid var(--trading-border)", paddingLeft: 8 }}>
                  {currentSession?.indexSymbol || indexSymbol} · {currentSession?.expiryDate || expiryDate}
                </span>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {activeSession && isLiveInteractive && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 5, background: "rgba(4,120,87,0.1)", fontSize: 11, fontWeight: 700, color: GREEN }}>
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: GREEN }} />
                    Live API
                  </span>
                )}
                <button
                  className="m2-excel-btn"
                  onClick={handleExportExcel}
                  disabled={!currentSession || !allSelectedStrikes.length}
                >
                  Export Excel
                </button>
              </div>
            </div>
          ) : (
            <div
              className="m2-section"
              style={{
                background: "var(--trading-surface)", border: "1.5px solid var(--trading-border)",
                borderRadius: 14, padding: "18px 24px",
                display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12,
                boxShadow: "0 1px 8px rgba(0,0,0,0.05)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: GREEN, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 2 }}>
                    Module 02
                  </div>
                  <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: "var(--trading-text-active)", letterSpacing: "-0.0em" }}>
                    Strike Tracker
                  </h1>
                </div>
                <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 12, fontWeight: 600, color: "var(--trading-text-muted)", background: "var(--trading-bg)", padding: "3px 10px", borderRadius: 6, border: "1.5px solid var(--trading-border)" }}>
                  {currentSession?.indexSymbol || indexSymbol} · {currentSession?.expiryDate || expiryDate}
                </span>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {activeSession && isLiveInteractive && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 8, background: "rgba(4,120,87,0.1)", border: "1.5px solid rgba(4,120,87,0.25)", fontSize: 12, fontWeight: 700, color: GREEN }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: GREEN, display: "inline-block" }} className="animate-pulse" />
                    Live Interactive API
                  </span>
                )}
                <button
                  className="m2-excel-btn"
                  onClick={handleExportExcel}
                  disabled={!currentSession || !allSelectedStrikes.length}
                >
                  Export Excel
                </button>
              </div>
            </div>
          )}

          {/* Broker status banner */}
          {module2BrokerStatus === "session-expired" && (
            <div className="m2-section" style={{ background: "rgba(239,68,68,0.08)", border: "1.5px solid rgba(239,68,68,0.3)", borderRadius: 10, padding: "12px 18px", display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 16 }}>⚠</span>
              <div>
                <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, fontWeight: 700, color: "#dc2626" }}>Broker Session Expired</div>
                <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 12, color: "#dc2626", opacity: 0.8, marginTop: 2 }}>Please reconnect from the Module 2 login page.</div>
              </div>
            </div>
          )}

          {(module2BrokerStatus === "broker-disconnected" || module2BrokerStatus === "reconnecting") && (
            <div className="m2-section animate-pulse" style={{ background: "rgba(217,119,6,0.08)", border: "1.5px solid rgba(217,119,6,0.3)", borderRadius: 10, padding: "12px 18px", display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 16 }}>↻</span>
              <div>
                <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, fontWeight: 700, color: "#d97706" }}>Disconnected</div>
                <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 12, color: "#d97706", opacity: 0.8, marginTop: 2 }}>Attempting to reconnect to broker…</div>
              </div>
            </div>
          )}

          {/* Configuration */}
          {isConfigExpanded ? (
            <div
              className="m2-section"
              style={{
                background: "var(--trading-surface)", border: "1.5px solid var(--trading-border)",
                borderRadius: 14, padding: "20px 24px",
                boxShadow: "0 1px 8px rgba(0,0,0,0.05)", animationDelay: "0.04s",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
                <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 11, fontWeight: 700, color: "var(--trading-text-muted)", textTransform: "uppercase", letterSpacing: "0.15em" }}>
                  Session Configuration
                </span>
                {isSplit && (
                  <button
                    onClick={() => setIsConfigExpanded(false)}
                    style={{
                      background: "rgba(4,120,87,0.08)", border: "none", color: GREEN,
                      fontWeight: 700, fontSize: 11, cursor: "pointer", padding: "4px 10px", borderRadius: 5
                    }}
                  >
                    Hide Config ▲
                  </button>
                )}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 20 }}>
                <SelectField
                  label="Index Symbol"
                  value={indexSymbol}
                  onChange={setIndexSymbol}
                  options={indexOptions}
                  disabled={isIndexesLoading || !!activeSession}
                />
                <SelectField
                  label="Options Expiry"
                  value={expiryDate}
                  onChange={setExpiryDate}
                  options={expiryOptions}
                  disabled={isExpiriesLoading || !indexSymbol || (expiriesData?.expiries || []).length === 0 || !!activeSession}
                />
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <label style={{ fontFamily: "'Inter', sans-serif", fontSize: 11, fontWeight: 600, color: "var(--trading-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    Session Type
                  </label>
                  <SegmentedControl
                    options={[{ key: "CE" as const, label: "CE" }, { key: "PE" as const, label: "PE" }, { key: "mixed" as const, label: "Mixed" }]}
                    value={sessionType} onChange={handleSessionTypeChange}
                  />
                </div>
              </div>

              {/* Dynamic Strike Selection */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 14, fontWeight: 700, color: "var(--trading-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    Select Strikes
                  </span>
                  <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, fontWeight: 600, color: "var(--trading-text-muted)" }}>
                    {sessionType === "mixed"
                      ? `CE: ${selectedStrikes.filter((s) => s.toUpperCase().endsWith("CE")).length}/10 · PE: ${selectedStrikes.filter((s) => s.toUpperCase().endsWith("PE")).length}/10 (Total: ${selectedStrikes.length}/20)`
                      : sessionType === "CE"
                      ? `CE: ${selectedStrikes.filter((s) => s.toUpperCase().endsWith("CE")).length}/10 selected`
                      : `PE: ${selectedStrikes.filter((s) => s.toUpperCase().endsWith("PE")).length}/10 selected`}
                  </span>
                </div>

                {strikeWarning && (
                  <div
                    style={{
                      marginBottom: 10,
                      padding: "8px 12px",
                      borderRadius: 6,
                      background: "rgba(229, 57, 53, 0.1)",
                      border: "1px solid rgba(229, 57, 53, 0.3)",
                      color: "#e53935",
                      fontSize: 13,
                      fontWeight: 600,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <span>⚠️ {strikeWarning}</span>
                    <button
                      onClick={() => setStrikeWarning(null)}
                      style={{
                        background: "none",
                        border: "none",
                        color: "#e53935",
                        cursor: "pointer",
                        fontSize: 16,
                        lineHeight: 1,
                        padding: "0 4px",
                      }}
                      title="Dismiss"
                    >
                      ×
                    </button>
                  </div>
                )}

                {!expiryDate ? (
                  <div style={{ padding: "16px", textAlign: "center", fontFamily: "'Inter', sans-serif", fontSize: 14, color: "var(--trading-text-muted)", background: "var(--trading-bg)", border: "1.5px dashed var(--trading-border)", borderRadius: 8 }}>
                    Please select an available expiry date to load option contracts.
                  </div>
                ) : isStrikesLoading ? (
                  <div style={{ padding: "16px", textAlign: "center", fontFamily: "'Inter', sans-serif", fontSize: 14, color: "var(--trading-text-muted)", background: "var(--trading-bg)", border: "1.5px dashed var(--trading-border)", borderRadius: 8 }}>
                    Loading option contracts from API…
                  </div>
                ) : isStrikesError ? (
                  <div style={{ padding: "16px", textAlign: "center", fontFamily: "'Inter', sans-serif", fontSize: 14, color: "#dc2626", background: "rgba(229,57,53,0.06)", border: "1.5px solid rgba(229,57,53,0.2)", borderRadius: 8, fontWeight: 600 }}>
                    Unable to load market data. Please try again.
                  </div>
                ) : (chainData?.strikes || []).length === 0 ? (
                  <div style={{ padding: "16px", textAlign: "center", fontFamily: "'Inter', sans-serif", fontSize: 14, color: "var(--trading-text-muted)", background: "var(--trading-bg)", border: "1.5px dashed var(--trading-border)", borderRadius: 8 }}>
                    No option contracts available for this expiry.
                  </div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 8, maxHeight: 200, overflowY: "auto", paddingRight: 4 }}>
                    {(chainData?.strikes || []).map((s: any) => {
                      const ceSymbol = s.CE;
                      const peSymbol = s.PE;
                      const ceSelected = ceSymbol && selectedStrikes.includes(ceSymbol);
                      const peSelected = peSymbol && selectedStrikes.includes(peSymbol);

                      return (
                        <div key={s.strikePrice} className="m2-strike-chip">
                          <span style={{ fontFamily: "'Inter', sans-serif", fontSize: "24px", fontWeight: 800, color: "var(--trading-text-active)", marginBottom: 6 }}>{s.strikePrice}</span>
                          <div style={{ display: "flex", gap: 4, width: "100%" }}>
                            {sessionType !== "PE" && ceSymbol && (
                              <button onClick={() => toggleStrikeSelection(ceSymbol)} className={`m2-ce-btn${ceSelected ? " active" : ""}`}>CE</button>
                            )}
                            {sessionType !== "CE" && peSymbol && (
                              <button onClick={() => toggleStrikeSelection(peSymbol)} className={`m2-pe-btn${peSelected ? " active" : ""}`}>PE</button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {activeSession ? (
                <button
                  className="m2-stop-cta"
                  onClick={() => stopSessionMutation.mutate()}
                  disabled={stopSessionMutation.isPending}
                  style={{
                    width: "100%", padding: 13, borderRadius: 8,
                    fontFamily: "'Inter', sans-serif", fontSize: 14, fontWeight: 700,
                    cursor: stopSessionMutation.isPending ? "not-allowed" : "pointer",
                    border: "none", background: RED, color: "#fff",
                    transition: "all 0.2s", boxShadow: "0 4px 14px rgba(229,57,53,0.3)",
                    opacity: stopSessionMutation.isPending ? 0.6 : 1,
                  }}
                >
                  {stopSessionMutation.isPending ? "Stopping Session…" : "Stop Active Session Tracker"}
                </button>
              ) : (
                <button
                  className="m2-cta"
                  onClick={() => startSessionMutation.mutate()}
                  disabled={selectedStrikes.length === 0 || !expiryDate || startSessionMutation.isPending}
                >
                  {startSessionMutation.isPending ? "Initialising Session…" : "Start Active Session Tracker"}
                </button>
              )}
            </div>
          ) : (
            isSplit && (
              <div
                className="m2-section"
                style={{
                  background: "var(--trading-surface)", border: "1.5px solid var(--trading-border)",
                  borderRadius: 10, padding: "10px 16px",
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.04)", cursor: "pointer",
                }}
                onClick={() => setIsConfigExpanded(true)}
              >
                <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 11, fontWeight: 700, color: "var(--trading-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  ⚙️ Configure Session & Strikes
                </span>
                <span style={{ color: GREEN, fontWeight: 700, fontSize: 11, background: "rgba(4,120,87,0.08)", padding: "4px 10px", borderRadius: 5 }}>
                  Show Config ▼
                </span>
              </div>
            )
          )}

          {/* CE Table */}
          <div className="m2-section" style={{ animationDelay: "0.1s" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: GREEN, display: "inline-block" }} />
              <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 11, fontWeight: 700, color: GREEN, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                CE Strikes
              </span>
            </div>
            <StrikeTrackerTable strikesList={ceStrikesList} session={currentSession} sortedTimestamps={sortedTimestamps} isSplit={isSplit} isClosed={isClosed} />
          </div>

          {/* PE Table */}
          <div className="m2-section" style={{ animationDelay: "0.13s" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: RED, display: "inline-block" }} />
              <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 11, fontWeight: 700, color: RED, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                PE Strikes
              </span>
            </div>
            <StrikeTrackerTable strikesList={peStrikesList} session={currentSession} sortedTimestamps={sortedTimestamps} isSplit={isSplit} isClosed={isClosed} />
          </div>

        </div>
      </div>
    </>
  );
};

// ── StrikeTrackerTable ────────────────────────────────────────────────────────
function StrikeTrackerTable({ strikesList, session, sortedTimestamps, isSplit = false, isClosed = false }: {
  strikesList: string[]; session: any; sortedTimestamps: string[];
  isSplit?: boolean; isClosed?: boolean;
}) {
  const [showFullColumns, setShowFullColumns] = useState(false);
  const cellPadding = isSplit ? "10px 12px" : "12px 16px";
  const cellFontSize = "24px";

  const displayedTimestamps = showFullColumns || !isSplit
    ? sortedTimestamps
    : sortedTimestamps.slice(-5);

  const displayedStrikes = showFullColumns || !isSplit
    ? strikesList
    : strikesList.slice(0, 5);

  // High column Min & Max across displayed strikes
  const highValues: number[] = [];
  displayedStrikes.forEach((strike) => {
    const s = session?.strikes?.[strike];
    if (s && typeof s.dayHigh === "number" && !isNaN(s.dayHigh) && s.dayHigh > 0) {
      highValues.push(s.dayHigh);
    }
  });
  const highMax = highValues.length > 0 ? Math.max(...highValues) : null;
  const highMin = highValues.length > 0 ? Math.min(...highValues) : null;

  // Low column Min & Max across displayed strikes
  const lowValues: number[] = [];
  displayedStrikes.forEach((strike) => {
    const s = session?.strikes?.[strike];
    if (s && typeof s.dayLow === "number" && !isNaN(s.dayLow) && s.dayLow > 0) {
      lowValues.push(s.dayLow);
    }
  });
  const lowMax = lowValues.length > 0 ? Math.max(...lowValues) : null;
  const lowMin = lowValues.length > 0 ? Math.min(...lowValues) : null;

  return (
    <div
      style={{
        background: "var(--trading-surface)", border: "1.5px solid var(--trading-border)",
        borderRadius: 12, overflow: "hidden",
        boxShadow: "0 1px 8px rgba(0,0,0,0.05)",
      }}
    >
      <div style={{ overflowX: "auto", overflowY: "visible" }}>
        <table style={{ 
          width: "100%", 
          minWidth: isSplit && showFullColumns ? "1450px" : "100%", 
          borderCollapse: "collapse", 
          textAlign: "left" 
        }}>
          <thead>
            <tr>
              <th className="m2-th" style={{ padding: cellPadding, fontSize: "16px", textAlign: "center", width: 60, minWidth: 55, position: "sticky", left: 0, top: 0, zIndex: 40, borderRight: "1px solid var(--trading-border)", background: "var(--trading-bg)" }}>S.No.</th>
              <th className="m2-th" style={{ padding: cellPadding, fontSize: "18px", minWidth: isSplit ? 200 : 260, position: "sticky", left: 60, top: 0, zIndex: 40, borderRight: "3px solid var(--trading-border)", background: "var(--trading-bg)" }}>Strike</th>
              {displayedTimestamps.map((ts) => (
                <th key={ts} className="m2-th" style={{ padding: cellPadding, fontSize: "18px", textAlign: "center", minWidth: isSplit ? 90 : 110 }}>{ts}</th>
              ))}
              {(!isSplit || showFullColumns) && (
                <th className="m2-th" style={{ padding: cellPadding, fontSize: "18px", textAlign: "center", minWidth: 110, width: 110, borderLeft: "3px solid var(--trading-border)", position: "sticky", right: 110, top: 0, zIndex: 40, background: "var(--trading-bg)" }}>High</th>
              )}
              {(!isSplit || showFullColumns) && (
                <th className="m2-th" style={{ padding: cellPadding, fontSize: "18px", textAlign: "center", minWidth: 110, width: 110, position: "sticky", right: 0, top: 0, zIndex: 40, background: "var(--trading-bg)" }}>Low</th>
              )}
            </tr>
          </thead>
          <tbody>
            {isClosed ? (
              <tr>
                <td colSpan={displayedTimestamps.length + (isSplit && !showFullColumns ? 2 : 4)} style={{ padding: "48px 16px", textAlign: "center", fontFamily: "'Inter', sans-serif", fontSize: 24, color: "#E53935", fontWeight: 700 }}>
                  Market Closed
                </td>
              </tr>
            ) : displayedStrikes.length === 0 ? (
              <tr>
                <td colSpan={displayedTimestamps.length + (isSplit && !showFullColumns ? 2 : 4)} style={{ padding: "32px 16px", textAlign: "center", fontFamily: "'Inter', sans-serif", fontSize: 24, color: "var(--trading-text-muted)" }}>
                  No strikes to display in this category.
                </td>
              </tr>
            ) : (
              displayedStrikes.map((strike, index) => {
                const s = session?.strikes?.[strike];
                if (!s) return null;
                const parsed = parseStrikeSymbol(strike);
                const isCE = parsed.optionType === "CE";

                const rowBg = s.isDeepLoss ? "rgba(107,114,128,0.08)" : s.isDowntrendActive ? "rgba(37, 99, 235, 0.08)" : "transparent";
                const stickyBg = s.isDeepLoss
                  ? "rgba(255,242,242,0.98)"
                  : s.isDowntrendActive
                  ? "rgba(255,251,235,0.98)"
                  : "var(--trading-surface)";

                const summaryBg = s.isDeepLoss
                  ? "rgba(255,242,242,0.98)"
                  : s.isDowntrendActive
                  ? "rgba(255,251,235,0.98)"
                  : "var(--trading-surface)";

                // Row-wise Min & Max calculation for timestamp/LTP cells in THIS specific strike row
                const rowLtps: number[] = [];
                displayedTimestamps.forEach((ts) => {
                  const cell = (s.grid || []).find((c: any) => c.timestamp === ts);
                  if (cell && typeof cell.ltp === "number" && !isNaN(cell.ltp) && cell.ltp > 0) {
                    rowLtps.push(cell.ltp);
                  }
                });

                const rowMax = rowLtps.length > 0 ? Math.max(...rowLtps) : null;
                const rowMin = rowLtps.length > 0 ? Math.min(...rowLtps) : null;
                const hasDistinctRowMinMax = rowMax !== null && rowMin !== null && rowMax !== rowMin;

                // High Column cell style using Module 1 color logic
                const isHighHighest = highMax !== null && highMin !== null && highMax !== highMin && s.dayHigh === highMax;
                const isHighLowest  = highMax !== null && highMin !== null && highMax !== highMin && s.dayHigh === highMin;
                const highColorClass = isHighHighest ? "blue" : isHighLowest ? "black" : null;
                const highStyle = highColorClass ? colorClassStyle(highColorClass, "hlc") : null;

                // Low Column cell style using Module 1 color logic
                const isLowHighest = lowMax !== null && lowMin !== null && lowMax !== lowMin && s.dayLow === lowMax;
                const isLowLowest  = lowMax !== null && lowMin !== null && lowMax !== lowMin && s.dayLow === lowMin;
                const lowColorClass = isLowHighest ? "blue" : isLowLowest ? "black" : null;
                const lowStyle = lowColorClass ? colorClassStyle(lowColorClass, "hlc") : null;

                return (
                  <tr
                    key={strike}
                    className={`m2-tr ${
                      s.isDeepLoss
                        ? "border-red-signal"
                        : s.trendBadge === "L_TO_H"
                        ? "border-green-signal"
                        : ""
                    } ${s.trendBadge === "REVERSAL" ? "animate-reversal-border" : ""}`}
                    style={{ background: rowBg }}
                  >
                    {/* Column 1: S.No. */}
                    <td
                      className="m2-td m2-sticky-cell"
                      style={{
                        padding: cellPadding,
                        fontSize: cellFontSize,
                        textAlign: "center",
                        fontWeight: 600,
                        color: "var(--trading-text-muted)",
                        position: "sticky",
                        left: 0,
                        zIndex: 20,
                        background: stickyBg,
                        borderRight: "1px solid var(--trading-border)",
                        width: 60,
                        minWidth: 55,
                      }}
                    >
                      {index + 1}
                    </td>

                    {/* Column 2: Sticky Strike cell */}
                    <td className="m2-td m2-sticky-cell" style={{ 
                      padding: cellPadding, 
                      fontSize: cellFontSize, 
                      position: "sticky", 
                      left: 60, 
                      zIndex: 20, 
                      background: stickyBg, 
                      borderRight: "3px solid var(--trading-border)", 
                      minWidth: isSplit ? 200 : 260 
                    }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: isSplit ? 2 : 5 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: isSplit ? 6 : 10 }}>
                          <span style={{ fontFamily: "'Inter', sans-serif", fontSize: "24px", fontWeight: 800, color: "var(--trading-text-active)" }}>{parsed.strikePrice}</span>
                          <span style={{
                            padding: isSplit ? "2px 6px" : "3px 8px", borderRadius: 4,
                            fontSize: "14px", fontWeight: 700, fontFamily: "'Inter', sans-serif",
                            color: isCE ? GREEN : RED,
                            background: isCE ? "rgba(4,120,87,0.1)" : "rgba(229,57,53,0.1)",
                            border: `1px solid ${isCE ? "rgba(4,120,87,0.25)" : "rgba(229,57,53,0.25)"}`,
                          }}>
                            {parsed.optionType}
                          </span>
                          <TrendBadge badge={s.trendBadge} />
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                          {s.isDeepLoss && (
                            <span className="animate-pulse" style={{ padding: "1px 5px", borderRadius: 4, fontFamily: "'Inter', sans-serif", fontSize: 11, fontWeight: 700, color: RED, background: "rgba(229,57,53,0.1)", border: "1px solid rgba(229,57,53,0.25)" }}>
                              Severe −15%
                            </span>
                          )}
                          {!s.isDeepLoss && s.isDowntrendActive && (
                            <span style={{ padding: "1px 5px", borderRadius: 4, fontFamily: "'Inter', sans-serif", fontSize: 11, fontWeight: 700, color: AMBER, background: "rgba(217,119,6,0.1)", border: "1px solid rgba(217,119,6,0.25)" }}>
                              Down 3m
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Minute columns with ROW-WISE cell-background color logic */}
                    {displayedTimestamps.map((ts) => {
                      const cell = (s.grid || []).find((c: any) => c.timestamp === ts);
                      if (!cell || typeof cell.ltp !== "number") return <td key={ts} className="m2-td" style={{ padding: cellPadding, fontSize: cellFontSize, textAlign: "center", color: "var(--trading-text-muted)" }}>—</td>;
                      
                      const isHighest = hasDistinctRowMinMax && cell.ltp === rowMax;
                      const isLowest  = hasDistinctRowMinMax && cell.ltp === rowMin;
                      const isLatestCell = ts === sortedTimestamps[sortedTimestamps.length - 1];

                      const colorClass = isHighest ? "blue" : isLowest ? "black" : null;
                      const cellStyle = colorClass ? colorClassStyle(colorClass, "light") : null;

                      return (
                        <td
                          key={ts}
                          className={`m2-td ${isLatestCell ? "animate-blue-live-pulse" : ""} ${
                            s.isDowntrendActive || s.isDeepLoss ? "bg-call-down-stripes" : ""
                          }`}
                          title={`${cell.timestamp} · ${cell.ltp}`}
                          style={{
                            padding: cellPadding,
                            fontSize: cellFontSize,
                            textAlign: "center",
                            background: cellStyle ? cellStyle.bg : undefined,
                            color: cellStyle ? cellStyle.textColor : "var(--trading-text-active)",
                            fontWeight: isHighest || isLowest ? 700 : 400,
                          }}
                        >
                          {cell.ltp}
                        </td>
                      );
                    })}

                    {/* High Column */}
                    {(!isSplit || showFullColumns) && (
                      <td className="m2-td m2-sticky-cell" style={{ 
                        padding: cellPadding, 
                        fontSize: cellFontSize, 
                        textAlign: "center", 
                        position: "sticky", 
                        right: 110, 
                        zIndex: 20, 
                        background: highStyle ? highStyle.bg : summaryBg, 
                        borderLeft: "3px solid var(--trading-border)", 
                        color: highStyle ? highStyle.textColor : "#2563EB", 
                        fontWeight: 700, 
                        minWidth: 110, 
                        width: 110 
                      }}>
                        {Math.round(s.dayHigh)}
                      </td>
                    )}

                    {/* Low Column */}
                    {(!isSplit || showFullColumns) && (
                      <td className="m2-td m2-sticky-cell" style={{ 
                        padding: cellPadding, 
                        fontSize: cellFontSize, 
                        textAlign: "center", 
                        position: "sticky", 
                        right: 0, 
                        zIndex: 20, 
                        background: lowStyle ? lowStyle.bg : summaryBg, 
                        color: lowStyle ? lowStyle.textColor : "#111827", 
                        fontWeight: 700, 
                        minWidth: 110, 
                        width: 110 
                      }}>
                        {Math.round(s.dayLow)}
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {isSplit && (
        <div style={{ padding: 8, borderTop: "1.5px solid var(--trading-border)", background: "var(--trading-surface)" }}>
          <button
            onClick={() => setShowFullColumns(!showFullColumns)}
            style={{
              width: "100%",
              padding: "6px 12px",
              borderRadius: 8,
              border: "1.5px solid var(--trading-border)",
              background: "var(--trading-surface)",
              color: "var(--trading-text-muted)",
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
              transition: "all 0.15s",
            }}
            className="secondary-btn"
          >
            {showFullColumns ? "Collapse to Compact View (5 Rows, 5 Ticks) ▲" : `Show All ${strikesList.length} Rows, Full Columns & All ${sortedTimestamps.length} Ticks ▼`}
          </button>
        </div>
      )}
    </div>
  );
}

export default Module2;
