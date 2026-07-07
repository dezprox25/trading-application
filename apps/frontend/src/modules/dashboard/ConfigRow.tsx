import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDashStore } from "./store";
import { useStore } from "../../store/useStore";
import { fetchSymbolExpiries, fetchStrikes } from "../../data/liveApi";
import { formatExpiryDisplay } from "../../data/models";
import { INSTRUMENT_TYPES, tradingConfig, requiresExpiry } from "../../data/tradingConfig";

// ── Live price hook ───────────────────────────────────────────────────────────

function useLivePrice(symbol: string): { ltp: number | null; dir: "up" | "down" | null } {
  const ltp = useStore((s) => s.prices[symbol]?.ltp ?? null);
  const prevRef = useRef<number | null>(null);
  const [dir, setDir] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    if (ltp === null) return;
    if (prevRef.current !== null) {
      if (ltp > prevRef.current) setDir("up");
      else if (ltp < prevRef.current) setDir("down");
    }
    prevRef.current = ltp;
  }, [ltp]);

  return { ltp, dir };
}

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

/** Dependent dropdown: disabled until its parent is selected, shows loading and
 *  empty states, and never renders broker symbols/tokens — display labels only. */
function DepSelect({
  value, onChange, disabled, loading, options, placeholder = "Select…",
  minWidth,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  loading: boolean;
  options: { value: string; label: string }[];
  placeholder?: string;
  minWidth?: number;
}) {
  const empty = !loading && !disabled && options.length === 0;
  return (
    <select
      style={{ ...SEL, ...(minWidth ? { minWidth } : {}), opacity: disabled ? 0.5 : 1 }}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled || loading || empty}
    >
      <option value="">
        {loading ? "Loading…" : disabled ? "—" : empty ? "No data" : placeholder}
      </option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
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
    instrumentType, instrument, type, callStrike, putStrike,
    expiryDate,
    isGenerated,
    setInstrumentType, setInstrument, setType,
    setCallStrike, setPutStrike,
    setExpiryDate,
    generate, reset,
    configCollapsed, toggleConfigCollapsed,
  } = useDashStore();

  const { ltp: spotLtp,   dir: spotDir }   = useLivePrice("NIFTY-SPOT");
  const { ltp: futureLtp, dir: futureDir } = useLivePrice("NIFTY-FUT");

  const needsExpiry = requiresExpiry(instrumentType);

  // ── Dependent data (Instrument type → Symbol → Expiry → Strike) ──────────────

  const symbols = tradingConfig[instrumentType]?.symbols ?? [];

  const { data: expiries = [], isLoading: loadExp } = useQuery({
    queryKey: ["expiries", instrument],
    queryFn: () => fetchSymbolExpiries(instrument),
    enabled: !!instrument && needsExpiry,
    staleTime: Infinity,
  });

  const { data: strikes = [], isLoading: loadSt } = useQuery({
    queryKey: ["strikes", instrument, expiryDate],
    queryFn: () => fetchStrikes(instrument, expiryDate),
    enabled: !!instrument && !!expiryDate,
    staleTime: Infinity,
  });

  // ── Defaults + preserve-valid-selection guards ────────────────────────────
  // When a parent changes, a still-valid child selection is kept; an invalid
  // one is cleared (which cascades through the store resets).

  useEffect(() => {
    if (instrument && !symbols.includes(instrument)) {
      setInstrument("");
    }
  }, [instrument, symbols, setInstrument]);

  // Nearest expiry is auto-selected whenever the current one is missing/invalid.
  useEffect(() => {
    if (!needsExpiry || loadExp || expiries.length === 0) return;
    if (!expiryDate || !expiries.some((e) => e.id === expiryDate)) {
      setExpiryDate(expiries[0].id);
    }
  }, [needsExpiry, expiries, loadExp, expiryDate, setExpiryDate]);

  useEffect(() => {
    if (!needsExpiry && expiryDate) setExpiryDate("");
  }, [needsExpiry, expiryDate, setExpiryDate]);

  useEffect(() => {
    if (loadSt || !expiryDate) return;
    if (callStrike !== null && !strikes.some((s) => s.value === callStrike)) setCallStrike(null);
    if (putStrike  !== null && !strikes.some((s) => s.value === putStrike))  setPutStrike(null);
  }, [strikes, loadSt, expiryDate, callStrike, putStrike, setCallStrike, setPutStrike]);

  const includesCall = type === "Call" || type === "Call+Put";
  const includesPut  = type === "Put"  || type === "Call+Put";

  const canGenerate =
    !!instrumentType && !!instrument && (!needsExpiry || !!expiryDate) &&
    (!includesCall || callStrike !== null) &&
    (!includesPut  || putStrike  !== null);

  // ── Auto-generate on data readiness ───────────────────────────────────────

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

    const summary = [
      instrumentType,
      instrument,
      needsExpiry && expiryDate ? formatExpiryDisplay(expiryDate) : null,
    ].filter(Boolean).join(" › ");

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
          {summary}
        </span>
        <span style={{ marginLeft: "auto", fontSize: 10, color: "#5B6B7F" }}>▼ Expand config</span>
      </div>
    );
  }

  // ── Expanded state ────────────────────────────────────────────────────────

  const strikeOptions = strikes.map((s) => ({ value: String(s.value), label: String(s.value) }));

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

      <div style={{ width: 1, height: 36, background: "#BDC4CF", alignSelf: "center", margin: "0 2px" }} />

      {/* Instrument (type) */}
      <Field label="Instrument">
        <DepSelect
          value={instrumentType}
          onChange={setInstrumentType}
          disabled={false}
          loading={false}
          options={INSTRUMENT_TYPES}
          minWidth={130}
        />
      </Field>

      {/* Symbol (underlying) */}
      <Field label="Symbol">
        <DepSelect
          value={instrument}
          onChange={setInstrument}
          disabled={false}
          loading={false}
          options={symbols.map((s) => ({ value: s, label: s }))}
        />
      </Field>

      {/* Expiry Date — internal value is ISO "YYYY-MM-DD"; display "DD Mon YYYY".
          Hidden entirely for instrument types that don't settle (Cash Index, Equity). */}
      {needsExpiry && (
        <Field label="Expiry Date">
          <DepSelect
            value={expiryDate}
            onChange={setExpiryDate}
            disabled={!instrument}
            loading={loadExp}
            options={expiries.map((e) => ({ value: e.id, label: e.expiry }))}
            minWidth={110}
          />
        </Field>
      )}

      {/* Option Type */}
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
              {opt === "Call+Put" ? "Call + Put" : opt}
            </button>
          ))}
        </div>
      </Field>

      {/* Call strike */}
      {includesCall && (
        <Field label="Call Strike">
          <DepSelect
            value={callStrike !== null ? String(callStrike) : ""}
            onChange={(v) => setCallStrike(v ? +v : null)}
            disabled={!expiryDate}
            loading={loadSt}
            options={strikeOptions}
            minWidth={90}
          />
        </Field>
      )}

      {/* Put strike */}
      {includesPut && (
        <Field label="Put Strike">
          <DepSelect
            value={putStrike !== null ? String(putStrike) : ""}
            onChange={(v) => setPutStrike(v ? +v : null)}
            disabled={!expiryDate}
            loading={loadSt}
            options={strikeOptions}
            minWidth={90}
          />
        </Field>
      )}

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
