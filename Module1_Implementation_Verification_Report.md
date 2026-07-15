# Module 1 — Implementation Verification Report (Phase 1, Read-Only Audit)

**Audit type:** Verification only. No source code was modified, refactored, or "fixed" to produce this report.

**Designated client specification:** `Module1_Calculations_And_Formulas.md` (repo root), per explicit user selection. Every "Client Specification" quote below is taken from that file.

**Current implementation reviewed (working-tree state at time of audit):**
- `apps/frontend/src/calc/index.ts`
- `apps/frontend/src/modules/dashboard/index.tsx`
- `apps/frontend/src/modules/dashboard/Worksheet.tsx`
- `apps/frontend/src/modules/dashboard/store.ts`
- `apps/frontend/src/modules/dashboard/excelExport.ts`
- `apps/frontend/src/modules/dashboard/TimeframeRow.tsx`

**Important caveat:** `Module1_Calculations_And_Formulas.md` is itself a snapshot audit of a *past* state of the code. `git status` shows these same implementation files are currently modified/uncommitted. Where the current working tree differs from what the spec doc asserts, that is reported below as a finding — the doc's line numbers and "no UI surface" claims are checked against, not assumed to still hold.

---

# Executive Summary

| Metric | Count |
|---|---|
| Total features checked | 20 |
| ✅ Already Implemented (full match) | 17 |
| ⚠️ Partially Implemented | 2 |
| ❌ Not Implemented | 0 |
| 🚫 Client Specification Incomplete | 1 |

The core calculation engine (`calc/index.ts`) is **unchanged** from the spec doc's description — every formula (MMA, TLA, Ranking, SMC, FIB, RSI, EMA, VWAP) matches exactly, including the intentionally non-standard `MMA_CLOSE_SIGN = -1` and the intentionally non-volume-weighted VWAP. The two partial matches are:
1. **Ranking display** — the code has an undocumented guard (`row.ranking >= 0`) suppressing the +/− prefix that the spec doc doesn't mention.
2. **Pivot Points** — the spec doc says these are "not calculated, no UI column exists at all"; the current code has since had them fully wired into `DashboardRow`-adjacent columns, computed and Excel-export-ready, but deliberately hidden from the UI via a dedicated filter. The code has moved past what this spec doc describes.

Excel Export is not discussed by the designated spec doc at all, so it is marked specification-incomplete (documented anyway, for completeness).

---

# Detailed Verification

## Call MMA

