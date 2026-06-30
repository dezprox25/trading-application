import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDashStore } from "./store";
import { useStore } from "../../store/useStore";
import {
  fetchExchanges, fetchInstruments, fetchSymbols, fetchStrikes,
} from "../../data/liveApi";

// ── Live price hook ───────────────────────────────────────────────────────────
// Reads directly from the socket tick cache (useStore.prices).
// Populates as soon as the first tick arrives after login — no Generate needed.

function useLivePrice(symbol: string): { ltp: number | null; dir: "up" | "down" | null } {
  const ltp = useStore((s) => s.prices[symbol]?.ltp ?? null);
  const prevRef = useRef<number | null>(null);
  const [dir, setDir] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    if (ltp === null) return;
    if (prevRef.current !== null) {
      if (ltp > prevRef.current) setDir("up");
      else if (ltp < prevRef.current) setDir("down");
      // Equal value: keep existing arrow — no state update
    }
    prevRef.current = ltp;
  }, [ltp]);

  return { ltp, dir };
}

// ── Expiry date helpers ───────────────────────────────────────────────────────

function getNextThursdays(count: number): string[] {
  const result: string[] = [];
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=Sun … 4=Thu
  const daysToThursday = day <= 4 ? 4 - day : 4 - day + 7;
  d.setDate(d.getDate() + daysToThursday);
  for (let i = 0; i < count; i++) {
    const dd  = String(d.getDate()).padStart(2, "0");
    const mmm = d.toLocaleString("en-US", { month: "short" }).toUpperCase();
    const yy  = String(d.getFullYear()).slice(-2);
    result.push(`${dd} ${mmm} ${yy}`);
    d.setDate(d.getDate() + 7);
  }
  return result;
}

const EXPIRY_DATES = getNextThursdays(7);

// ── Shared styles ─────────────────────────────────────────────────────────────

const SEL: React.CSSProperties = {
  fontFamily: "'Calibri','Segoe UI',system-ui,sans-serif",
  fontSize: 12,
  fontWeight: 600,
  color: "#1A2533",
  background: "#F3F6FA",
  border: "1px solid #BDC4CF",
  borderRadius: 3,
  padding: "3px 22px 3px 6px",
  height: 26,
  appearance: "none",
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%235B6B7F'/%3E%3C/svg%3E")`,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 6px center",
  cursor: "pointer",
  minWidth: 120,
};

const LABEL: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  color: "#5B6B7F",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  marginBottom: 2,
};

// ── Sub-components ────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <span style={LABEL}>{label}</span>
      {children}
    </div>
  );
}

function DirArrow({ dir }: { dir: "up" | "down" | null }) {
  if (dir === "up")   return <span style={{ color: "#16a34a", fontSize: 10, lineHeight: 1 }}>▲</span>;
  if (dir === "down") return <span style={{ color: "#dc2626", fontSize: 10, lineHeight: 1 }}>▼</span>;
  return null;
}

