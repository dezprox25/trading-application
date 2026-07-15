# Module 1 — EMA & VWAP Logic: Verification & Implementation Report

Scope: the client's EMA & VWAP specification (EMA20, EMA200, EMA20-vs-EMA200 scoring,
VWAP, VWAP-vs-EMA20 scoring, Total Score, Rating, Signal). Only the gaps confirmed
against this specification were implemented. MMA, TLA, Ranking, SMC, Fibonacci, RSI,
Pivot Points, and all existing UI/export behavior were left untouched.

---

## 1. Verification Summary

| Requirement | Before this change |
|---|---|
| EMA20 = `Close×k + prevEMA×(1−k)`, `k = 2/21`, SMA-seeded, period 20 | ✅ Already implemented exactly as specified (`calc/index.ts` `computeEMASeries`, historical + live) |
| EMA200 (same engine, period 200) | ❌ Did not exist anywhere — no field, no calculation, no column |
| EMA20 vs EMA200 comparison (+1/−1/0) | ❌ Did not exist — no EMA200 to compare against |
| VWAP = Σ(TP×Volume)/ΣVolume (true volume-weighted) | ⚠️ Implemented instead as an **unweighted** cumulative average of Typical Price (`(H+L+C)/3`), by design — no `volume` field exists anywhere in Module 1's Call/Put/Future/Spot tick or bar pipeline |
| VWAP vs EMA20 comparison (+1/−1/0) | ❌ Did not exist |
| EMA Score / VWAP Score / Total Score | ❌ Did not exist |
| Rating (Strong CALL / CALL / Neutral / PUT / Strong PUT) | ❌ Did not exist (an unrelated legacy `aggregateRating()` with different labels exists but is explicitly dead code, "not used in v2", and was left untouched) |
| Signal (CALL / PUT / NEUTRAL) | ❌ Did not exist |
| API exposure: `ema20, ema200, vwap, emaScore, vwapScore, totalScore, signal, rating` | ⚠️ `ema20` existed under the field name `ema` (kept as-is — see note below); everything else was missing |