### Client Specification
> `MMA = (Open + High + Low + (MMA_CLOSE_SIGN × Close)) / 4`, `MMA_CLOSE_SIGN = -1` → effectively `MMA = (Open + High + Low − Close) / 4`. Input: Call option candle O/H/L/C (the option's own traded premium, not the index).

### Current Implementation
`mmaBar()` (`apps/frontend/src/calc/index.ts:112-114`) computes exactly this formula, with `MMA_CLOSE_SIGN = -1` declared as a constant at line 110. The row builder applies it to the Call bar in both historical (`index.tsx:417`, `callBar = ceMap.get(bar.t) ?? MISSING_BAR(bar.t)`, line 413) and live paths (`index.tsx:581` on bar-open, `index.tsx:647` on tick update), where the Call bar is sourced purely from the Call LTP stream (`ceLtp`), never from Future/Spot. A missing CE tick yields the `MISSING_BAR` NaN sentinel, and `mmaBar()` propagates `NaN` naturally (no special-casing needed).

### Comparison
✅ Match

### Evidence
- `calc/index.ts:110,112-114` — formula and sign constant
- `index.tsx:28` — `MISSING_BAR` sentinel
- `index.tsx:413,417` (historical), `index.tsx:561,581,613-618,647` (live)

### Recommendation
None — matches spec.

---

## Put MMA

### Client Specification
> Identical to Call MMA, applied to the Put bar.

### Current Implementation
Same `mmaBar()` call applied to `putBar` — historical `index.tsx:414,418`; live open `index.tsx:582`, tick update `index.tsx:619-624,648`. Missing PE ticks → `NaN` → same sentinel handling as Call.

### Comparison
✅ Match

### Evidence
- `calc/index.ts:112-114`
- `index.tsx:414,418,562,582,619-624,648`

### Recommendation
None.

---

## Future MMA

### Client Specification
> Same formula applied to the Future candle (context column, does not feed Ranking). Live row only populated if a Future tick has been seen within `FRESH_TTL_MS` (8000ms), else NaN sentinel.

### Current Implementation
`mmaBar(bar)` applied to the Future OHLC bar. Historical: `index.tsx:419` using the raw Future bar from `futBars`. Live: `futFresh` gate computed at `index.tsx:508` (`(now - futUpdatedAt) < FRESH_TTL_MS`, `FRESH_TTL_MS = 8000` declared at `index.tsx:506`); `futBar` is the real bar if fresh or `MISSING_BAR` otherwise (`index.tsx:573,639`). Note: internal `b.futO/H/L/C` tracking continues even when stale (comment at `index.tsx:635-638`), so Math.max/min stay correct once ticks resume — only the *rendered/calculated* bar goes blank, matching the spec's description.

### Comparison
✅ Match

### Evidence
- `calc/index.ts:112-114`
- `index.tsx:419 (historical)`, `506-508,573,583,639,649 (live)`

### Recommendation
None.

---

## Spot MMA

### Client Specification
> Same formula on the Spot candle. Historical: Spot→Future fallback if no Spot bar exists for that timestamp (`spotBarsForCalc = closedBars.map(b => spotMap.get(b.t) ?? b)`). Live: `spotLtp ?? futLtp`, only renders if a Spot tick was seen within 8000ms.

### Current Implementation
Historical fallback confirmed verbatim at `index.tsx:388`: `spotMap.get(b.t) ?? b` (falls back to the Future bar `b`). Per-row `spotBar` construction: `index.tsx:415`, `spotMap.get(bar.t) ?? bar`. Live: `sLtp = spotLtp ?? futLtp` at `index.tsx:558` (bar-open) and `index.tsx:628` (tick update); `spotFresh` gate (`index.tsx:510`) uses the same 8000ms `FRESH_TTL_MS`.

### Comparison
✅ Match

### Evidence
- `index.tsx:388,415,510,558,574,628,640`

### Recommendation
None.

---

## Call TLA / Put TLA / Future TLA / Spot TLA

### Client Specification
> `TLA = (2 × MMA) − High`, where MMA is that candle's already-computed MMA and High is the candle's own High. Applied identically to Call/Put/Future/Spot.

### Current Implementation
`tlaFromMMA(barMMA, barHigh)` (`calc/index.ts:117-119`) implements exactly `2 * barMMA - barHigh`. Called once per side per row, in both historical and live paths, always passing that same side's own MMA and own bar's High:
- Historical: `index.tsx:417-420` (`cTLA = tlaFromMMA(cMMA, callBar.h)` etc. for all four sides)
- Live bar-open: `index.tsx:581-584`
- Live tick update: `index.tsx:647-650`

### Comparison
✅ Match (all four sides)

### Evidence
- `calc/index.ts:117-119`
- `index.tsx:417-420,581-584,647-650`

### Recommendation
None.

---

## Ranking

### Client Specification
> `computeRanking()`: if both Call MMA and Put MMA valid, higher wins (tie → Call); if only one valid, that one wins by default; if neither valid, Ranking=0/winner="call". Display: `rankingDisplayValue()` prefixes `+` (green `#16A34A`) if higher than the previous row's Ranking, `−` (red `#DC2626`) if lower, no prefix if unchanged/first row (base cell text colour: blue `#1E40AF` Call won / amber `#78350F` Put won). The prefix reflects direction vs. previous candle, not magnitude.

### Current Implementation
`computeRanking()` (`calc/index.ts:127-138`) is byte-for-byte identical to the spec's described logic, including the tie-goes-to-Call rule (`callMMA - putMMA >= 0`) and the neither-valid fallback to `{value: 0, winner: "call"}`. It is invoked with `(cMMA, pMMA)` only — Future/Spot MMA never participate (`index.tsx:421,585,651`), confirming Ranking is Call-vs-Put-only.

Display (`Worksheet.tsx`): `rankingDir()` (`168-173`) compares current vs. previous row's `ranking` field and returns up/down/flat/none. `rankingDisplayValue()` (`230-237`) applies the `+`/`−` prefix — **but only when `row.ranking >= 0`** (line 233: `if ((dir === "up" || dir === "down") && row.ranking >= 0)`). Base colours: `C_RANK_CALL = { textColor: "#1E40AF" }`, `C_RANK_PUT = { textColor: "#78350F" }` (lines 155-156) — matches spec exactly. Direction colours `C_RANK_UP_TEXT = "#16A34A"`, `C_RANK_DOWN_TEXT = "#DC2626"` (lines 163-164) — matches spec exactly.

### Comparison
⚠️ Partial Match

The core Ranking value/winner computation and the base colour scheme match the spec exactly. However, the spec's description of the +/− prefix rule has no mention of any `ranking >= 0` condition — the spec states the prefix reflects "direction versus the previous candle" unconditionally. The current code additionally suppresses the prefix whenever the Ranking value itself is negative, even if that candle's Ranking moved up or down versus the prior row. Since `MMA_CLOSE_SIGN = -1` can occasionally make the winning MMA (and therefore Ranking) negative (e.g. a Call/Put candle where `Open+High+Low < |Close|`), this is a reachable, if rare, code path not accounted for in the spec.

### Evidence
- `calc/index.ts:127-138` — Ranking formula/winner (match)
- `Worksheet.tsx:155-156,163-164,168-173,230-237` — display; the extra `row.ranking >= 0` guard is at line 233

### Recommendation
Clarify with the client/spec author whether the `ranking >= 0` guard on the +/− prefix is an intentional business rule (e.g. "don't show + on a negative number") or an unintentional omission from the original spec. No code change is being made as part of this audit.

---

## SMC (nearest key level)

### Client Specification
> `smcNearest()`: candidates SWH/SWL (session Future high/low)/PDH/PDL; nearest to reference price wins. Historical: reference = Future Close, PDH/PDL = previous candle's Future High/Low. Live: reference = Future LTP, and **PDH/PDL are hardcoded to the same values as SWH/SWL** (`smcNearest(futLtp, sessHigh, sessLow, sessHigh, sessLow)`) — so the live row's SMC label can only ever show "SWH"/"SWL", never "PDH"/"PDL".

### Current Implementation
`smcNearest()` (`calc/index.ts:231-247`) unchanged. Historical row builder passes genuine previous-candle `pdh`/`pdl` (`index.tsx:409-410`, tracked via `prevH`/`prevL` updated each iteration at `index.tsx:440-441`; first row of the day falls back to its own H/L, `index.tsx:409-410`). Live rows call `smcNearest(futLtp, sessHigh, sessLow, sessHigh, sessLow)` verbatim at both the bar-open path (`index.tsx:604`) and the tick-update path (`index.tsx:669`) — confirming the exact hardcoded-duplicate behaviour the spec describes still exists unchanged.

### Comparison
✅ Match (the spec explicitly documents this live-row PDH/PDL limitation as current behaviour, and the current code still exhibits it identically)

### Evidence
- `calc/index.ts:231-247`
- `index.tsx:399-410,433 (historical)`, `604,669 (live, hardcoded sessHigh/sessLow as PDH/PDL)`

### Recommendation
This is a design limitation already flagged by the spec doc itself, not a new drift. If the client's actual business requirement is a genuine previous-*candle* high/low on the live row (rather than session high/low), that would require tracking a rolling previous-bar reference in the live-tick effect — out of scope for this read-only audit.

---

## FIB (Fibonacci retracement)

### Client Specification
> Ratios `[23.6, 38.2, 50.0, 61.8, 78.6]%`, `Level(ratio) = sessionHigh − (sessionHigh − sessionLow) × ratio`, nearest to reference price shown as `"<ratio>% <value, 2dp>"`. Guard: `sessionHigh ≤ sessionLow → null → "—"`. Reference price and session H/L identical to SMC's.

### Current Implementation
`fibLevels()`/`nearestFibLabel()` (`calc/index.ts:213-227`) unchanged — `FIB_RATIOS = [0.236, 0.382, 0.5, 0.618, 0.786]`, same level formula, same guard (`if (high <= low) return null`). Called with the same `sessionHigh`/`sessionLow`/reference-price values as SMC in both historical (`index.tsx:434`) and live (`index.tsx:605,670`) paths; `?? "—"` applied at the call site for the null case.

### Comparison
✅ Match

### Evidence
- `calc/index.ts:213-227`
- `index.tsx:434,605,670`

### Recommendation
None.

---

## RSI (period 14)

### Client Specification
> Wilder's smoothing, period 14 hardcoded. First 14 closes null; 15th seeds avgGain/avgLoss as simple averages; 16th+ uses Wilder recursive smoothing (`(avg×13 + change)/14`). Source: Future Close only, never Spot/Call/Put. Historical: one pass over all closed Future bars. Live: rolling 50-close buffer + current Future LTP re-run each tick; buffer updated with the just-closed Future Close on finalize.

### Current Implementation
`computeRsiSeries()` (`calc/index.ts:184-209`) — pushes `null` for the first `period` (14) entries, seeds `avgGain`/`avgLoss` as simple averages over indices 1..14, then applies Wilder recursion for index 15 onward (`avgGain*(period-1) + gain)/period`). This is formula-identical to the spec. Historical: `computeRsiSeries(futCloses)` called once (`index.tsx:387`) over `closedBars.map(b => b.c)` (Future closes only — line 386). Live: `prevRsiCloses` ref capped to last 50 via `.slice(-50)` (`index.tsx:444,548`), combined with `futLtp` and re-run through `computeRsiSeries()` every tick (`index.tsx:588,654`); only the series' last value is used. On bar finalize, `pb.futC` (the just-closed Future Close) is pushed into the buffer (`index.tsx:547-549`) — Call/Put/Spot values are never mixed in.

### Comparison
✅ Match

### Evidence
- `calc/index.ts:184-209`
- `index.tsx:386-387,444,547-549,588,654`

### Recommendation
None.

---

## EMA (period 20)

### Client Specification
> `k = 2/(period+1) = 2/21`. First 19 closes null; 20th seeds with simple average of first 20; 21st+ uses `Close×k + prevEMA×(1−k)`. Source: Spot Close (fallback Future if Spot bar missing). Live row recomputes provisionally every tick from the moving Spot LTP; on bar finalize, `prevEmaRef` is permanently updated from the just-closed bar's finalized Spot Close.

### Current Implementation
`computeEMASeries()` (`calc/index.ts:144-163`) — `k = 2/(period+1)`, `period` defaults to 20 (passed explicitly as `20` at every call site); nulls for `i < period-1`, seed at `i === period-1` as `seedSum/period`, recursive formula thereafter. Matches spec exactly. Historical: `computeEMASeries(spotCloses, 20)` (`index.tsx:390`) over `spotCloses = spotBarsForCalc.map(sb => sb.c)`, where `spotBarsForCalc` already applies the Spot→Future fallback (`index.tsx:388`). Series' last value seeds `prevEmaRef` (`index.tsx:394`). Live: provisional EMA computed every tick as `sLtp * k2 + prevEmaRef.current * (1 - k2)` (`index.tsx:591,657`, `k2 = 2/(20+1)`) using the still-moving `sLtp = spotLtp ?? futLtp`. On bar finalize (`index.tsx:536-541`), `prevEmaRef.current` is permanently updated using `pb.spotC` (the just-closed bar's finalized Spot Close), exactly as the spec describes.

