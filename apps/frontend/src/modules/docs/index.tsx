import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  SECTIONS,
  Section,
  Subsection,
  DocBlock,
  ColRef,
  Tint,
  sectionMatches,
  matchingColIds,
  buildToc,
  TocEntry,
} from "./content";

// ── Design tokens (match app theme) ──────────────────────────────────────────
const CALL_BG    = "#D6E4F2";
const CALL_HDR   = "#2E75B6";
const PUT_BG     = "#FBE2CE";
const PUT_HDR    = "#C55A11";
const BORDER     = "#d8e0ea";
const TEXT       = "#102033";
const MUTED      = "#5b6b82";
const GREEN      = "#16a34a";
const FONT       = "'Inter', 'Segoe UI', system-ui, sans-serif";
const MONO       = "'Consolas', 'Courier New', monospace";

// ── FormulaChip ──────────────────────────────────────────────────────────────

function FormulaChip({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div style={{
      fontFamily: MONO, fontSize: 12,
      background: "#f1f5f9", border: "1px solid #e2e8f0",
      borderRadius: 6, padding: "8px 12px",
      color: "#1e3a5f", lineHeight: 1.7,
      whiteSpace: "pre", overflowX: "auto",
    }}>
      {lines.map((line, i) => <div key={i}>{line}</div>)}
    </div>
  );
}

// ── Tint badge ────────────────────────────────────────────────────────────────

function TintDot({ tint }: { tint: Tint }) {
  if (tint === "neutral") return null;
  const color = tint === "call" ? CALL_HDR : PUT_HDR;
  const label = tint === "call" ? "CE" : "PE";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 3,
      fontSize: 9, fontWeight: 800, padding: "1px 5px",
      borderRadius: 3,
      background: tint === "call" ? CALL_BG : PUT_BG,
      color,
      letterSpacing: "0.06em",
    }}>
      {label}
    </span>
  );
}

// ── ColumnRefRow ──────────────────────────────────────────────────────────────

