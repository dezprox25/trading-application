import { useQuery } from "@tanstack/react-query";
import { useDashStore } from "./store";
import {
  fetchExchanges, fetchInstruments, fetchSymbols, fetchStrikes,
} from "../../data/liveApi";

// ── Styled select ─────────────────────────────────────────────────────────────

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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <span style={LABEL}>{label}</span>
      {children}
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

  // Collapsed state
  if (configCollapsed) {
    return (
      <div
        style={{
          display: "flex", alignItems: "center", gap: 8,
          height: 28, padding: "0 12px",
          background: "#F3F6FA", borderBottom: "1px solid #BDC4CF",
          cursor: "pointer", flexShrink: 0,
        }}
        onClick={toggleConfigCollapsed}
      >
        <span style={{ fontSize: 11, fontWeight: 700, color: "#5B6B7F" }}>
          {exchange} › {instrument} › {symbol}
        </span>
        <span style={{ marginLeft: "auto", fontSize: 10, color: "#5B6B7F" }}>▼ Expand config</span>
      </div>
    );
  }

  return (
    <div style={{
      display: "flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap",
      padding: "8px 14px",
      background: "#F3F6FA", borderBottom: "1px solid #BDC4CF",
      flexShrink: 0,
    }}>

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

      {/* Type */}
      <Field label="Type">
        <select
          style={{ ...SEL, minWidth: 90 }}
          value={type}
          onChange={e => setType(e.target.value as "Call" | "Put" | "Call+Put")}
        >
          <option value="Call+Put">Call + Put</option>
          <option value="Call">Call</option>
          <option value="Put">Put</option>
        </select>
      </Field>

      {/* Call strike */}
      {includesCall && (
        <Field label="Call">
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
        <Field label="Put">
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

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Reset + Generate */}
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

        {/* Collapse chevron */}
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