### Comparison
✅ Match

### Evidence
- `calc/index.ts:144-163`
- `index.tsx:388-394,536-541,591,657`

### Recommendation
None.

---

## VWAP (not actually volume-weighted)

### Client Specification
> `TP = (H+L+C)/3`, `VWAP_n = (TP_1+…+TP_n)/n` (cumulative simple average). Historical: one pass, seeds `vwapStateRef {cumTP, count}`. Live: provisional `(storedCumTP + currentBarTP)/(storedCount+1)` recomputed fresh every tick without mutating stored state; on finalize, the just-closed bar's TP is permanently added and count incremented. Explicitly **not** volume-weighted — `OHLCBar` carries no volume field; this is a documented limitation, not a bug being reported here.

### Current Implementation
`computeVWAPSeries()` (`calc/index.ts:171-180`) — cumulative `TP` sum divided by running count, with an explicit code comment (`calc/index.ts:167-168`, `TODO: add v?: number to OHLCBar and weight by volume when available`) confirming volume weighting is intentionally omitted. Historical: `computeVWAPSeries(spotBarsForCalc)` (`index.tsx:391`), state seeded at `index.tsx:395-397` (`cumTPForState` summed manually, `count: closedBars.length`). Live: provisional `vwap = (vwapStateRef.current.cumTP + tp) / (vwapStateRef.current.count + 1)` computed fresh each tick (`index.tsx:593,659`) without mutating `vwapStateRef`; on finalize, `vwapStateRef.current.cumTP += ...` and `count++` (`index.tsx:542-543`).