**Volume-weighting decision:** I searched the entire Module 1 frontend pipeline
(`calc/index.ts`, `modules/dashboard/*`) for any volume/quantity field — none exists.
A `volume` field does exist in an unrelated backend service
(`apps/backend/src/services/ohlcAggregator.ts`, used for a separate Futures candle
archive), but it is never sent to, or consumed by, Module 1's dashboard. Separately,
NIFTY Spot is an index and has no real traded volume at all. Per the client
instruction ("if volume data is NOT available anywhere, do NOT invent fake
calculations — keep the current implementation and document the limitation"), **VWAP's
formula was not changed.** It remains the unweighted cumulative Typical Price average
that already existed, with the limitation documented below (see §4 Blocked).

**Naming note (`ema` vs `ema20`):** the existing, already-correct EMA20 field is named
`ema` in `DashboardRow`/`Worksheet`/Excel export/tests. I did not rename it to `ema20` —
renaming a working, already-verified field would touch every consumer for no functional
gain and risks a regression, which conflicts with "preserve backward compatibility" /
"do not rename variables". It is documented here as fulfilling the `ema20` requirement
under its existing name.

---

## 2. Implementation Summary

### Files changed
| File | What changed |
|---|---|
| `apps/frontend/src/calc/index.ts` | Added 6 new `DashboardRow` fields (`ema200`, `emaScore`, `vwapScore`, `totalScore`, `rating`, `signal`) and 4 new pure functions: `compareScore`, `totalScoreFromParts`, `ratingFromTotalScore`, `signalFromTotalScore`. **No existing formula was touched** — EMA200 reuses the existing generic `computeEMASeries(closes, period)` with `period=200` (it already supported an arbitrary period; the existing test file even had a pre-existing `EMA 200` test case, `calc/index.test.ts:108`). |
| `apps/frontend/src/modules/dashboard/index.tsx` | Added a second EMA-200 seed/continuation ref (`prevEma200Ref`), mirroring the existing EMA-20 `prevEmaRef` pattern exactly (historical seed, live bar-open provisional calc, bar-finalize permanent roll-forward). Computes `emaScore`/`vwapScore`/`totalScore`/`rating`/`signal` at all 3 row-construction sites (historical loop, live bar-open, live tick-update) and passes them into `appendRow`/`updateLatestRow`. |
| `apps/frontend/src/modules/dashboard/Worksheet.tsx` | Added 6 new columns to `ALL_COLS` (`ema200`, `ema-score`, `vwap-score`, `total-score`, `rating`, `signal`) in the existing "Indicators" group, and their `getCellValue` cases. Numeric scores reuse the existing `p0()` truncation formatter; `rating`/`signal` render as plain text (same treatment as the existing `smc`/`fib` string columns). No existing column, formatting rule, or color rule was changed. |
| `apps/frontend/src/modules/dashboard/TimeframeRow.tsx` | Registered the same 6 new column IDs in the Columns show/hide panel (`ALL_COL_IDS`, `ALL_COL_LABELS`, `COL_GROUP_LABEL`) so users can toggle them, identical treatment to the existing `rsi`/`ema`/`vwap` columns. |
| `apps/frontend/src/calc/index.test.ts` | Added unit tests for the 4 new pure functions (score sign, null-propagation, the 5-level rating mapping, the 3-level signal mapping). |
| `apps/frontend/src/modules/dashboard/excelExport.test.ts` | Updated the test fixture row to include the 6 new required `DashboardRow` fields (TypeScript would not compile otherwise) — no assertions changed. |

### New calculations added
- **EMA200**: `EMA200 = Close × (2/201) + prevEMA200 × (1 − 2/201)`, SMA(200)-seeded — identical engine to EMA20, same source (Spot Close, Future-close fallback), just `period=200`.
- **EMA Score** = `compareScore(ema20, ema200)` → `+1` if EMA20 > EMA200, `−1` if lower, `0` if equal, `null` if either isn't seeded yet.
- **VWAP Score** = `compareScore(vwap, ema20)` → same ±1/0/null rule.
- **Total Score** = `emaScore + vwapScore` (null unless both scores exist).
- **Rating** = `+2→"Strong CALL", +1→"CALL", 0→"Neutral", −1→"PUT", −2→"Strong PUT"`.
- **Signal** = `totalScore > 0 → "CALL"`, `< 0 → "PUT"`, `= 0 → "NEUTRAL"`.

### New fields added (`DashboardRow`)
`ema200: number | null`, `emaScore: -1|0|1|null`, `vwapScore: -1|0|1|null`, `totalScore: number | null`, `rating: string | null`, `signal: string | null`.

### UI changes
6 new columns appended to the existing "Indicators" group (after VWAP, before the hidden Pivot Point columns): **EMA200, EMA Score, VWAP Score, Total Score, Rating, Signal**. No existing column was moved, renamed, or reformatted. New columns are visible by default and user-toggleable via the existing Columns panel, same as any other indicator column.

### API changes
None to any backend/REST API — Module 1's indicators are computed entirely client-side from ticks/candles, so "API" here is the `DashboardRow` shape, which now carries all 8 requested fields (`ema` fulfills `ema20`, plus the 7 new ones). Excel export required **no code change** — it already reads columns generically through `getVisibleColumns()`/`getCellValue()`, so the 6 new columns appear in the exported file automatically once they exist in `ALL_COLS`.

---

## 3. Validation

- **Existing functionality unchanged**: `git diff` on every changed file shows the edits are additive; the only non-purely-additive lines are 3 stale comment-text tweaks (e.g. "EMA-20 of Spot Close (confirm period)" → "EMA-20 of Spot Close", now that the period is confirmed) and one internal refactor — the historical loop's `ema:`/`vwap:` values were pulled into local `hEma`/`hVwap` consts so the new score functions could reuse them instead of recomputing `emaSeries[i] ?? null` a second time (same value, not a formula change).
- **Historical calculations**: verified via `npx tsc --noEmit` (clean, whole project) and `npx vitest run` — **37/37 tests pass**, including the pre-existing EMA/VWAP/RSI/Ranking/MMA/TLA formula tests (untouched, still green) and the new scoring-function tests.
- **Live calculations**: EMA200 continuation mirrors the exact existing EMA20 pattern (provisional recompute every 500ms tick from `prevEma200Ref`, permanently rolled forward only on candle finalize) — same mechanism, same risk profile as the already-verified EMA20 live logic.
- **Exports still work**: `excelExport.test.ts` (unchanged assertions, only the fixture was extended to satisfy the type) still passes — confirms the new columns don't break the existing Excel column/order/ranking-prefix behavior.
- **No regressions**: no other file was touched; MMA, TLA, Ranking, SMC, Fibonacci, RSI, Pivot Points, and all display/color/formatting rules are byte-identical to before this change.

---

## 4. Known Limitation — Not Fixed (Blocked / By Design)

- **VWAP is not volume-weighted** and was intentionally left unchanged (see §1). True `Σ(TP×Volume)/ΣVolume` cannot be implemented without plumbing a genuine per-candle volume field through the Zebu tick client → `dataFeed` → Module 1's socket/tick consumption → `OHLCBar`, and even then NIFTY Spot (an index) has no real traded volume to weight by. This would be a substantial, separate cross-stack change and was explicitly out of scope per the client's own instruction not to fake it.
- **EMA200 warm-up**: for non-custom (single trading day) timeframes, historical data is currently scoped to the current session only (`index.tsx` client-side day filter). Depending on the selected candle timeframe, a single day may never accumulate 200 candles (e.g. a 5-minute timeframe yields roughly 75 candles in a 6.25-hour session), so `ema200` (and therefore `emaScore`/`totalScore`/`rating`/`signal`) will correctly display "—" for most or all of an intraday session on coarser timeframes. It seeds normally on fine timeframes (e.g. 1m) once enough candles accumulate, and on multi-day custom-range mode. This is a pre-existing architectural constraint (day-scoped history fetch) that was not modified, per the instruction to preserve existing architecture.
