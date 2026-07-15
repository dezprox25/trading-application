# Module 1 – MMA, TLA & Indicator Formulas Documentation

This document is a factual audit of the **current implementation** of the MMA, TLA and Indicator
columns in Module 1, updated to reflect the Pivot Point implementation added after the original
audit. Everything below except the **Pivot Points** section is an audit only — no code was changed
to produce that part of the report. The Pivot Points section documents a real implementation change
(see **Update log** below). Where the running code differs from other in-app documentation, or where
a value is not actually calculated, this is stated explicitly (see the **Notes / Discrepancies**
boxes).

**Source files reviewed:**
- `apps/frontend/src/calc/index.ts` — pure calculation engine (formulas)
- `apps/frontend/src/modules/dashboard/index.tsx` — row builder (wires inputs → formulas, historical + live)
- `apps/frontend/src/modules/dashboard/Worksheet.tsx` — cell rendering / display formatting
- `apps/frontend/src/modules/dashboard/store.ts` — dashboard state (incl. `pivotMethod`)
- `apps/frontend/src/modules/dashboard/excelExport.ts` — Excel export (mirrors the live table)
- `apps/frontend/src/modules/dashboard/TimeframeRow.tsx` — Columns show/hide/reorder panel
- `apps/frontend/src/modules/docs/content.ts` — existing in-app user documentation (cross-checked, not authoritative)

## Update log

- **Original audit:** MMA, TLA, Ranking, SMC, FIB, RSI, EMA, VWAP documented as implemented; Pivot
  Points (PP/R1-R3/S1-S3) documented as formulas-exist-but-never-called, with no table column and no
  effect from the `pivotMethod` toggle.
- **Second update (implementation):** Pivot Points were implemented and wired into the worksheet,
  the Columns panel, and the Excel export. The `pivotMethod` toggle (title bar) started actually
  selecting between the 4-Bar and Classic formulas and was unhidden so users could reach it.