### Comparison
✅ Match

### Evidence
- `calc/index.ts:167-168,171-180`
- `index.tsx:391,395-397,542-543,593,659`

### Recommendation
None (limitation is by design and already documented both in code and in the spec doc itself).

---

## Pivot Points (PP / R1-R3 / S1-S3)

### Client Specification
> "Status: NOT calculated for, or displayed in, the live table. No column exists for these values." Two formula variants (`clientPivot4Bar`, `classicPivot`) exist in `calc/index.ts` but are "never imported or called from `index.tsx`... or anywhere else in the frontend." `DashboardRow` "has no `pp`/`r1`/.../`s3` fields," and `Worksheet.tsx`'s `ALL_COLS` "has no corresponding entries — there is no UI surface for these values at all, hidden or otherwise." The `pivotMethod` toggle "only sets a piece of state... never read by any calculation."

### Current Implementation
The two formula variants are unchanged (`calc/index.ts:74-90`, byte-identical to spec). **However, the rest of the spec's "not implemented" description no longer matches the current code:**
- A dispatcher `pivotForBar(method, bar)` now exists (`calc/index.ts:99-104`) selecting between the two variants based on `pivotMethod`.
- `Worksheet.tsx`'s `ALL_COLS` **does** contain `pp`/`r1`/`r2`/`r3`/`s1`/`s2`/`s3` entries (lines 90-96), grouped under `indicators`.
- `getCellValue()` **does** compute these live, on demand, from `pivotForBar(pivotMethod, row.future)` (`Worksheet.tsx:304-310`) — not stored on `DashboardRow`, but computed per-render from the row's own Future bar.
- These 7 columns are excluded from the **visible** table via a dedicated `PIVOT_UI_HIDDEN` array (`Worksheet.tsx:43`), applied inside `getVisibleColumns()` (line 255) — a deliberate UI-only filter, separate from the user-togglable `hiddenCols`/`TYPE_HIDDEN` mechanism.
- `TimeframeRow.tsx`'s column-visibility panel (`ALL_COL_IDS`, lines 9-29) explicitly excludes the same 7 IDs, with a comment stating they are "calculated... but hidden from the worksheet UI, so they must not appear as togglable columns either."
- The `pivotMethod` toggle (`InfoBar` in `index.tsx:190-216`) **is** wired to `setPivotMethod()` (`store.ts:121-124`), which **is** read by `getCellValue()`/`pivotForBar()` on every render — it is not inert state as the spec claims.
- `excelExport.ts` reuses `getVisibleColumns()`/`getCellValue()` (lines 48,55), so the export inherits the same UI-hidden filter — Pivot columns are excluded from the exported file too, but for the same deliberate reason, not because they're uncalculated.