function ColumnRefRow({
  col,
  expanded,
  onToggle,
}: {
  col: ColRef;
  expanded: boolean;
  onToggle: () => void;
}) {
  const rowBg = col.tint === "call" ? "#EAF1F9" : col.tint === "put" ? "#FDF1E7" : "#ffffff";
  return (
    <div style={{
      border: `1px solid ${BORDER}`,
      borderRadius: 6,
      overflow: "hidden",
      marginBottom: 4,
    }}>
      {/* Header row — always visible, clickable */}
      <button
        onClick={onToggle}
        style={{
          width: "100%", textAlign: "left",
          display: "flex", alignItems: "center", gap: 10,
          padding: "9px 14px",
          background: rowBg,
          border: "none", cursor: "pointer",
          fontFamily: FONT, fontSize: 13, fontWeight: 700, color: TEXT,
          borderBottom: expanded ? `1px solid ${BORDER}` : "none",
        }}
      >
        <span style={{
          fontSize: 10, color: expanded ? TEXT : MUTED,
          transition: "transform 0.15s",
          display: "inline-block",
          transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
        }}>▶</span>
        <TintDot tint={col.tint} />
        <span style={{ flex: 1 }}>{col.name}</span>
        {col.formula && (
          <span style={{
            fontFamily: MONO, fontSize: 10,
            background: "rgba(0,0,0,0.05)", padding: "2px 6px",
            borderRadius: 3, color: MUTED, whiteSpace: "nowrap",
          }}>
            has formula
          </span>
        )}
      </button>

      {/* Expanded content */}
      {expanded && (
        <div style={{ padding: "14px 16px", background: "#fff", display: "flex", flexDirection: "column", gap: 10 }}>
          <p style={{ margin: 0, fontSize: 13, color: TEXT, lineHeight: 1.65 }}>
            {col.description}
          </p>

          {col.formula && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>
                Formula
              </div>
              <FormulaChip text={col.formula} />
            </div>
          )}

          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>
              How to read
            </div>
            <p style={{ margin: 0, fontSize: 13, color: MUTED, lineHeight: 1.65 }}>
              {col.howToRead}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Block renderer ────────────────────────────────────────────────────────────

function BlockRenderer({
  block,
  expandedCols,
  autoExpanded,
  onToggleCol,
}: {
  block: DocBlock;
  expandedCols: Set<string>;
  autoExpanded: Set<string>;
  onToggleCol: (id: string) => void;
}) {
  switch (block.type) {
    case "para":
      return (
        <p style={{ margin: "0 0 10px", fontSize: 14, color: TEXT, lineHeight: 1.7 }}>
          {block.content}
        </p>
      );

    case "note":
      return (
        <div style={{
          margin: "0 0 10px",
          padding: "10px 14px",
          background: "rgba(22,163,74,0.06)",
          border: `1.5px solid rgba(22,163,74,0.25)`,
          borderRadius: 8,
          fontSize: 13, fontWeight: 600, color: "#166534", lineHeight: 1.65,
        }}>
          ⓘ {block.content}
        </div>
      );

    case "bullets":
      return (
        <ul style={{ margin: "0 0 10px", paddingLeft: 20 }}>
          {block.items.map((item, i) => (
            <li key={i} style={{ fontSize: 14, color: TEXT, lineHeight: 1.7, marginBottom: 4 }}>
              {item}
            </li>
          ))}
        </ul>
      );

    case "steps":
      return (
        <ol style={{ margin: "0 0 10px", paddingLeft: 0, listStyle: "none" }}>
          {block.steps.map((s) => (
            <li key={s.n} style={{
              display: "flex", alignItems: "flex-start", gap: 12,
              marginBottom: 8,
            }}>
              <span style={{
                flexShrink: 0,
                width: 22, height: 22, borderRadius: "50%",
                background: GREEN, color: "#fff",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, fontWeight: 800, marginTop: 1,
              }}>
                {s.n}
              </span>
              <span style={{ fontSize: 14, color: TEXT, lineHeight: 1.65 }}>{s.text}</span>
            </li>
          ))}
        </ol>
      );

    case "columns":
      return (
        <div style={{ margin: "0 0 10px" }}>
          {block.columns.map((col) => (
            <ColumnRefRow
              key={col.id}
              col={col}
              expanded={expandedCols.has(col.id) || autoExpanded.has(col.id)}
              onToggle={() => onToggleCol(col.id)}
            />
          ))}
        </div>
      );

    case "glossary":
      return (
        <div style={{
          margin: "0 0 10px",
          border: `1px solid ${BORDER}`,
          borderRadius: 8, overflow: "hidden",
        }}>
          {block.glossary.map((g, i) => (
            <div key={g.term} style={{
              display: "flex", alignItems: "flex-start", gap: 0,
              borderBottom: i < block.glossary.length - 1 ? `1px solid ${BORDER}` : "none",
            }}>
              <div style={{
                width: 180, flexShrink: 0,
                padding: "8px 14px",
                background: "#f8fafc",
                fontSize: 12, fontWeight: 800, color: TEXT,
                borderRight: `1px solid ${BORDER}`,
              }}>
                {g.term}
              </div>
              <div style={{
                flex: 1, padding: "8px 14px",
                fontSize: 13, color: MUTED, lineHeight: 1.6,
              }}>
                {g.def}
              </div>
            </div>
          ))}
        </div>
      );
  }
}

// ── Sub-section renderer ──────────────────────────────────────────────────────

function SubsectionRenderer({
  sub,
  visible,
  expandedCols,
  autoExpanded,
  onToggleCol,
}: {
  sub: Subsection;
  visible: boolean;
  expandedCols: Set<string>;
  autoExpanded: Set<string>;
  onToggleCol: (id: string) => void;
}) {
  return (
    <div
      id={sub.id}
      style={{ marginBottom: 20, opacity: visible ? 1 : 0.3 }}
    >
      <h3 style={{
        margin: "0 0 12px", fontSize: 15, fontWeight: 800, color: TEXT,
        letterSpacing: "-0.01em",
      }}>
        {sub.heading}
      </h3>
      {sub.blocks.map((block, i) => (
        <BlockRenderer
          key={i}
          block={block}
          expandedCols={expandedCols}
          autoExpanded={autoExpanded}
          onToggleCol={onToggleCol}
        />
      ))}
    </div>
  );
}

// ── Section card ──────────────────────────────────────────────────────────────

function SectionCard({
  section,
  q,
  expandedCols,
  autoExpanded,
  onToggleCol,
}: {
  section: Section;
  q: string;
  expandedCols: Set<string>;
  autoExpanded: Set<string>;
  onToggleCol: (id: string) => void;
}) {
  const visible = sectionMatches(section, q);

  return (
    <div
      id={section.id}
      style={{
        background: "#fff",
        border: `1.5px solid ${BORDER}`,
        borderRadius: 12,
        marginBottom: 20,
        overflow: "hidden",
        opacity: visible ? 1 : 0.3,
        transition: "opacity 0.15s",
      }}
    >
      {/* Card accent bar */}
      <div style={{ height: 3, background: `linear-gradient(90deg, ${GREEN}, #10b981)` }} />

      <div style={{ padding: "20px 24px" }}>
        <h2 style={{
          margin: "0 0 16px",
          fontSize: 17, fontWeight: 900, color: TEXT,
          letterSpacing: "-0.02em",
          paddingBottom: 12,
          borderBottom: `1.5px solid ${BORDER}`,
        }}>
          {section.heading}
        </h2>

        {/* Direct blocks (before subsections) */}
        {section.blocks?.map((block, i) => (
          <BlockRenderer
            key={i}
            block={block}
            expandedCols={expandedCols}
            autoExpanded={autoExpanded}
            onToggleCol={onToggleCol}
          />
        ))}

        {/* Subsections */}
        {section.subsections?.map((sub) => {
          const subVisible = !q || sectionMatches(
            { id: sub.id, heading: sub.heading, blocks: sub.blocks },
            q
          );
          return (
            <SubsectionRenderer
              key={sub.id}
              sub={sub}
              visible={subVisible}
              expandedCols={expandedCols}
              autoExpanded={autoExpanded}
              onToggleCol={onToggleCol}
            />
          );
        })}
      </div>
    </div>
  );
}

// ── TOC ───────────────────────────────────────────────────────────────────────

function Toc({
  entries,
  activeId,
  q,
  onScroll,
}: {
  entries: TocEntry[];
  activeId: string;
  q: string;
  onScroll: (id: string) => void;
}) {
  return (
    <nav style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      {entries.map((entry) => {
        const isActive = activeId === entry.id;
        const matchesQ = q
          ? entry.label.toLowerCase().includes(q)
          : false;
        return (
          <button
            key={entry.id}
            onClick={() => onScroll(entry.id)}
            title={entry.label}
            style={{
              all: "unset",
              display: "block",
              cursor: "pointer",
              fontFamily: FONT,
              fontSize: entry.depth === 0 ? 12 : 11,
              fontWeight: entry.depth === 0 ? 700 : 500,
              color: isActive ? GREEN : matchesQ ? "#1d4ed8" : MUTED,
              background: isActive ? "rgba(22,163,74,0.07)" : "transparent",
              padding: `5px 16px 5px ${entry.depth === 0 ? 16 : 26}px`,
              borderLeft: isActive ? `2.5px solid ${GREEN}` : "2.5px solid transparent",
              lineHeight: 1.35,
              transition: "all 0.12s",
              borderRadius: "0 4px 4px 0",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {entry.label}
          </button>
        );
      })}
    </nav>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function DocsPage() {
  const [query, setQuery]         = useState("");
  const [expandedCols, setExpandedCols] = useState<Set<string>>(new Set());
  const [activeId, setActiveId]   = useState<string>(SECTIONS[0]?.id ?? "");
  const mainRef                   = useRef<HTMLDivElement>(null);
  const observerRef               = useRef<IntersectionObserver | null>(null);

  const toc     = useMemo(() => buildToc(), []);
  const q       = query.toLowerCase().trim();
  const autoExp = useMemo(() => matchingColIds(q), [q]);

  // ── IntersectionObserver for active TOC tracking ──────────────────────────
  const allIds = useMemo(() => toc.map((e) => e.id), [toc]);

  useEffect(() => {
    observerRef.current?.disconnect();
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setActiveId(e.target.id);
          }
        }
      },
      { rootMargin: "-15% 0px -70% 0px", threshold: 0 }
    );
    observerRef.current = obs;
    allIds.forEach((id) => {
      const el = document.getElementById(id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, [allIds]);

  // ── Scroll to section ─────────────────────────────────────────────────────
  const scrollTo = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    // The scroll container is the parent <main> in ModuleDashboardLayout
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // ── Column expand toggle ──────────────────────────────────────────────────
  const toggleCol = useCallback((id: string) => {
    setExpandedCols((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ── Print ─────────────────────────────────────────────────────────────────
  const handlePrint = () => window.print();

  return (
    <>
      <style>{`
        @media print {
          .docs-toc-panel  { display: none !important; }
          .docs-print-btn  { display: none !important; }
          .docs-search-box { display: none !important; }
          .docs-page-root  { display: block !important; }
          .docs-main       { padding: 20px !important; max-width: 100% !important; }
          body, html       { background: white !important; }
        }
        .docs-toc-btn:hover {
          background: rgba(22,163,74,0.07) !important;
          color: ${GREEN} !important;
        }
      `}</style>

      <div
        className="docs-page-root"
        style={{ display: "flex", minHeight: "calc(100vh - 60px)", fontFamily: FONT }}
      >
        {/* ── Left TOC panel ────────────────────────────────────────────── */}
        <aside
          className="docs-toc-panel"
          style={{
            width: 240,
            flexShrink: 0,
            position: "sticky",
            top: 0,
            alignSelf: "flex-start",
            height: "calc(100vh - 60px)",
            overflowY: "auto",
            borderRight: `1.5px solid ${BORDER}`,
            background: "#ffffff",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Search */}
          <div
            className="docs-search-box"
            style={{ padding: "16px 14px 12px", borderBottom: `1px solid ${BORDER}` }}
          >
            <div style={{ position: "relative" }}>
              <svg
                width="13" height="13" viewBox="0 0 24 24"
                fill="none" stroke={MUTED} strokeWidth="2.5"
                style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
              >
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input
                type="text"
                placeholder="Search sections & columns…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={{
                  width: "100%", boxSizing: "border-box",
                  fontFamily: FONT, fontSize: 12,
                  padding: "6px 8px 6px 26px",
                  border: `1.5px solid ${BORDER}`,
                  borderRadius: 6, background: "#f8fafc",
                  color: TEXT, outline: "none",
                  transition: "border-color 0.15s",
                }}
                onFocus={(e) => (e.target.style.borderColor = GREEN)}
                onBlur={(e) => (e.target.style.borderColor = BORDER)}
              />
            </div>
            {q && (
              <button
                onClick={() => setQuery("")}
                style={{
                  all: "unset", cursor: "pointer",
                  fontSize: 10, color: MUTED,
                  marginTop: 5, display: "block",
                }}
              >
                ✕ Clear search
              </button>
            )}
          </div>

          {/* TOC label */}
          <div style={{
            padding: "10px 16px 6px",
            fontSize: 9, fontWeight: 700, color: "#94a3b8",
            textTransform: "uppercase", letterSpacing: "0.15em",
          }}>
            Contents
          </div>

          {/* TOC links */}
          <Toc entries={toc} activeId={activeId} q={q} onScroll={scrollTo} />

          {/* Print button at bottom */}
          <div style={{ flex: 1 }} />
          <div style={{
            padding: "14px 16px",
            borderTop: `1px solid ${BORDER}`,
          }}>
            <button
              className="docs-print-btn"
              onClick={handlePrint}
              style={{
                width: "100%", fontFamily: FONT, fontSize: 11, fontWeight: 700,
                padding: "7px 0", borderRadius: 6,
                border: `1.5px solid ${BORDER}`,
                background: "#fff", color: MUTED,
                cursor: "pointer", display: "flex",
                alignItems: "center", justifyContent: "center", gap: 6,
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = GREEN;
                (e.currentTarget as HTMLButtonElement).style.color = GREEN;
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = BORDER;
                (e.currentTarget as HTMLButtonElement).style.color = MUTED;
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>
              </svg>
              Print / Save as PDF
            </button>
          </div>
        </aside>

        {/* ── Right content ──────────────────────────────────────────────── */}
        <main
          className="docs-main"
          ref={mainRef}
          style={{
            flex: 1,
            padding: "28px 36px",
            maxWidth: 860,
            minWidth: 0,
          }}
        >
          {/* Page header */}
          <div style={{
            display: "flex", alignItems: "flex-start",
            justifyContent: "space-between", marginBottom: 24,
            paddingBottom: 20, borderBottom: `1.5px solid ${BORDER}`,
            gap: 16,
          }}>
            <div>
              <div style={{
                fontSize: 11, fontWeight: 700, color: GREEN,
                textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 6,
              }}>
                Platform Guide
              </div>
              <h1 style={{
                margin: 0, fontSize: 26, fontWeight: 900,
                color: TEXT, letterSpacing: "-0.02em",
              }}>
                📖 Documentation
              </h1>
              <p style={{ margin: "6px 0 0", fontSize: 13, color: MUTED, fontWeight: 500 }}>
                Complete reference for the Synergy Trading Platform — for traders, not engineers.
              </p>
            </div>
            <button
              className="docs-print-btn"
              onClick={handlePrint}
              style={{
                flexShrink: 0,
                fontFamily: FONT, fontSize: 12, fontWeight: 700,
                padding: "8px 16px", borderRadius: 7,
                border: `1.5px solid ${BORDER}`,
                background: "#fff", color: MUTED,
                cursor: "pointer", display: "flex",
                alignItems: "center", gap: 7,
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = GREEN;
                (e.currentTarget as HTMLButtonElement).style.color = GREEN;
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = BORDER;
                (e.currentTarget as HTMLButtonElement).style.color = MUTED;
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>
              </svg>
              Print / Save as PDF
            </button>
          </div>

          {/* Search result hint */}
          {q && (
            <div style={{
              marginBottom: 16, padding: "8px 12px",
              background: "#eff6ff", border: "1px solid #bfdbfe",
              borderRadius: 6, fontSize: 12, color: "#1d4ed8", fontWeight: 600,
            }}>
              Showing results for "<strong>{query}</strong>" — {autoExp.size} column{autoExp.size !== 1 ? "s" : ""} expanded automatically.
            </div>
          )}

          {/* Section cards */}
          {SECTIONS.map((section) => (
            <SectionCard
              key={section.id}
              section={section}
              q={q}
              expandedCols={expandedCols}
              autoExpanded={autoExp}
              onToggleCol={toggleCol}
            />
          ))}

          {/* Footer */}
          <p style={{
            textAlign: "center", marginTop: 40,
            fontSize: 11, fontWeight: 500, color: "#cbd5e1",
          }}>
            Pivot Intelligence v1.0 · Authorised Access Only · Analysis tool — no orders placed
          </p>
        </main>
      </div>
    </>
  );
}

export default DocsPage;