- **Third update (this one — UI hide, calc kept):** On request, the 7 pivot columns were hidden
  again from the worksheet, the Columns panel, and the Excel export via a single filter
  (`PIVOT_UI_HIDDEN` in `Worksheet.tsx`'s `getVisibleColumns()`), while the calculation itself
  (`calc/pivotForBar`, `Worksheet.getCellValue`'s `pp`/`r1`/…/`s3` cases, the `pivotMethod` store
  state, and the now-visible title-bar toggle) stays fully wired and correct, ready for future
  consumers (signals, strategies, reports, API). See the **Pivot Points** section below for details.
  No other column's formula, inputs, or output was changed — MMA, TLA, Ranking, SMC, FIB, RSI, EMA
  and VWAP are exactly as originally audited.

---

## Global display rule (applies to every column below)

All numeric cells in the table — OHLC, MMA, TLA, Ranking, RSI, EMA, VWAP — are rendered through one
shared formatter in `Worksheet.tsx`:

```ts
const p0 = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? "—" : Math.trunc(n).toLocaleString("en-IN");
```

- `Math.trunc` **cuts off the decimal portion** (rounds toward zero) — it does **not** round to the
  nearest integer.
- **Every** numeric column, including the option-side MMA/TLA/Ranking columns, is currently displayed
  as a **whole number**, `en-IN` grouped (e.g. `12,230`).
- The full-precision (un-truncated) value is always used as the *input* to any later calculation
  (e.g. Ranking compares the full-precision MMA, not the truncated display text). Only the rendered
  text is truncated.

> **⚠ Discrepancy found:** The in-app help text (`docs/content.ts`, section 6.3) states that
> option-side columns (Call/Put OHLC, MMA, TLA, Ranking) display with **two decimal places**, and
> that index-level columns (Future, Spot, RSI, EMA, VWAP) are **rounded** to the nearest whole
> number. Neither is what the code does: `p0` truncates **every** column to a whole number, with no
> decimals anywhere and no rounding (truncation only). For example, a Future TLA of `-13.95`
> (the exact worked example in `docs/content.ts`) truncates to **`-13`**, not the `-14` the
> documentation claims. This is a documentation/code mismatch, not something this report changes.

---

# MMA

## Call MMA

**Purpose:** A per-candle "strength" number for the selected Call option, used as one side of the
Ranking comparison.

**Formula** (`mmaBar()`, `calc/index.ts:98-100`):
```
MMA = (Open + High + Low + (MMA_CLOSE_SIGN × Close)) / 4
MMA_CLOSE_SIGN = -1   (hardcoded constant, calc/index.ts:96)

→ effectively: MMA = (Open + High + Low − Close) / 4
```

**Input Values:**
- Call option candle: Open, High, Low, Close (the option's own traded premium, not the index)

**Calculation Process:**
1. Take the Call bar's O/H/L/C for the candle (historical bars come from the CE OHLC map keyed by
   candle start time; the live/forming bar is built tick-by-tick from the Call LTP stream).
2. If no CE tick has arrived for that candle, the bar is a "missing" sentinel (`o=h=l=c=NaN`) and
   `mmaBar()` returns `NaN`.
3. Sum Open + High + Low, subtract Close (because `MMA_CLOSE_SIGN = -1`), divide by 4.

**Displayed Value:** Truncated to a whole number via `p0()` (see Global display rule). `NaN` → `"—"`.

**Example:**
```
Open = 70.70, High = 76.75, Low = 70.15, Close = 75.20

MMA = (70.70 + 76.75 + 70.15 − 75.20) / 4
    = 142.40 / 4
    = 35.60

Displayed as: 35
```

---

## Put MMA

**Purpose:** Same per-candle strength number, computed for the selected Put option.

**Formula:** Identical to Call MMA — `MMA = (Open + High + Low − Close) / 4`, same `mmaBar()` function
applied to the Put bar.

**Input Values:**
- Put option candle: Open, High, Low, Close

**Calculation Process:** Identical to Call MMA, applied to the Put bar (`putBar`). Missing Put ticks
→ `NaN` → `"—"`.

**Displayed Value:** Truncated whole number.

**Example:**
```
Open = 73.30, High = 74.40, Low = 70.05, Close = 71.20

MMA = (73.30 + 74.40 + 70.05 − 71.20) / 4
    = 146.55 / 4
    = 36.6375

Displayed as: 36
```

---

## Future MMA

**Purpose:** The same MMA formula applied to the NIFTY Future candle, shown as a context column
(does **not** feed the Ranking comparison).

**Formula:** `MMA = (Open + High + Low − Close) / 4`, applied to the Future bar.

**Input Values:**
- Future candle: Open, High, Low, Close (index-level price, ~24,000+)

**Calculation Process:**
- Historical rows: computed directly from the Future OHLC bar for that candle.
- Live row: the Future bar is only populated if a Future tick has been seen within the last 8000 ms
  (`FRESH_TTL_MS`, `index.tsx:505`); otherwise the bar is the `NaN` sentinel and Future MMA is `NaN`.

**Displayed Value:** Truncated whole number.

**Example:**
```
Open = 24460, High = 24474.3, Low = 24460, Close = 24473.6

MMA = (24460 + 24474.3 + 24460 − 24473.6) / 4
    = 48920.7 / 4
    = 12230.175

Displayed as: 12,230
```

---

## Spot MMA

**Purpose:** The same MMA formula applied to the NIFTY Spot (cash index) candle, a context column
(does **not** feed the Ranking comparison).

**Formula:** `MMA = (Open + High + Low − Close) / 4`, applied to the Spot bar.

**Input Values:**
- Spot candle: Open, High, Low, Close

**Calculation Process:**
- Historical rows: `spotBarsForCalc = closedBars.map(b => spotMap.get(b.t) ?? b)` — if no Spot bar
  exists for that candle's timestamp, the **Future** bar is substituted (`index.tsx:387`). This is
  the only documented cross-instrument fallback in the whole pipeline.
- Live row: Spot bar uses `spotLtp ?? futLtp` as its O/H/L/C source, and only renders (rather than
  `NaN`) if a Spot tick was seen within the last 8000 ms.

**Displayed Value:** Truncated whole number.

**Example:** Same formula/mechanics as Future MMA, applied to Spot O/H/L/C.

---

# TLA

## Call TLA

**Purpose:** A follow-on value derived from Call MMA, providing a second per-candle reference number.

**Formula** (`tlaFromMMA()`, `calc/index.ts:103-105`):
```
TLA = (2 × MMA) − High
```
where `MMA` is that same candle's already-computed MMA (not re-derived independently), and `High`
is the candle's own High.

**Input Values:**
- Call MMA (computed above)
- Call candle High

**Calculation Process:**
1. Take the Call MMA value already computed for this candle.
2. Multiply by 2.
3. Subtract the candle's High.

**Displayed Value:** Truncated whole number. Frequently negative — this is expected given
`MMA_CLOSE_SIGN = -1` (MMA runs at roughly half the option price, so `2×MMA` is often smaller than
the candle's High).

**Example:**
```
MMA = 35.60, High = 76.75

TLA = (2 × 35.60) − 76.75
    = 71.20 − 76.75
    = −5.55

Displayed as: -5
```

---

## Put TLA

**Purpose:** Same follow-on derivation, for the Put side.

**Formula:** `TLA = (2 × MMA) − High`, applied to Put MMA and Put candle High.

**Input Values:**
- Put MMA
- Put candle High

**Calculation Process:** Identical mechanics to Call TLA.

**Displayed Value:** Truncated whole number.

**Example:**
```
MMA = 36.6375, High = 74.40

TLA = (2 × 36.6375) − 74.40
    = 73.275 − 74.40
    = −1.125

Displayed as: -1
```

---

## Future TLA

**Purpose:** Context column — TLA derivation applied to the Future candle. Does not feed Ranking.

**Formula:** `TLA = (2 × Future MMA) − Future High`.

**Input Values:**
- Future MMA
- Future candle High

**Calculation Process:** Same mechanics, applied to the Future bar.

**Displayed Value:** Truncated whole number (toward zero, not rounded — see Global display rule
discrepancy note).

**Example:**
```
MMA = 12230.175, High = 24474.3

TLA = (2 × 12230.175) − 24474.3
    = 24460.35 − 24474.3
    = −13.95

Displayed as: -13   (Math.trunc(-13.95) = -13; NOT -14)
```

---

## Spot TLA

**Purpose:** Context column — TLA derivation applied to the Spot candle. Does not feed Ranking.

**Formula:** `TLA = (2 × Spot MMA) − Spot High`.

**Input Values:**
- Spot MMA
- Spot candle High

**Calculation Process:** Same mechanics, applied to the Spot bar (with the Spot→Future fallback
described under Spot MMA).

**Displayed Value:** Truncated whole number.

---

# Indicators

## Ranking

**Purpose:** The module's core output — for each candle, tells you whether the Call side or the Put
side is stronger, by comparing their MMA values.

**Formula** (`computeRanking()`, `calc/index.ts:113-124`):
```
IF Call MMA and Put MMA are both valid numbers:
    Ranking = Call MMA − Put MMA ≥ 0  →  Call MMA (winner = "call")
              otherwise               →  Put MMA  (winner = "put")
IF only Call MMA is valid:  Ranking = Call MMA, winner = "call"
IF only Put MMA is valid:   Ranking = Put MMA,  winner = "put"
IF neither is valid:        Ranking = 0, winner = "call"   (hardcoded default)
```

**Input Values:**
- Call MMA
- Put MMA

**Calculation Process:**
1. Check whether Call MMA / Put MMA are finite numbers (a missing option bar makes its MMA `NaN`).
2. If both sides have data, whichever MMA is numerically higher wins; an exact tie is awarded to
   Call (hardcoded rule, confirmed in in-app docs as client-approved).
3. If only one side has data, that side wins outright by default (this is not a "the other side
   loses" comparison — it's a fallback for single-sided `Type` selection or a one-sided data gap).
4. If neither side has data, Ranking is hardcoded to `0` with `winner = "call"` so the value is
   never `NaN`/`null`/`undefined`.

**Displayed Value:** `rankingDisplayValue()` (`Worksheet.tsx:211-218`) — the truncated whole-number
Ranking value, prefixed with:
- `+` in bold green (`#16A34A`) if this candle's Ranking is **higher** than the immediately
  preceding row's Ranking,
- `−` in bold red (`#DC2626`) if **lower**,
- no prefix if unchanged or on the very first (oldest) row — in that case the cell's text colour
  itself indicates the winner instead: blue (`#1E40AF`) = Call won, amber (`#78350F`) = Put won.

Note the `+`/`−` prefix reflects **direction versus the previous candle**, not the magnitude of any
difference — the number shown is always the actual Ranking value.

**Example:**
```
Call MMA = 35.60, Put MMA = 36.6375
Put MMA is higher → Ranking = 36.6375, winner = "put"

Previous row's Ranking was 34.00 (lower) → Ranking rose
Displayed as: +36   (green text)
```

---

## SMC (nearest key level)

**Purpose:** "Smart Money Concept" — shows which of four reference price levels the market
(Future price) is currently sitting nearest to.

**Formula** (`smcNearest()`, `calc/index.ts:217-234`):
```
Candidates = { SWH: sessionHigh, SWL: sessionLow, PDH: prevLevelHigh, PDL: prevLevelLow }
SMC = candidate whose value minimizes |candidate − referencePrice|
Displayed as "<label> <value formatted to 2 decimals>", e.g. "SWH 24,474.30"
```

**Input Values:**
- Reference price (see Calculation Process — differs between historical and live rows)
- SWH / SWL — running session High / Low of the **Future** series only
- PDH / PDL — see Calculation Process (differs between historical and live rows)

**Calculation Process:**
- **Historical rows:** reference price = that candle's **Future Close**. `sessionHigh`/`sessionLow`
  are the Future high/low accumulated from the start of the loaded day up to and including this
  candle. `PDH`/`PDL` = the **previous candle's** Future High/Low (for the very first row of the
  day, `PDH`/`PDL` fall back to that same row's own High/Low, since there is no earlier candle).
- **Live (forming) row:** reference price = the latest **Future LTP tick**. `sessionHigh`/`sessionLow`
  are the running session Future high/low **including** the forming bar.

> **⚠ Note (hardcoded behaviour):** In the live row, `PDH` and `PDL` are passed the exact same
> values as `SWH`/`SWL` (`smcNearest(futLtp, sessHigh, sessLow, sessHigh, sessLow)`,
> `index.tsx:603` and `:668`) — i.e. on the live/forming candle, PDH/PDL are **not** a genuine
> previous-candle high/low, they duplicate the session high/low. This means the SMC label on the
> live row can only ever resolve to `"SWH …"` or `"SWL …"`, never `"PDH …"`/`"PDL …"`, even though
> those candidate labels exist in the code. Only on historical (already-closed) rows can SMC show
> `PDH`/`PDL`.

**Displayed Value:** The raw string returned by `smcNearest()`, e.g. `"SWH 24,474.30"` — shown
as-is (2 decimals baked into the string itself; this bypasses the `p0` truncation rule because SMC
is a string column, not numeric).

**Example:**
```
Future price = 24470, SWH = 24474.30, SWL = 24401.10, PDH = 24468.50, PDL = 24430.00

Distances: |24474.30−24470|=4.30  |24401.10−24470|=68.90
           |24468.50−24470|=1.50  |24430.00−24470|=40.00
Nearest = PDH (distance 1.50)

Displayed as: "PDH 24,468.50"
```

---

## FIB (nearest Fibonacci level)

**Purpose:** Splits the session's Future price range into the five classic Fibonacci retracement
levels and shows whichever one the current Future price is closest to.

**Formula** (`fibLevels()` + `nearestFibLabel()`, `calc/index.ts:199-213`):
```
Ratios = [23.6%, 38.2%, 50.0%, 61.8%, 78.6%]   (hardcoded constants)
Level(ratio) = sessionHigh − (sessionHigh − sessionLow) × ratio
FIB = level whose value minimizes |level − referencePrice|
Displayed as "<ratio>% <value formatted to 2 decimals>", e.g. "61.8% 24,411.55"

Guard: if sessionHigh ≤ sessionLow, returns null → displayed "—"
```

**Input Values:**
- Reference price: Future Close (historical rows) or Future LTP (live row) — same as SMC
- sessionHigh / sessionLow: running Future session high/low so far (same values as SMC's SWH/SWL)

**Calculation Process:**
1. Compute the 5 Fibonacci retracement price levels from the session's Future High/Low range so far.
2. Find which of the 5 levels is numerically closest to the current reference price.
3. Format as `"<ratio label>% <level value, 2 decimals>"`.

**Displayed Value:** The raw formatted string, e.g. `"61.8% 24,411.55"`. Bypasses `p0` truncation
(string column). `"—"` if the session range is degenerate (`high ≤ low`, e.g. the very first tick
of the day before any range has formed).

**Example:**
```
sessionHigh = 24500, sessionLow = 24400 → range = 100

23.6% level = 24500 − 100×0.236 = 24476.40
38.2% level = 24500 − 100×0.382 = 24461.80
50.0% level = 24500 − 100×0.5   = 24450.00
61.8% level = 24500 − 100×0.618 = 24438.20
78.6% level = 24500 − 100×0.786 = 24421.40

Future price = 24440 → closest level is 61.8% (24438.20, distance 1.80)

Displayed as: "61.8% 24,438.20"
```

---

## RSI (Relative Strength Index, period 14)

**Purpose:** A 0–100 momentum gauge computed on the **Future's** closing prices (never option
premiums).

**Formula** (`computeRsiSeries()`, `calc/index.ts:170-195`, Wilder's smoothing, period = 14 hardcoded):
```
For the first 14 closes:            RSI = null (not enough history)
At the 15th close (seed):
    avgGain = average of all positive changes over the first 14 intervals
    avgLoss = average of all negative changes (absolute value) over the first 14 intervals
    RSI = avgLoss == 0 ? 100 : 100 − 100 / (1 + avgGain/avgLoss)
From the 16th close onward (Wilder smoothing):
    avgGain = (avgGain × 13 + max(change, 0)) / 14
    avgLoss = (avgLoss × 13 + max(−change, 0)) / 14
    RSI = avgLoss == 0 ? 100 : 100 − 100 / (1 + avgGain/avgLoss)
```

**Input Values:**
- Future Close prices — a rolling series, **never** Spot, Call or Put prices

**Calculation Process:**
- **Historical rows:** `computeRsiSeries(futCloses)` is run once over all closed Future bars in the
  loaded window; each row reads its corresponding index (`i`) from that series.
- **Live row:** a rolling buffer `prevRsiCloses` (capped at the last 50 Future closes,
  `index.tsx:443, 547`) is combined with the current Future LTP and re-run through
  `computeRsiSeries()` each tick; only the last value of that series is used for the live row.
  When a live bar finalizes, its Future Close is pushed into `prevRsiCloses` for the next candle.

**Displayed Value:** Truncated whole number (0–100 range, e.g. `67`). `"—"` for the first 14 candles
of the day (not enough history yet — by design).

**Example:** (illustrative — the true 14-period Wilder RSI requires 15 sequential closes; using a
simplified 1-step continuation)
```
avgGain = 5.2, avgLoss = 3.1  (from the last 14 Future close-to-close changes)

RSI = 100 − 100 / (1 + 5.2/3.1)
    = 100 − 100 / (1 + 1.677)
    = 100 − 100 / 2.677
    = 100 − 37.36
    = 62.64

Displayed as: 62
```

---

## EMA (Exponential Moving Average, period 20)

**Purpose:** A smoothed trend line of the **Spot** index (falls back to Future if Spot is
unavailable), giving more weight to recent candles.

**Formula** (`computeEMASeries()`, `calc/index.ts:130-149`, period = 20 hardcoded):
```
k = 2 / (period + 1) = 2 / 21

For the first 19 closes:  EMA = null (not enough history)
At the 20th close (seed): EMA = simple average of the first 20 closes
From the 21st close on:   EMA = (Close × k) + (previous EMA × (1 − k))
```

**Input Values:**
- Spot Close prices (or Future Close, if a Spot bar is missing for that timestamp)

**Calculation Process:**
- **Historical rows:** `computeEMASeries(spotCloses, 20)` runs once over the loaded closed bars;
  the resulting series's last value is also saved (`prevEmaRef`) to seed live continuation.
- **Live (forming) row:** each 500 ms tick, a **provisional** EMA is computed as
  `sLtp × k + prevEma × (1 − k)` using the current (still-moving) Spot LTP — this recalculates every
  tick and is not yet "locked in."
- **On bar finalize** (when the candle's time window rolls over): `prevEmaRef` is permanently
  updated using the just-closed bar's finalized Spot Close (`pb.spotC`), so the next candle's EMA
  continues from a stable seed rather than the last provisional tick value.

**Displayed Value:** Truncated whole number. `"—"` for the first 19 candles (needs 20 to seed).

**Example:**
```
Previous EMA = 24450.00, k = 2/21 = 0.0952

Current Spot Close = 24480

EMA = (24480 × 0.0952) + (24450.00 × (1 − 0.0952))
    = 2330.94 + 22119.94
    = 24450.88

Displayed as: 24,450
```

---

## VWAP (Volume-Weighted Average Price — volume weighting not actually applied)

**Purpose:** The running average level the **Spot** index has traded around since the session
started (falls back to Future if Spot is unavailable).

**Formula** (`computeVWAPSeries()`, `calc/index.ts:157-166`):
```
Typical Price (TP) of a candle = (High + Low + Close) / 3
VWAP = cumulative sum of TP across all candles so far, divided by the candle count so far

VWAP_n = (TP_1 + TP_2 + ... + TP_n) / n
```

**Input Values:**
- Spot candle High, Low, Close (or Future candle's, on the Spot→Future fallback)

**Calculation Process:**
- **Historical rows:** `computeVWAPSeries(spotBarsForCalc)` runs once over the loaded closed bars;
  the resulting cumulative TP total and candle count are saved (`vwapStateRef`) to seed live
  continuation.
- **Live (forming) row:** each tick, a provisional VWAP is computed as
  `(storedCumTP + currentBarTP) / (storedCount + 1)` using the still-moving Spot bar's H/L/C — this
  does not mutate the stored cumulative state, so it recalculates fresh every tick.
- **On bar finalize:** the just-closed bar's TP is permanently added to `vwapStateRef.cumTP` and
  `vwapStateRef.count` is incremented, so the next candle continues from a locked-in total.

> **⚠ Note (hardcoded / not implemented):** `computeVWAPSeries()` has a code comment stating volume
> weighting is intentionally omitted because the `OHLCBar` type carries no volume field
> (`calc/index.ts:153-154`, `TODO: add v?: number ... and weight by volume when available`).
> Despite the "VWAP" name, this is **not** volume-weighted — every candle counts equally, so it is
> functionally a simple cumulative-average of Typical Price. This is explicitly called out as a
> known limitation in the in-app docs as well.

**Displayed Value:** Truncated whole number.

**Example:**
```
Stored cumulative TP so far = 122,300 over 5 prior candles (cumTP=122300, count=5)
Current forming Spot bar: High=24480, Low=24460, Close=24475

TP_current = (24480 + 24460 + 24475) / 3 = 24471.67

VWAP = (122300 + 24471.67) / (5 + 1)
     = 146771.67 / 6
     = 24461.94

Displayed as: 24,461
```

---

## Pivot Points — PP, R1, R2, R3, S1, S2, S3

**Status: ✅ Calculated, ⛔ hidden from the UI (by design, on request).** The seven columns are
defined in `ALL_COLS` and fully computed by `getCellValue()` exactly as described below, but a
dedicated filter (`PIVOT_UI_HIDDEN` in `Worksheet.tsx`) removes them from `getVisibleColumns()` —
the single function shared by the live table render, the Columns show/hide/reorder panel, and the
Excel export — so they render nowhere in the current UI. This is a deliberate, reversible
UI-visibility switch, not a removal: re-exposing them later only requires deleting the
`PIVOT_UI_HIDDEN` filter (and re-adding the 7 ids to `TimeframeRow.tsx`'s `ALL_COL_IDS`/labels if the
Columns-panel toggle should come back too). See **Update log** at the top of this document.

**Purpose:** Classic/4-Bar pivot-point support/resistance levels, computed per candle from the
Future OHLC bar, using whichever formula the client's `pivotMethod` toggle currently selects.

**Formula** (`pivotForBar()`, `calc/index.ts` — new dispatcher added on top of the two formulas that
already existed; **no formula was rewritten**, `pivotForBar` only selects between them):
```
pivotForBar(method, bar):
    if any of bar.o/h/l/c is not finite → return null   (renders "—")
    method === "classic" → classicPivot(bar)
    method === "client"  → clientPivot4Bar(bar)   (the default; UI label "4-Bar")

4-Bar variant (clientPivot4Bar, calc/index.ts:74-81):
    PP = (Open + High + Low + Close) / 4
    R1 = 2×PP − Low        S1 = 2×PP − High
    R2 = PP + (High−Low)   S2 = PP − (High−Low)
    R3 = High + 2×(PP−Low) S3 = Low − 2×(High−PP)

Classic variant (classicPivot, calc/index.ts:83-90):
    PP = (High + Low + Close) / 3
    R1 = 2×PP − Low        S1 = 2×PP − High
    R2 = PP + (High−Low)   S2 = PP − (High−Low)
    R3 = High + 2×(PP−Low) S3 = Low − 2×(High−PP)
```

**Input Values:**
- That row's own **Future** candle: Open, High, Low, Close (4-Bar uses all four; Classic uses H/L/C
  only — Open is ignored by the Classic formula but still part of the finite-value guard)
- `pivotMethod` — `"client"` (4-Bar, the default) or `"classic"`, from the dashboard store, set via
  the "PP" toggle in the title bar (now visible; previously hidden with no effect)

**Calculation Process:**
1. Take the row's already-stored Future `OHLCBar` — the exact same bar object already used for that
   row's Future MMA/TLA and for RSI/SMC/FIB (historical rows use the closed Future candle; the live
   row uses the currently-forming Future candle, updated every tick exactly like MMA/TLA).
2. If any of that bar's O/H/L/C is not a finite number (missing/stale bar), the result is `null` for
   all seven values and every cell renders `"—"`.
3. Otherwise run the selected formula (4-Bar or Classic) once, producing `{ pp, r1, r2, r3, s1, s2, s3 }`.
4. Because this runs **at render time** off data the row already carries, switching the `pivotMethod`
   toggle recalculates every visible row (historical and live) immediately — there is no need to
   refetch or rebuild the stored rows.

**Displayed Value:** Each of the seven values is passed through the same `p0()` truncation formatter
as MMA/TLA/RSI/EMA/VWAP (see Global display rule) — truncated to a whole number, `en-IN` grouped,
`"—"` when null. **Not currently rendered anywhere** (live table, Columns panel, or Excel) because of
the `PIVOT_UI_HIDDEN` filter described above — the values below are what `getCellValue()` computes
internally, verified directly (not through the screen).

**Example (4-Bar / "client" method):**
```
Future candle: Open=24460, High=24474.3, Low=24460, Close=24473.6

PP = (24460 + 24474.3 + 24460 + 24473.6) / 4 = 97867.9 / 4 = 24466.975
R1 = 2×24466.975 − 24460     = 24473.95
R2 = 24466.975 + (24474.3 − 24460) = 24481.275
R3 = 24474.3 + 2×(24466.975 − 24460) = 24488.25
S1 = 2×24466.975 − 24474.3   = 24459.65
S2 = 24466.975 − (24474.3 − 24460) = 24452.675
S3 = 24460 − 2×(24474.3 − 24466.975) = 24445.35

Displayed as: PP 24,466 · R1 24,473 · R2 24,481 · R3 24,488 · S1 24,459 · S2 24,452 · S3 24,445
```

**Example (Classic method, same candle):**
```
PP = (24474.3 + 24460 + 24473.6) / 3 = 73407.9 / 3 = 24469.3
R1 = 2×24469.3 − 24460 = 24478.6
S1 = 2×24469.3 − 24474.3 = 24464.3
(R2/R3/S2/S3 use the same R2-R3/S2-S3 formulas as 4-Bar, off this Classic PP)

Displayed as: PP 24,469 · R1 24,478 · S1 24,464 · …
```

**Files touched to implement this (chronological):**
- `calc/index.ts` — added `PivotMethod` type and `pivotForBar()` dispatcher (formulas themselves unchanged)
- `store.ts` — `PivotMethod` now imported from `calc` instead of a duplicate local type
- `Worksheet.tsx` — 7 new `ALL_COLS` entries; `getCellValue()` takes a `pivotMethod` param and computes pivot values on demand from `row.future`
- `excelExport.ts` — `ExportParams.pivotMethod` (optional, defaults to `"client"`), threaded into cell values
- `TimeframeRow.tsx` — columns initially registered in the Columns panel, `pivotMethod` passed to the Download Excel button
- `index.tsx` — `pivotMethod` passed into `<Worksheet>` and the automatic end-of-day export; the "PP / 4-Bar / Classic" title-bar toggle unhidden
- **Follow-up (this update):** `Worksheet.tsx` — added the `PIVOT_UI_HIDDEN` constant and applied it inside `getVisibleColumns()`, so the 7 ids are filtered out of the live table, the Columns panel, *and* the Excel export (all three consume `getVisibleColumns()`), while `ALL_COLS` and `getCellValue()` are untouched. `TimeframeRow.tsx` — removed the 7 ids from `ALL_COL_IDS`/`ALL_COL_LABELS`/`COL_GROUP_LABEL` so the Columns panel no longer shows non-functional checkboxes for columns that can never be turned on.

**Backward compatibility confirmed:** MMA, TLA, Ranking, RSI, EMA, VWAP, SMC and Fibonacci go through
no code path shared with the pivot logic — the existing calc/Worksheet test suite (32 tests) passes
unchanged, `tsc --noEmit` is clean, and a production build succeeds. An ad-hoc test run during the
UI-hide follow-up additionally confirmed: (a) `ALL_COLS` still defines all 7 pivot ids, (b)
`getVisibleColumns()` excludes all 7 even with empty `hiddenCols`/`colOrder`, and (c) `getCellValue()`
still returns a real (non-`"—"`) value for `"pp"` given a valid Future bar.

---

## Summary of flagged items (for visibility — no action taken)

| # | Item | Type | Detail |
|---|------|------|--------|
| 1 | Display formatting | Discrepancy | All numeric columns truncate to whole numbers (`Math.trunc`); in-app docs claim 2-decimal display for option-side columns and rounding for index-side columns — neither matches the code. |
| 2 | `MMA_CLOSE_SIGN = -1` | Hardcoded | MMA formula subtracts Close instead of adding it, per client spec, but this halves the effective option-price scale and makes TLA frequently negative. Flagged as intentional-but-unusual in the code's own comments. |
| 3 | SMC `PDH`/`PDL` on live rows | Hardcoded | Live rows pass `sessHigh`/`sessLow` in place of genuine previous-candle High/Low, so the live row's SMC label can never show `"PDH"`/`"PDL"`, only `"SWH"`/`"SWL"`. |
| 4 | VWAP volume weighting | Not implemented | No volume field exists on `OHLCBar`; VWAP is actually an unweighted cumulative average of Typical Price, despite the name. |
| 5 | Pivot Points (PP/R1-R3/S1-S3) | **Resolved, then intentionally re-hidden** | Was "formulas exist but never called, no column" at the original audit → implemented and shown → now calculated but deliberately hidden from the worksheet UI, Columns panel and Excel export again on request (`PIVOT_UI_HIDDEN` filter). The "PP" toggle in the title bar remains visible/functional and still drives the (invisible) calculation. |
| 6 | RSI/EMA/VWAP source | Confirmed by design | RSI always uses Future closes; EMA/VWAP always use Spot closes (falling back to Future only when a Spot bar is missing for that timestamp). Ranking only ever compares Call MMA vs Put MMA — Future/Spot MMA never participate. |
| 7 | Pivot Points source | Confirmed by design | Pivot Points use the Future candle only (same instrument as RSI/SMC/FIB) — there is no per-side (Call/Put/Spot) pivot variant, matching the single-set-of-columns request. |