### Comparison
⚠️ Partial Match — formulas match the spec exactly, but the spec's central claim ("not calculated, no UI surface at all, toggle is inert") is factually out of date against the current working tree. The feature has been substantially built out since the spec doc was written; the only part of the original "not implemented" description still true is that the 7 columns are not *visible* in the worksheet or Excel export.

### Evidence
- `calc/index.ts:74-90 (formulas, unchanged), 97-104 (new dispatcher)`
- `Worksheet.tsx:43,90-96,255,304-310`
- `TimeframeRow.tsx:9-29`
- `index.tsx:190-216 (InfoBar toggle)`
- `store.ts:38,101,121-124 (pivotMethod state, read/write)`
- `excelExport.ts:48,55`

### Recommendation
Update/re-issue the client specification to reflect current behaviour (formulas wired, computed live, toggle functional, but 7 columns intentionally UI-hidden pending a client decision on whether to expose them). No code change made as part of this audit.

---

## Excel Export

### Client Specification
🚫 Client Specification Incomplete — `Module1_Calculations_And_Formulas.md`'s "Source files reviewed" list does not include `excelExport.ts`, and the document makes no formula/behavioural claims about Excel export anywhere. There is nothing in the designated spec to verify against.

### Current Implementation
`buildModule1Workbook()` (`excelExport.ts:44-82`) builds the sheet by calling `getVisibleColumns()`, `getCellValue()`, and `rankingDisplayValue()` — the exact same functions the live `Worksheet` component uses (`excelExport.ts:8-10,48,55`) — so the exported text is guaranteed to match what's on screen, column-for-column, including the same `PIVOT_UI_HIDDEN`/`TYPE_HIDDEN`/user `hiddenCols` filtering and the same Ranking +/− prefix logic (including the `ranking >= 0` guard noted above, since it reuses `rankingDisplayValue`). Group header cells are merged to mirror the live table's grouped header row (`excelExport.ts:60-70`). Filename pattern: `Module1_<SYMBOL>_<Timeframe>_<YYYY-MM-DD>.xlsx` (IST date, `excelExport.ts:76-79`). Triggered manually (Download Excel button, `TimeframeRow.tsx:262-278`) or automatically once per trading day at/after 15:45 IST (`index.tsx:687-724`).