function LivePrice({ label, value, dir }: { label: string; value: number | null; dir: "up" | "down" | null }) {
  const formatted = value != null
    ? value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "—";

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <span style={LABEL}>{label}</span>
      <div style={{
        display: "flex", alignItems: "center", gap: 3, height: 26,
        padding: "0 8px",
        background: "#EEF4FB",
        border: "1px solid #BDC4CF",
        borderRadius: 3,
        minWidth: 88,
      }}>
        <span style={{
          fontFamily: "'Calibri','Segoe UI',system-ui,sans-serif",
          fontSize: 12, fontWeight: 700, color: "#1A2533", letterSpacing: "0.01em",
        }}>
          {formatted}
        </span>
        <DirArrow dir={dir} />
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ConfigRow() {
  const {
    exchange, instrument, symbol, type, callStrike, putStrike, strike,
    isGenerated,
    setExchange, setInstrument, setSymbol, setType,
    setCallStrike, setPutStrike, setStrike,
    generate, reset,
    configCollapsed, toggleConfigCollapsed,
  } = useDashStore();

  // Live Spot/Future prices — sourced directly from socket tick cache,
  // available immediately after login without clicking Generate.
  const { ltp: spotLtp,   dir: spotDir }   = useLivePrice("NIFTY-SPOT");
  const { ltp: futureLtp, dir: futureDir } = useLivePrice("NIFTY-FUT");

  const [expiryDate, setExpiryDate] = useState<string>(EXPIRY_DATES[0] ?? "");

  const { data: exchanges = [], isLoading: loadEx } = useQuery({
    queryKey: ["exchanges"],
    queryFn: fetchExchanges,
    staleTime: Infinity,
  });

  const { data: instruments = [], isLoading: loadIn } = useQuery({
    queryKey: ["instruments", exchange],
    queryFn: () => fetchInstruments(exchange),
    enabled: !!exchange,
    staleTime: Infinity,
  });

  const { data: symbols = [], isLoading: loadSy } = useQuery({
    queryKey: ["symbols", instrument],
    queryFn: () => fetchSymbols(instrument),
    enabled: !!instrument,
    staleTime: Infinity,
  });

  const { data: strikes = [], isLoading: loadSt } = useQuery({
    queryKey: ["strikes", symbol],
    queryFn: () => fetchStrikes(symbol),
    enabled: !!symbol,
    staleTime: Infinity,
  });

  const includesCall = type === "Call" || type === "Call+Put";
  const includesPut  = type === "Put"  || type === "Call+Put";

  const canGenerate =
    !!exchange && !!instrument && !!symbol && strike !== null &&
    (!includesCall || callStrike !== null) &&
    (!includesPut  || putStrike  !== null);

  // ── Auto-generate on data readiness ───────────────────────────────────────
  // Fires once when all conditions are simultaneously true:
  //   ✓ Config complete (exchange / instrument / symbol / strikes all selected)
  //   ✓ Market data confirmed ready (backend emitted market_ready after first tick)
  //   ✓ Not already generated
  // The ref prevents double-firing; it resets whenever config becomes incomplete
  // (user changed a field), allowing re-trigger after the new config is filled in.

  const marketDataReady   = useStore((s) => s.marketDataReady);
  const autoGeneratedRef  = useRef(false);

  useEffect(() => {
    if (!canGenerate) {
      autoGeneratedRef.current = false;
    }
  }, [canGenerate]);

  useEffect(() => {
    if (canGenerate && marketDataReady && !isGenerated && !autoGeneratedRef.current) {
      autoGeneratedRef.current = true;
      console.log(
        "[AutoGenerate] ✓ All readiness conditions met" +
        ` — canGenerate=${canGenerate} marketDataReady=${marketDataReady}` +
        " → triggering generate()"
      );
      generate();
    }
  }, [canGenerate, marketDataReady, isGenerated, generate]);

  // ── Collapsed state ───────────────────────────────────────────────────────

  if (configCollapsed) {
    const p2 = (n: number | null) =>
      n != null ? n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";

    return (
      <div
        style={{
          display: "flex", alignItems: "center", gap: 10,
          height: 28, padding: "0 12px",
          background: "#F3F6FA", borderBottom: "1px solid #BDC4CF",
          cursor: "pointer", flexShrink: 0,
        }}
        onClick={toggleConfigCollapsed}
      >
        <span style={{ fontSize: 11, fontWeight: 700, color: "#2E75B6" }}>
          SPOT {p2(spotLtp)}
        </span>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#1A2533" }}>
          FUT {p2(futureLtp)}
        </span>
        <span style={{ color: "#BDC4CF" }}>|</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#5B6B7F" }}>
          {exchange} › {instrument} › {symbol}
        </span>
        <span style={{ marginLeft: "auto", fontSize: 10, color: "#5B6B7F" }}>▼ Expand config</span>
      </div>
    );
  }

  // ── Expanded state ────────────────────────────────────────────────────────

  return (
    <div style={{
      display: "flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap",
      padding: "8px 14px",
      background: "#F3F6FA", borderBottom: "1px solid #BDC4CF",
      flexShrink: 0,
    }}>

      {/* ── Live prices ──────────────────────────────────────────────────── */}
      <LivePrice label="Spot"   value={spotLtp}   dir={spotDir} />
      <LivePrice label="Future" value={futureLtp} dir={futureDir} />

      {/* Divider */}
      <div style={{ width: 1, height: 36, background: "#BDC4CF", alignSelf: "center", margin: "0 2px" }} />

      {/* ── Config dropdowns ─────────────────────────────────────────────── */}

      {/* Exchange */}
      <Field label="Exchange">
        <select
          style={SEL}
          value={exchange}
          onChange={e => setExchange(e.target.value)}
          disabled={loadEx}
        >
          <option value="">{loadEx ? "Loading…" : "Select…"}</option>
          {exchanges.map(ex => <option key={ex} value={ex}>{ex}</option>)}
        </select>
      </Field>

      {/* Instrument */}
      <Field label="Instrument">
        <select
          style={{ ...SEL, opacity: !exchange ? 0.5 : 1 }}
          value={instrument}
          onChange={e => setInstrument(e.target.value)}
          disabled={!exchange || loadIn}
        >
          <option value="">{loadIn ? "Loading…" : !exchange ? "—" : "Select…"}</option>
          {instruments.map(ins => <option key={ins} value={ins}>{ins}</option>)}
        </select>
      </Field>

      {/* Symbol */}
      <Field label="Symbol">
        <select
          style={{ ...SEL, opacity: !instrument ? 0.5 : 1 }}
          value={symbol}
          onChange={e => setSymbol(e.target.value)}
          disabled={!instrument || loadSy}
        >
          <option value="">{loadSy ? "Loading…" : !instrument ? "—" : "Select…"}</option>
          {symbols.map(sym => <option key={sym} value={sym}>{sym}</option>)}
        </select>
      </Field>

      {/* Expiry Date */}
      <Field label="Expiry Date">
        <select
          style={{ ...SEL, minWidth: 100 }}
          value={expiryDate}
          onChange={e => setExpiryDate(e.target.value)}
        >
          {EXPIRY_DATES.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </Field>

      {/* Strike */}
      <Field label="Strike">
        <select
          style={{ ...SEL, opacity: !symbol ? 0.5 : 1 }}
          value={strike ?? ""}
          onChange={e => setStrike(e.target.value ? +e.target.value : null)}
          disabled={!symbol || loadSt}
        >
          <option value="">{loadSt ? "Loading…" : !symbol ? "—" : "Select…"}</option>
          {strikes.map(st => <option key={st} value={st}>{st}</option>)}
        </select>
      </Field>

      {/* Call strike */}
      {includesCall && (
        <Field label="Call Strike">
          <select
            style={{ ...SEL, opacity: !symbol ? 0.5 : 1 }}
            value={callStrike ?? ""}
            onChange={e => setCallStrike(e.target.value ? +e.target.value : null)}
            disabled={!symbol || loadSt}
          >
            <option value="">{loadSt ? "Loading…" : "Select…"}</option>
            {strikes.map(st => <option key={st} value={st}>{st}</option>)}
          </select>
        </Field>
      )}

      {/* Put strike */}
      {includesPut && (
        <Field label="Put Strike">
          <select
            style={{ ...SEL, opacity: !symbol ? 0.5 : 1 }}
            value={putStrike ?? ""}
            onChange={e => setPutStrike(e.target.value ? +e.target.value : null)}
            disabled={!symbol || loadSt}
          >
            <option value="">{loadSt ? "Loading…" : "Select…"}</option>
            {strikes.map(st => <option key={st} value={st}>{st}</option>)}
          </select>
        </Field>
      )}

      {/* Type — segmented toggle */}
      <Field label="Type">
        <div style={{
          display: "flex", height: 26,
          border: "1px solid #BDC4CF", borderRadius: 3, overflow: "hidden",
        }}>
          {(["Call+Put", "Call", "Put"] as const).map((opt, i) => (
            <button
              key={opt}
              onClick={() => setType(opt)}
              style={{
                fontFamily: "'Calibri','Segoe UI',system-ui,sans-serif",
                fontSize: 11, fontWeight: 700,
                padding: "0 11px",
                border: "none",
                borderLeft: i > 0 ? "1px solid #BDC4CF" : "none",
                background: type === opt ? "#2E75B6" : "#F3F6FA",
                color: type === opt ? "#fff" : "#5B6B7F",
                cursor: "pointer",
                whiteSpace: "nowrap",
                lineHeight: "26px",
              }}
            >
              {opt === "Call+Put" ? "All" : opt}
            </button>
          ))}
        </div>
      </Field>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Reset + Generate + Collapse */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
        {isGenerated && (
          <button
            onClick={reset}
            style={{
              fontFamily: "'Calibri','Segoe UI',system-ui,sans-serif",
              fontSize: 12, fontWeight: 700,
              padding: "5px 14px", borderRadius: 3,
              border: "1px solid #BDC4CF", background: "#fff",
              color: "#5B6B7F", cursor: "pointer", height: 28,
            }}
          >
            Reset
          </button>
        )}
        <button
          onClick={generate}
          disabled={!canGenerate}
          style={{
            fontFamily: "'Calibri','Segoe UI',system-ui,sans-serif",
            fontSize: 12, fontWeight: 700,
            padding: "5px 20px", borderRadius: 3,
            border: "none",
            background: canGenerate ? "#2E9E4F" : "#9ca3af",
            color: "#fff", cursor: canGenerate ? "pointer" : "not-allowed",
            height: 28,
          }}
        >
          ▶ Generate
        </button>

        <button
          onClick={toggleConfigCollapsed}
          title="Collapse config"
          style={{
            border: "1px solid #BDC4CF", background: "#fff", borderRadius: 3,
            width: 26, height: 26, cursor: "pointer",
            fontSize: 10, color: "#5B6B7F",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          ▲
        </button>
      </div>
    </div>
  );
}

export default ConfigRow;
