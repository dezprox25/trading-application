# Module 1 – MMA, TLA & Indicator Formulas Documentation

This document is a factual audit of the **current implementation** of the MMA, TLA and Indicator
columns in Module 1. No code was changed to produce this report. No bugs were fixed. Where the
running code differs from other in-app documentation, or where a value is not actually calculated,
this is stated explicitly (see the **Notes / Discrepancies** boxes).

**Source files reviewed:**
- `apps/frontend/src/calc/index.ts` — pure calculation engine (formulas)
- `apps/frontend/src/modules/dashboard/index.tsx` — row builder (wires inputs → formulas, historical + live)
- `apps/frontend/src/modules/dashboard/Worksheet.tsx` — cell rendering / display formatting
- `apps/frontend/src/modules/dashboard/store.ts` — dashboard state (incl. `pivotMethod`)
- `apps/frontend/src/modules/docs/content.ts` — existing in-app user documentation (cross-checked, not authoritative)

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

**Status: NOT calculated for, or displayed in, the live table. No column exists for these values.**

**Purpose (as originally intended):** Classic/4-Bar pivot-point support/resistance levels.

**Formula (defined but unused)** — two pivot variants exist in `calc/index.ts:74-90`, both dead code
as far as the dashboard row builder is concerned:
```
4-Bar variant (clientPivot4Bar):
    PP = (Open + High + Low + Close) / 4
    R1 = 2×PP − Low        S1 = 2×PP − High
    R2 = PP + (High−Low)   S2 = PP − (High−Low)
    R3 = High + 2×(PP−Low) S3 = Low − 2×(High−PP)

Classic variant (classicPivot):
    PP = (High + Low + Close) / 3
    R1 = 2×PP − Low        S1 = 2×PP − High
    R2 = PP + (High−Low)   S2 = PP − (High−Low)
    R3 = High + 2×(PP−Low) S3 = Low − 2×(High−PP)
```

**Input Values:** N/A — never invoked.

**Calculation Process:** N/A. `clientPivot4Bar()` and `classicPivot()` are exported from
`calc/index.ts` (source comment: *"Legacy pivot calculations, kept for reference; not used in v2
row builder"*) but are **never imported or called** from `index.tsx` (the row builder) or anywhere
else in the frontend. `DashboardRow` (the row data model) has no `pp`/`r1`/`r2`/`r3`/`s1`/`s2`/`s3`
fields, and `Worksheet.tsx`'s `ALL_COLS` table-column list has no corresponding entries — there is
no UI surface for these values at all, hidden or otherwise.

**Displayed Value:** None. There is nothing to hide/show — the columns do not exist in the table.

> **⚠ Note:** The `pivotMethod` toggle (`store.ts`, the "PP" / "4-Bar" / "Classic" control in the
> title bar, currently hidden from the UI per a separate change) only sets a piece of state
> (`"client" | "classic"`) that is saved to `localStorage`. It is never read by any calculation —
> it does not select between `clientPivot4Bar`/`classicPivot`, and it has no effect on the Ranking,
> MMA, TLA, or any of the 31 table columns. This matches the existing in-app documentation's own
> admission (`docs/content.ts`, section 11): *"The 'PP' toggle in the title bar is a legacy control
> from an earlier version of the table and currently has no effect on the 31 columns."*

---

## Summary of flagged items (for visibility — no action taken)

| # | Item | Type | Detail |
|---|------|------|--------|
| 1 | Display formatting | Discrepancy | All numeric columns truncate to whole numbers (`Math.trunc`); in-app docs claim 2-decimal display for option-side columns and rounding for index-side columns — neither matches the code. |
| 2 | `MMA_CLOSE_SIGN = -1` | Hardcoded | MMA formula subtracts Close instead of adding it, per client spec, but this halves the effective option-price scale and makes TLA frequently negative. Flagged as intentional-but-unusual in the code's own comments. |
| 3 | SMC `PDH`/`PDL` on live rows | Hardcoded | Live rows pass `sessHigh`/`sessLow` in place of genuine previous-candle High/Low, so the live row's SMC label can never show `"PDH"`/`"PDL"`, only `"SWH"`/`"SWL"`. |
| 4 | VWAP volume weighting | Not implemented | No volume field exists on `OHLCBar`; VWAP is actually an unweighted cumulative average of Typical Price, despite the name. |
| 5 | Pivot Points (PP/R1-R3/S1-S3) | Not calculated | Formulas exist in `calc/index.ts` but are never called; no table column exists for them. The "PP" toggle changes only unused state. |
| 6 | RSI/EMA/VWAP source | Confirmed by design | RSI always uses Future closes; EMA/VWAP always use Spot closes (falling back to Future only when a Spot bar is missing for that timestamp). Ranking only ever compares Call MMA vs Put MMA — Future/Spot MMA never participate. |