### Comparison
🚫 Specification Incomplete (documented for completeness; no client baseline exists to compare against)

### Evidence
- `excelExport.ts:8-10,44-82`
- `TimeframeRow.tsx:262-278`
- `index.tsx:687-724`

### Recommendation
If Excel export behaviour needs client sign-off (e.g. confirming it's acceptable that hidden Pivot columns are also absent from the export), request an explicit spec addendum before treating any current behaviour as approved.

---

## Live Calculation Mechanics (cross-cutting)

### Client Specification
> Per-indicator "Calculation Process" sections describe: live row built from ticks every candle window; Future/Spot bars blanked (not re-stamped with stale prices) if no tick within 8000ms; RSI/EMA/VWAP carry state across candle boundaries via rolling buffers/refs, finalized on window rollover.

### Current Implementation
A single `setInterval(..., 500)` effect (`index.tsx:485-680`) drives all live recalculation. Each 500ms tick: (1) reads current OI/prices from the global store; (2) computes `windowStart` from the timeframe boundary; (3) if the window changed since last tick, finalizes the previous bar's carry-over state (EMA, VWAP, RSI buffer, session high/low — `index.tsx:536-552`) and opens a new bar; (4) otherwise, updates the existing bar's running H/L/C in place (`index.tsx:610-631`) and recomputes all derived values (MMA/TLA/Ranking/SMC/FIB/RSI/EMA/VWAP) from scratch every tick (`index.tsx:647-672`). The `FRESH_TTL_MS = 8000` freshness guard (`index.tsx:506-510`) blanks the *rendered* Future/Spot bar (not the internal tracking values) when no tick has arrived recently, matching the spec's description verbatim.

### Comparison
✅ Match

### Evidence
- `index.tsx:485-680` (main live effect), `506-510` (freshness guard), `536-552` (finalize/carry-over)

### Recommendation
None.

---

## Historical Calculation Mechanics (cross-cutting)

### Client Specification
> Historical rows computed once per config change from closed bars only; RSI/EMA/VWAP each run once over the full loaded series; the live-continuation state (`prevRsiCloses`, `prevEmaRef`, `vwapStateRef`) is seeded from the tail of that historical pass so the live row continues smoothly.

### Current Implementation
Effect 1 (`index.tsx:254-477`) fetches Future/Call/Put/Spot OHLC in parallel, filters to `closedBars` (bars strictly before the current live window start, `index.tsx:381-383`), and for non-custom timeframes additionally filters to the current trading session via a UTC-midnight + 3h45m offset (`index.tsx:366-372`), which correctly resolves to 09:15 IST session open (UTC-midnight + 3:45 = 03:45 UTC = 09:15 IST). It then runs `computeRsiSeries`/`computeEMASeries`/`computeVWAPSeries` once each (`index.tsx:387,390-391`) and builds one `DashboardRow` per closed bar via `appendRow` (`index.tsx:404-442`). The historical pass's tail values seed `prevEmaRef`, `vwapStateRef`, `prevRsiCloses`, `swHighRef`, `swLowRef` (`index.tsx:394-397,444-446`) for live continuity — matching the spec's description.

### Comparison
✅ Match

### Evidence
- `index.tsx:254-477` (Effect 1), `366-383` (session/closed-bar filtering), `387-397,404-446` (calc + seeding)

### Recommendation
None. (Note: the 09:15 IST session-open derivation via UTC-midnight offset is not discussed in the designated spec doc at all — flagged here only as supplementary evidence, not a discrepancy, since the resulting behaviour is correct.)

---

## Display Logic (global truncation rule)

### Client Specification
> `const p0 = (n) => n == null || !Number.isFinite(n) ? "—" : Math.trunc(n).toLocaleString("en-IN")`. Applies to every numeric column (OHLC, MMA, TLA, Ranking, RSI, EMA, VWAP) — truncates toward zero, does not round, whole numbers only, `en-IN` grouping. Full-precision values are always used as calculation inputs; only rendered text is truncated.

### Current Implementation
`Worksheet.tsx:208-209` contains the identical function, verbatim. Applied at every numeric cell in `getCellValue()` (lines 264-310, including Pivot columns) and to Pivot values too. `SMC`/`FIB` remain string columns bypassing `p0` (`Worksheet.tsx:296-297`), consistent with spec. `rankingDisplayValue()` (line 232) also builds on `p0(row.ranking)` before adding the +/− prefix.

### Comparison
✅ Match

### Evidence
- `Worksheet.tsx:208-209,264-310`

### Recommendation
None. (The spec doc separately notes a pre-existing mismatch between this `p0` truncation behaviour and the *in-app* help text in `docs/content.ts` claiming 2-decimal/rounded display — that in-app doc is out of scope for this audit since the user designated `Module1_Calculations_And_Formulas.md`, not `docs/content.ts`, as the spec of record. Still unresolved in the current code as of this audit.)

---

## Warm-up Logic

### Client Specification
> RSI: first 14 candles show "—"; needs 15 closes to produce a value. EMA: first 19 candles show "—"; needs 20 closes to seed. VWAP: no warm-up — produces a value from the very first candle.

### Current Implementation
`computeRsiSeries()` pushes `null` for `i < period` (14 nulls, indices 0-13), first real value appears at index 14 (the 15th close) — `calc/index.ts:188-200`. `computeEMASeries()` pushes `null` for `i < period-1` (19 nulls, indices 0-18), seeds at index 19 (the 20th close) — `calc/index.ts:150-156`. `computeVWAPSeries()` produces `cumTP/(i+1)` starting at `i=0` — no warm-up delay at all — `calc/index.ts:174-177`. All three match the spec exactly.

### Comparison
✅ Match

### Evidence
- `calc/index.ts:150-156,174-177,188-200`

### Recommendation
None.

---

# Final Summary Table

| Feature | Client Spec | Current Code | Status | Action Required |
|---|---|---|---|---|
| Call MMA | `(O+H+L−C)/4` | Match | ✅ | None |
| Put MMA | `(O+H+L−C)/4` | Match | ✅ | None |
| Future MMA | `(O+H+L−C)/4`, 8s freshness gate | Match | ✅ | None |
| Spot MMA | `(O+H+L−C)/4`, Spot→Future fallback | Match | ✅ | None |
| Call TLA | `2×MMA−High` | Match | ✅ | None |
| Put TLA | `2×MMA−High` | Match | ✅ | None |
| Future TLA | `2×MMA−High` | Match | ✅ | None |
| Spot TLA | `2×MMA−High` | Match | ✅ | None |
| Ranking | Higher MMA wins, tie→Call, +/− prefix vs prev row | Formula matches; display has an undocumented `ranking >= 0` guard on the prefix | ⚠️ | Confirm with client whether the guard is intentional |
| SMC | Nearest of SWH/SWL/PDH/PDL; live row PDH/PDL hardcoded = SWH/SWL | Match (including the documented live-row limitation) | ✅ | None |
| FIB | 5 Fibonacci levels of session Future range | Match | ✅ | None |
| RSI | Wilder period 14, Future closes only | Match | ✅ | None |
| EMA | Period 20, Spot closes (fallback Future) | Match | ✅ | None |
| VWAP | Cumulative avg of TP, not volume-weighted | Match | ✅ | None |
| Pivot Points (PP/R1-R3/S1-S3) | "Not calculated, no UI at all, toggle inert" | Formulas match, but fully computed/wired/UI-hidden-by-design — spec is stale | ⚠️ | Re-issue spec to reflect current (UI-hidden, calculated) state |
| Excel Export | Not covered by designated spec doc | Mirrors live table exactly via shared column/format helpers | 🚫 | Obtain explicit spec if export behaviour needs sign-off |
| Live Calculation Mechanics | Tick-driven, 8s freshness gate, carry-over on finalize | Match | ✅ | None |
| Historical Calculation Mechanics | One pass over closed bars, seeds live state | Match | ✅ | None |
| Display Logic | `Math.trunc` + `en-IN`, whole numbers everywhere | Match | ✅ | None |
| Warm-up Logic | RSI 14/EMA 19 nulls, VWAP none | Match | ✅ | None |
