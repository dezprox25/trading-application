import { useState } from "react";
import { useStore } from "../store/useStore";
import Module1LoginPanel from "./Module1LoginPanel";
import Module2LoginPanel from "./Module2LoginPanel";
import { Module1 } from "./Module1";
import { Module2 } from "./Module2";
import { Module2Live } from "./Module2Live";

const GREEN = "#047857";

// Module2.tsx (Strike Tracker) is untouched — built on trackerService's
// session/grid model. Module2Live.tsx (Live Instrument Watch) is a separate
// screen wired to the Phase 3-12 instrument/subscription/socket backend.
// This tab switcher is the only "wiring" point between the two; neither
// screen knows the other exists.
function Module2Tabs() {
  const [tab, setTab] = useState<"tracker" | "live">("tracker");

  const tabBtn = (key: "tracker" | "live"): React.CSSProperties => ({
    fontFamily: "'Inter', sans-serif", fontSize: 12, fontWeight: 700,
    padding: "8px 16px", borderRadius: 8, cursor: "pointer",
    border: `1.5px solid ${tab === key ? GREEN : "var(--trading-border)"}`,
    background: tab === key ? GREEN : "transparent",
    color: tab === key ? "#fff" : "var(--trading-text-muted)",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <div style={{ display: "flex", gap: 8, padding: "12px 24px 0", background: "var(--trading-bg)" }}>
        <button style={tabBtn("tracker")} onClick={() => setTab("tracker")}>Strike Tracker</button>
        <button style={tabBtn("live")} onClick={() => setTab("live")}>Live Instrument Watch</button>
      </div>
      {tab === "tracker" ? <Module2 /> : <Module2Live />}
    </div>
  );
}

export function ModuleWorkspace({ moduleId }: { moduleId: "module1" | "module2" }) {
  const module1Token = useStore((s) => s.module1Token);
  const module2Token = useStore((s) => s.module2Token);

  if (moduleId === "module1") {
    if (!module1Token) return <Module1LoginPanel />;
    return <Module1 />;
  }

  if (moduleId === "module2") {
    if (!module2Token) return <Module2LoginPanel />;
    return <Module2Tabs />;
  }

  return null;
}

export default ModuleWorkspace;
