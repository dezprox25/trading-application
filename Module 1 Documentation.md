# MODULE 1 — Complete Functional Documentation

**Product:** SYNERGY · Trading Dashboard (Module 1)
**Document date:** 6 July 2026
**Audience:** Client · Product Owner · QA Team · Future Developers · Business Team
**Basis:** Every statement in this document is derived from direct inspection of the source code (file and line references included) and, where noted, from live-market verification performed on 6 July 2026 during NSE market hours. Where a fact cannot be proven from the code, the document states: *"Unable to determine from the current implementation."*

---

# SECTION 1 — MODULE OVERVIEW

## 1.1 Purpose

Module 1 is a **live intraday market-data worksheet for NIFTY index derivatives**. It shows, side by side and per candle interval, the price action of four instruments:

1. A user-selected **Call option (CE)** contract
2. A user-selected **Put option (PE)** contract
3. The nearest active **NIFTY Futures** contract
4. The **NIFTY 50 Spot** index

and derives, for every candle, the client-specified analytical columns **MMA, TLA, Ranking** plus the indicators **SMC, FIB, RSI, EMA, VWAP** — presented in an Excel-style table that updates live.

## 1.2 Business goal

Give a trading consultant a single screen that answers, per timeframe: *"How are the Call and Put premiums of my chosen strike behaving relative to the Future and the Spot right now, and which side (Call vs Put) is dominant?"* The Ranking column (higher of Call MMA vs Put MMA) is the module's core decision output.

## 1.3 Problem it solves

Without this module the user would need a broker terminal open on 4 instruments plus a spreadsheet to compute MMA/TLA/Ranking manually per candle. Module 1 automates the whole chain: broker connectivity, contract resolution, tick capture, candle aggregation, formula computation, and live rendering.

## 1.4 Workflow (user journey)

1. **Application login** — user registers/logs in (email + password + OTP verification) and receives a JWT (`components/Auth.tsx`, backend `controllers/auth.ts`).
2. **Broker login (Module 1)** — user submits Zebu broker credentials; the backend performs Zebu QuickAuth and starts the live market-data feed (`POST /api/auth/module1-broker-login`, `controllers/brokerAuth.ts:22`).
3. **Automatic base feed** — the frontend socket joins the permanent `NIFTY-SPOT` and `NIFTY-FUT` rooms; the header immediately shows live Spot and Future prices (`hooks/useSocket.ts:82-86`).
4. **Configuration** — the user selects Exchange → Instrument → Contract Month → Expiry Date → Type → Call/Put Strike in the header (`modules/dashboard/ConfigRow.tsx`).
5. **Generate** — clicked manually, or fired automatically once the selection is complete and the backend confirms live data (`market_ready`); the module fetches history, joins the option tick rooms, asks the backend to subscribe the exact contracts on the broker feed, and starts building rows (`modules/dashboard/index.tsx` Effect 1; `hooks/useSocket.ts`).
6. **Live operation** — closed candles form historical rows; the newest row rebuilds every 500 ms from live ticks until its window closes and the next row begins.
7. **Reset / reconfigure** — Reset clears the table; changing any selection re-triggers the flow.

## 1.5 High-level architecture

```
Zebu (Noren) broker WebSocket  wss://go.mynt.in/NorenWS/
        │  raw touchline ticks (token-keyed deltas)
        ▼
Backend (Node/Express/Socket.io, port 5001)
  zebuMarketDataClient  → parse ticks, map token→symbol
  dataFeed              → tick router (Redis LTP cache, OI ingest, OHLC fan-out)
  ohlcAggregator        → 12 timeframes per symbol, finalize on boundary
  MongoDB (FuturesOHLC) → finalized candles (25 h TTL)
  Upstash Redis         → ltp:/oi: cache (coalesced writes)
  socketService         → per-symbol tick rooms, OI broadcast, market_ready
        │  Socket.io (`tick`, `market_ready`, `latest-oi`, `broker_status`)
        ▼
Frontend (React/Vite, zustand)
  useSocket   → socket lifecycle, room joins, subscribe:options
  useStore    → global price/OI cache
  useDashStore→ dashboard selection + rows
  Dashboard   → Effect 1 (history fetch) + Effect 2 (500 ms live bar builder)
  calc/       → MMA/TLA/Ranking/EMA/VWAP/RSI/FIB/SMC formulas
  Worksheet   → 31-column Excel-style table
```

## 1.6 Overall data flow (summary — full detail in Section 7)

Broker tick → backend parses & routes → OHLC aggregated into 12 timeframes → finalized candles persisted to MongoDB (+ in-memory cache) → LTP cached in Redis → tick broadcast to Socket.io rooms → frontend price cache → 500 ms row builder computes formulas → Worksheet renders.

---

# SECTION 2 — HEADER DETAILS

All header fields live in `apps/frontend/src/modules/dashboard/ConfigRow.tsx`; selection state lives in `apps/frontend/src/modules/dashboard/store.ts` (`useDashStore`).

## 2.1 Spot (live price box)

| Attribute | Value |
|---|---|
| Name | Spot |
| Purpose | Live NIFTY 50 index price with tick-direction arrow (▲ green / ▼ red) |
| Type | Read-only display, number formatted to 2 decimals (en-IN locale) |
| Default | "—" until first tick |
| Value source | Socket `tick` events for symbol `NIFTY-SPOT` → `useStore.prices["NIFTY-SPOT"].ltp` (`ConfigRow.tsx:13-28, 150`) |
| Editable | No |
| Validation | None (display only) |
| Dependencies | Socket connected; broker feed live; permanent room join (`useSocket.ts:82-86`) |
| Backend API | None (WebSocket only). Backend tick source: Zebu token `NSE\|26000` (`zebuMarketDataClient.ts:83`) |
| Effect on Generate | None directly; Spot ticks also drive the backend's ATM strike-band logic |
| Effect on calculations | The same price feeds the live Spot OHLC bar, EMA and VWAP in the newest row |

## 2.2 Future (live price box)

Identical mechanics to Spot but for symbol `NIFTY-FUT` (`ConfigRow.tsx:151`). Backend tick source: the nearest-expiry NIFTY futures token resolved daily from the NFO instrument master (`instrumentTokenService.ts:163-181`; at the time of writing `NFO|61093`, expiry 2026-07-28). The first valid `NIFTY-FUT` tick triggers the backend `market_ready` event (`socketService.ts:180-186`) which enables auto-Generate.

## 2.3 Exchange

| Attribute | Value |
|---|---|
| Purpose | Top of the dependent selection chain |
| Type | Dropdown |
| Default | `NFO` (auto-selected on load; `ConfigRow.tsx:193-198`, `DEFAULT_EXCHANGE` in `data/liveApi.ts:19`) |
| Options | NFO, NSE, BSE, MCX, CDS — from a **static frontend catalog** (`liveApi.ts:11-17`), not a backend API |
| Editable | Yes |
| Validation | Changing it resets Instrument, Contract Month, Expiry and both Strikes (`store.ts:108`) |
| Backend API | None (static catalog; code comments state it will later proxy the broker Instruments API) |
| Effect on Generate | Required (`canGenerate` check, `ConfigRow.tsx:227-230`) |

## 2.4 Instrument

| Attribute | Value |
|---|---|
| Purpose | Underlying index selection |
| Type | Dropdown, disabled until Exchange chosen |
| Default | Empty ("Select…") |
| Options | For NFO: NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, SENSEX, BANKEX (`liveApi.ts:21-32`). Other exchanges: empty list ("No data") |
| Editable | Yes; change resets Contract Month, Expiry, Strikes (`store.ts:109`) |
| Backend API | None (static catalog) |
| Effect on Generate | Required. Also used verbatim in the option symbol: `${instrument}${expiry}C${strike}` (`index.tsx:317-319`) |
| Effect on calculations | Determines the futures OHLC URL: `{instrument}-FUT` (`index.tsx:301-303`). **Note:** the live tick feed and header prices are hard-wired to NIFTY symbols, so instruments other than NIFTY will not receive live data in the current implementation. |

## 2.5 Contract Month

| Attribute | Value |
|---|---|
| Purpose | Narrows the expiry list to one calendar month |
| Type | Dropdown (label e.g. "JUL 2026"; internal id `"2026-07"`) |
| Default | Empty; disabled until Instrument chosen |
| Options | Current month + next 3, generated client-side (`liveApi.ts:65-82`) |
| Editable | Yes; change resets Expiry and Strikes (`store.ts:110`) |
| Backend API | None (client-side generation) |
| Effect on Generate | Required; is a dependency of the history-fetch effect (`index.tsx:477`) |

## 2.6 Expiry Date

| Attribute | Value |
|---|---|
| Purpose | Selects the exact option contract expiry |
| Type | Dropdown (display "07 Jul 2026"; internal ISO `"2026-07-07"`) |
| Default | Empty; disabled until Contract Month chosen |
| Options | Generated client-side from `EXPIRY_RULES` (`liveApi.ts:37-44, 84-114`): NIFTY = every **Tuesday** of the month (weekly); BANKNIFTY/FINNIFTY/MIDCPNIFTY = last Tuesday (monthly); SENSEX = every Thursday; BANKEX = last Thursday. Past dates filtered out. |
| Editable | Yes; change reloads strikes and re-fetches history (`index.tsx:477` dependency list) |
| Validation | Selection must still exist after a parent change, else cleared (`ConfigRow.tsx:212-216`) |
| Backend API | None for the list itself. The chosen value is converted to broker format `07JUL26` by `formatExpiryForBroker` (`data/models.ts:66-71`) and used in OHLC URLs and `subscribe:options`. The backend independently validates it against the live NFO instrument master (`resolveOptionInstrument`, `instrumentTokenService.ts:337-357`). |
| Effect on Generate | Required |
| Effect on calculations | Part of the CE/PE symbol; wrong expiry ⇒ backend resolve fails ⇒ Call/Put columns show "—" |

**Verified live (2026-07-06):** the NFO master's real NIFTY expiries (07/14/21/28 Jul …) match the Tuesday rule used by the frontend catalog.

## 2.7 Type

| Attribute | Value |
|---|---|
| Purpose | Chooses which option legs are active |
| Type | 3-state toggle: `Call + Put` / `Call` / `Put` |
| Default | `Call+Put` (`store.ts:96`) |
| Editable | Yes (no cascade reset) |
| Backend API | Sent in the `subscribe:options` payload as `type` (`useSocket.ts` / `socketService.ts:96-98`) |
| Effect on Generate | Determines which strikes are mandatory (`canGenerate`, `ConfigRow.tsx:224-230`) |
| Effect on calculations | `Call` hides all Put columns and skips PE fetch/subscription; `Put` vice-versa (`Worksheet.tsx TYPE_HIDDEN:29-33`; `index.tsx:315-319`) |

## 2.8 Call Strike / Put Strike

| Attribute | Value |
|---|---|
| Purpose | Strike price of the CE / PE contract |
| Type | Dropdowns, disabled until Expiry chosen; hidden when Type excludes that side |
| Default | Empty (null) |
| Options | From `GET /api/market/option-chain/NIFTY50` (`liveApi.ts:118-128`). The backend **generates ATM ± 5 strikes in 50-point steps** around the Redis-cached spot price (`controllers/market.ts:336-368`) — it does *not* read the strike list from the broker instrument master. |
| Editable | Yes |
| Validation | Cleared automatically if no longer present after an expiry change (`ConfigRow.tsx:218-222`). Final validation is the backend NFO-master lookup at subscribe time — an unlisted strike logs `resolve FAILED` and is ignored (verified live). |
| Backend API | `GET /api/market/option-chain/:index` |
| Effect on Generate | Required for the active side(s) |
| Effect on calculations | Embedded in the CE/PE symbol; all Call/Put columns derive from the chosen contracts |

## 2.9 Generate button

- Enabled only when `exchange && instrument && contractMonth && expiryDate` and the strike(s) required by Type are set (`ConfigRow.tsx:227-230`).
- On click: `generate()` clears rows, bumps `generateKey`, sets `isGenerated=true` (`store.ts:116`), which triggers the full Generate workflow (Section 8).
- **Auto-Generate:** fires once, automatically, when the selection is complete *and* the backend has emitted `market_ready` (first valid NIFTY-FUT tick) (`ConfigRow.tsx:232-253`).

## 2.10 Reset button

Visible only while generated. Sets `isGenerated=false`, clears rows, feed status → idle (`store.ts:117`). Selections are retained.

## 2.11 Time

There is **no standalone clock in the header**. Time is presented as the frozen first table column "Date & Time" (per-row candle open time, rendered in IST — `Worksheet.tsx:168-176`) and via the timeframe row's live status indicator. Unable to determine any other header time element from the current implementation.

## 2.12 Live indicator

In the timeframe row (`TimeframeRow.tsx:117-133, 241-249`): a coloured dot + label bound to `feedStatus` — Live (green), Interrupted (amber), Connecting (blue), Market Closed (grey), Auth Required (amber), API Error (red), Connection Lost (red), Idle (grey). `feedStatus` is driven by the Generate workflow and `broker_status` socket events (`useSocket.ts:167-206`).

## 2.13 Columns button

"⛶ Columns" popover (`TimeframeRow.tsx:251-348`): show/hide any of the 31 columns (checkboxes) and drag-to-reorder. Preferences persist per user in `localStorage` (`m1_cols_<userId>`, `m1_col_order_<userId>` — `store.ts:152-175`).

## 2.14 Collapse button

"▲" collapses the config row into a one-line summary strip (SPOT price, FUT price, selection breadcrumb); click to expand (`ConfigRow.tsx:257-292, 451-462`).

## 2.15 PP toggle (InfoBar)

The dark title bar contains a "PP" toggle (4-Bar / Classic) bound to `pivotMethod` (`index.tsx InfoBar:163-216`, `store.ts:122-125`). The two pivot formulas exist in `calc/index.ts:74-90`, but **no consumer of `pivotMethod` exists in the v2 31-column row builder** — the toggle currently has no effect on the table (legacy of the pre-v2 layout, kept in code).

---

# SECTION 3 — TIMEFRAME BUTTONS

Pills in `TimeframeRow.tsx:4-5`: `1m 2m 3m 5m 10m 15m 30m 45m | 1h 2h 3h 4h | 📅 Custom`. Selecting one sets `timeframe` in the store and clears any custom range, which re-runs the history effect (dependency `timeframe`, `index.tsx:477`).

## 3.1 Standard timeframes (all twelve)

| Property | Behaviour (identical mechanics for every TF; only the interval differs) |
|---|---|
| Meaning / candle interval | 1m = 1 minute per candle … 4h = 240 minutes per candle |
| Backend API | `GET /api/market/ohlc/:symbol/:tf` (`routes/market.ts:28` → `controllers/market.ts:154-227`) |
| Mongo usage | Reads `FuturesOHLC` documents `{symbol, timeframe, bar_time ≥ today's 03:45 UTC session open}`, newest 400, de-duplicated by `bar_time` |
| Fallbacks | If Mongo is empty/unavailable → in-memory finalized-candle cache (`getCachedOHLCBars`); the currently-forming candle is appended as the newest data point (`market.ts:210-220`) |
| OHLC aggregation | Backend-side, per tick, all 12 TFs simultaneously (`dataFeed.ts:266-279`). Boundary rule (`ohlcAggregator.ts:90-110`): TF < 60 min → floor to UTC-epoch multiples of the interval; TF ≥ 60 min → anchored to session open 09:15 IST so the first bar starts at market open (1h bars: 09:15, 10:15…; 2h: 09:15, 11:15; 3h: 09:15, 12:15; 4h: 09:15, 13:15) |
| Refresh behaviour | Selecting the TF refetches history (closed bars only) and restarts the 500 ms live-bar builder with the new window size (`index.tsx:373-378, 482-486`) |
| Dependencies | Generated state; market open; broker connected |

**Verified live (2026-07-06):** all 12 timeframes × 4 symbols returned bars with 0 misaligned boundaries, 0 duplicates, 0 ordering errors.

## 3.2 Custom

Selecting **Custom** opens a panel (`TimeframeRow.tsx:351-411`): candle interval (any of the 12), From / To datetime pickers (defaults: today 09:15 → 15:30 IST), Apply, Clear.

- Validation: both dates required, must parse, From < To (`handleApplyCustomRange:135-143`).
- Backend API: `GET /api/market/ohlc-history/:symbol/:tf?from=ISO&to=ISO` (`market.ts:233-283`) — Mongo range query, ascending, **no** in-memory/active-candle fallback.
- Behaviour differences: no market-status gate, no session filter, no live row building (Effect 2 skips custom — `index.tsx:483`), spot OHLC not fetched (the spot column falls back to the future bar).
- Practical retention limit: the Mongo TTL deletes bars older than 25 h (Section 13), so Custom can only reach ~1 trading day back.
- Until Apply is pressed the table shows the "Select a Date Range" panel (`custom-pending` status).

---

# SECTION 4 — TABLE STRUCTURE

`Worksheet.tsx` renders a two-row header: group headers (row 1) and column sub-headers (row 2), both sticky. 31 columns in 7 groups (`ALL_COLS`, `Worksheet.tsx:37-76`):

| Group | Columns | Why the group exists |
|---|---|---|
| **DATE & TIME** | 1 (frozen left) | Anchor for every row: candle open time (IST). Frozen so it stays visible during horizontal scroll. |
| **CALL** | Open, High, Low, Close, Call MMA, Call TLA | Price action + client formulas for the selected CE contract — one half of the trading decision. |
| **PUT** | Open, High, Low, Close, Put MMA, Put TLA | The same for the selected PE contract — the other half. |
| **RANKING** | Ranking | The module's core output: which side (Call/Put MMA) dominates this candle. |
| **FUTURE** | Open, High, Low, Close, Future MMA, Future TLA | Direction of the underlying future — context for the option legs; also the input for RSI/SMC/FIB. |
| **SPOT** | Open, High, Low, Close, Spot MMA, Spot TLA | Cash-index reference; input for EMA and VWAP. |
| **INDICATORS** | SMC, FIB, RSI, EMA, VWAP | Supplementary technical context per candle. |

Additional structural elements:

- **Conditional colouring** of OHLC cells (`ohlcColor`, `Worksheet.tsx:113-130`): High cell green, Low cell red, Open blue (unless it equals H/L), Close green/red by bull/bear. Ranking cell blue when Call wins, amber when Put wins.
- **Type-based hiding**: Type=Call hides the 6 Put columns; Type=Put hides the 6 Call columns (`TYPE_HIDDEN:29-33`).
- **User hiding/reordering** via the Columns popover (Section 2.13).
- **Row order**: newest candle at the top (`displayRows = [...rows].reverse()`, `Worksheet.tsx:267`).
- **Status bar** (bottom): row count, copy hint, formula legend.
- **Dev-only frozen-column banner**: warns if every row of a column shows an identical value (`Worksheet.tsx:304-324`).
- **Range selection + Ctrl/Cmd-C** copies cells as TSV (`copySelection:269-292`).

---

# SECTION 5 — EVERY COLUMN

Shared conventions proven from code, applying to all numeric columns:

- **Rendering/rounding:** `p0()` (`Worksheet.tsx:165-166`) — `Math.floor(value)` then en-IN locale string. This is **truncation toward −∞, not rounding** (74.9 → "74"). Null/NaN → "—".
- **Missing-value handling:** a candle with no data for a side is the `MISSING_BAR` NaN sentinel (`index.tsx:28`); NaN propagates through MMA/TLA/Ranking and renders "—". **No cross-instrument fallback exists** for Call/Put (`index.tsx:410-412` comment and code; verified by 14 unit tests in `__tests__/frozenColGuard.test.ts` and live).
- **Update frequency:** historical rows are computed once at Generate; the newest (live) row is rebuilt every 500 ms (`index.tsx` Effect 2).
- **Data type:** number (except Date & Time, SMC, FIB, which are strings).

### 5.1 Date & Time (`datetime`)
Frozen first column. Candle open timestamp `row.t` formatted `DD Mon HH:MM` in Asia/Kolkata (`fmtDateTime`, `Worksheet.tsx:168-176`). Source: the future bar's `openTime` (historical) or the live window start (live). No formula.

### 5.2–5.5 Call Open / High / Low / Close (`ce-o/h/l/c`)
- **Purpose:** OHLC of the selected CE contract's premium for this candle.
- **Data source (historical):** `GET /api/market/ohlc/<CE-symbol>/<tf>` → Mongo `FuturesOHLC` (symbol e.g. `NIFTY07JUL26C24400`) → `ceMap` keyed by openTime → `row.call` (`index.tsx:322-352, 410`).
- **Data source (live):** socket `tick` events in room `market:<CE-symbol>` → `useStore.prices[ceSymbol].ltp`, folded into the live bar: first tick back-fills Open, H=max, L=min, C=last (`index.tsx:600-607`).
- **Backend origin:** Zebu tick for the resolved NFO token (e.g. `NFO|44654`); Redis `ltp:<sym>` cache; Mongo persisted candle; WebSocket room broadcast.
- **Formula:** none (raw aggregation).
- **Missing/fallback:** no CE tick yet ⇒ NaN ⇒ "—". Never the Future's price.
- **Example (live-verified):** 04:59 UTC 1m candle `O=73.1 H=74.2 L=70.75 C=74.2` for `NIFTY07JUL26C24400`.
- **Edge cases:** a strike outside the backend's ATM±5 dropdown cannot be selected; an unlisted strike/expiry fails backend resolution (logged) and the columns stay "—".

### 5.6 Call MMA (`mma-c`)
- **Formula:** `MMA = (O + H + L + (−1) × C) / 4` — `mmaBar`, `calc/index.ts:96-100`, applied to `row.call`.
- **Inputs:** the Call bar's O, H, L, C. **Output:** number (≈ half the premium with the −1 sign).
- **Update:** per row build (500 ms live).
- **⚠ Open client confirmation:** the code comment (`calc/index.ts:93-95`) states the −1 sign is "as written by the client; change to +1 if confirmed a typo".
- **Example (live 5m bar):** O=70.7 H=76.75 L=70.15 C=75.2 → MMA = (70.7+76.75+70.15−75.2)/4 = **35.60**.

### 5.7 Call TLA (`tla-c`)
- **Formula:** `TLA = 2 × MMA − High` — `tlaFromMMA`, `calc/index.ts:103-105`.
- **Example:** 2×35.60 − 76.75 = **−5.55** (negative values are mathematically expected with the −1 MMA sign and render as negative integers).

### 5.8–5.13 Put Open/High/Low/Close/MMA/TLA (`pe-*`, `mma-p`, `tla-p`)
Identical mechanics to the Call columns, sourced from the PE symbol (e.g. `NIFTY07JUL26P24400`, token `NFO|44655`), `row.put`. Live example (5m): O=73.3 H=74.4 L=70.05 C=71.2 → MMA=36.64, TLA=−1.13.

### 5.14 Ranking (`ranking`)
- **Formula:** `computeRanking(callMMA, putMMA)` (`calc/index.ts:110-113`): if `callMMA − putMMA ≥ 0` → value=callMMA, winner="call"; else value=putMMA, winner="put".
- **Weightage:** none — a direct maximum of the two MMAs; Future/Spot are not inputs.
- **Sorting:** none — computed per row independently.
- **Output:** number + cell colour (blue = Call wins, amber = Put wins; `Worksheet.tsx:132-150`).
- **Tie behaviour:** Call wins on an exact tie (code comment flags this as unconfirmed by the client).
- **Edge case (verified defect):** if callMMA is a real number and putMMA is NaN, the NaN comparison makes *Put* "win" with value NaN → renders "—" even though Call data exists. (The mirror case Put-real/Call-NaN correctly shows the Put value.)
- **Example:** call 35.60 vs put 36.64 → Ranking **36** (floored), Put-coloured.

### 5.15–5.20 Future Open/High/Low/Close/MMA/TLA (`fut-*`)
- **Source:** symbol `{instrument}-FUT` (live feed exists for `NIFTY-FUT` only) — historical via the OHLC API, live via `prices["NIFTY-FUT"]` (`index.tsx:494`).
- **Freshness guard (live row):** if no Future tick arrived within **8 s** (`FRESH_TTL_MS`, `index.tsx:505`), the rendered Future bar goes "—" instead of re-stamping a stale price; internal tracking continues so max/min stay correct when ticks resume (`index.tsx:566-572, 626-632`).
- MMA/TLA: identical formulas on `row.future`. Example (live 5m): O=24460 H=24474.3 L=24460 C=24473.6 → MMA=12,230.18 → cell "12230"; TLA=−13.95 → "-14".

### 5.21–5.26 Spot Open/High/Low/Close/MMA/TLA (`spot-*`)
- **Source:** `NIFTY-SPOT` (NSE|26000). Historical spot OHLC is fetched separately (`index.tsx:326-328`); if a spot bar is missing for a timestamp, **the future bar is used as the spot fallback** (`spotMap.get(bar.t) ?? bar`, `index.tsx:412`) — the only cross-instrument fallback in the table, and by design. Live: `prices["NIFTY-SPOT"].ltp ?? futLtp` (`index.tsx:556`).
- Same 8 s freshness guard as Future. MMA/TLA: identical formulas on `row.spot`.

### 5.27 SMC (`smc`)
- **Formula:** `smcNearest(close, swHigh, swLow, pdh, pdl)` (`calc/index.ts:206-223`) — returns the label + value of whichever of SWH (session-window high), SWL (session-window low), PDH, PDL is numerically nearest to the reference price. Output string, e.g. `"SWH 24,474.30"`.
- **Historical inputs:** future close; running session high/low; PDH/PDL = **previous bar's** high/low (despite the "previous day" naming) (`index.tsx:400-407, 430`).
- **Live inputs:** future LTP; `swHighRef/swLowRef` used for both the SW and PD slots (`index.tsx:593, 652`).
- **Verified defect (live rows):** on each live-bar rollover the code merges the finished bar's **Call** high/low into `swHighRef/swLowRef` (`index.tsx:545-546`), so the session low becomes an option premium (~70) instead of a future price — degrading live SMC and corrupting FIB (below). Historical rows are unaffected.

### 5.28 FIB (`fib`)
- **Formula:** `nearestFibLabel(price, high, low)` (`calc/index.ts:195-202`) — computes the 5 retracement levels 23.6/38.2/50/61.8/78.6 % of the high−low range (`fibLevels:190-193`) and returns the nearest one to the price, e.g. `"61.8% 24,411.55"`.
- Historical: future close vs session high/low. Live: future LTP vs `swHighRef/swLowRef` — affected by the same defect as SMC once option data flows.

### 5.29 RSI (`rsi`)
- **Formula:** Wilder RSI, period 14 (`computeRsiSeries`, `calc/index.ts:159-184`): first value = SMA of gains/losses over 14 changes, then Wilder smoothing `avg = (avg×13 + change)/14`; `RSI = 100 − 100/(1+RS)`; null until 15 closes exist.
- **Historical input:** Future closes (`index.tsx:383-384`).
- **Live input (verified defect):** the rolling series is seeded with Future closes but each finished live bar appends the **Call** close (`index.tsx:543, 577, 637`), producing a mixed series whose first option-close insertion registers a ≈ −24,000 "loss" and pins live RSI near 0. Historical rows are correct.
- Renders a floored integer; null → "—".

### 5.30 EMA (`ema`)
- **Formula:** EMA period 20 on **Spot closes**, seeded with the SMA of the first 20 values, then `EMA = close×k + prevEMA×(1−k)`, k = 2/21 (`computeEMASeries`, `calc/index.ts:119-138`). Null (renders "—") until 20 closed bars exist — by design, not a defect.
- Live continuation: the previous EMA is carried in `prevEmaRef` and advanced per finished live bar; the forming bar shows a provisional EMA using the current spot close (`index.tsx:539-541, 579-580`).

### 5.31 VWAP (`vwap`)
- **Formula:** session-cumulative average of Typical Price TP = (H+L+C)/3 over **Spot bars**: `VWAP_n = Σ TP / n` (`computeVWAPSeries`, `calc/index.ts:146-155`). **Volume weighting is not implemented** (OHLC bars carry no per-bar volume on the frontend; a code TODO documents this).
- Live continuation via `vwapStateRef` (cumTP, count) (`index.tsx:392-394, 581-582`).
- Live-verified example: 24,372.32 with spot at 24,408.

### Hidden / derived / other columns
- No columns exist beyond the 31 listed; hiding is user- or Type-driven only.
- `row.oiMatrix` (OI snapshot) is carried on each row (`calc/index.ts:69`) but **no table column renders it** in the current 31-column layout.
- Pivot columns: none in the v2 table. Pivot formulas exist for the legacy indicator system (Section 6.9).

---

# SECTION 6 — FORMULAS

All quoted verbatim from `apps/frontend/src/calc/index.ts`. Frequency for all: once per historical row at Generate; every 500 ms for the live row. Historical dependency: closed bars from the OHLC API. Live dependency: socket LTPs.

## 6.1 MMA (v2, July-1 client spec)

```ts
export const MMA_CLOSE_SIGN = -1 as const;
export function mmaBar(bar: OHLCBar): number {
  return (bar.o + bar.h + bar.l + MMA_CLOSE_SIGN * bar.c) / 4;
}
```
Line by line: the constant fixes the sign of Close at −1 exactly as the client wrote it; the function sums Open + High + Low − Close and divides by 4. Business meaning: client-defined per-candle midpoint variant. Uses only the **current** candle. **Open confirmation #1:** with −1 the result ≈ half the price and TLA can be negative; the code comment instructs to flip to +1 if the client confirms a typo.
Example: O=70.7, H=76.75, L=70.15, C=75.2 → (70.7+76.75+70.15−75.2)/4 = 142.4/4 = **35.60**.

## 6.2 TLA (v2)

```ts
export function tlaFromMMA(barMMA: number, barHigh: number): number {
  return 2 * barMMA - barHigh;
}
```
Derived from the already-computed MMA (not re-derived from the bar). Current candle only. Example: 2×35.60 − 76.75 = **−5.55**.

## 6.3 Ranking

```ts
export function computeRanking(callMMA: number, putMMA: number) {
  if (callMMA - putMMA >= 0) return { value: callMMA, winner: "call" };
  return { value: putMMA, winner: "put" };
}
```
Business meaning: per-candle dominance of Call vs Put using their MMAs. Inputs: the two MMAs of the same candle; no weighting, no history. **Open confirmation #2:** tie → Call. Known NaN edge case: see 5.14.

## 6.4 EMA-20 (Spot)

Full function: `computeEMASeries`, `calc/index.ts:119-138`. Seed: SMA of the first 20 closes; thereafter `ema = close × k + ema × (1−k)` with k = 2/(20+1). Previous-candle dependent (recursive). Returns null for the first 19 bars. Business meaning: trend baseline of the cash index.

## 6.5 VWAP (Spot, volume-less)

```ts
cumTP += (h + l + c) / 3;
out.push(cumTP / (i + 1));
```
(`computeVWAPSeries:146-155`.) Cumulative from the session's first bar (whole-session dependency). Business meaning: average traded-level proxy; equal-weighted because volume is not available per bar in the frontend model.

## 6.6 RSI Wilder-14

(`computeRsiSeries:159-184`.) Seed averages from the first 14 changes, then Wilder smoothing; `RSI = 100 − 100/(1 + avgGain/avgLoss)`; avgLoss = 0 → 100. Depends on the previous 14+ closes. Intended input per the historical builder: Future closes. (Live-row input inconsistency documented in 5.29.)

## 6.7 FIB

(`fibLevels` + `nearestFibLabel:188-202`.) Levels at `high − (high−low)×r` for r ∈ {0.236, 0.382, 0.5, 0.618, 0.786}; label of the level nearest the price; null if high ≤ low. Session-range dependent.

## 6.8 SMC

(`smcNearest:206-223`.) Nearest of {SWH, SWL, PDH, PDL} to the reference price, as a formatted string. Note: "PDH/PDL" receive the **previous bar's** high/low in the historical builder — not previous-*day* values.

## 6.9 Pivots (legacy, not used in the v2 table)

```ts
clientPivot4Bar: pp = (o+h+l+c)/4 ;  classicPivot: pp = (h+l+c)/3
r1 = 2pp − l ; r2 = pp + (h−l) ; r3 = h + 2(pp − l)
s1 = 2pp − h ; s2 = pp − (h−l) ; s3 = l − 2(h − pp)
```
(`calc/index.ts:74-90`.) Used by the backend pivotService/indicator rooms, not by any of the 31 columns.

## 6.10 OI signal (backend, side data)

`module1OiService.ts:63-72`: STRONG_BULL when `c_buy>500 ∧ f_buy>0 ∧ p_sell<0`; MILD_BULL when `c_buy>0 ∧ p_sell<0`; mirrored for bear; DIVERGENCE when call and future OI move against each other; else NEUTRAL. Put signal = inverse mapping of the call signal. Feeds the `latest-oi` socket event; carried on rows as `oiMatrix` but not rendered as a column.

---

# SECTION 7 — DATA FLOW (stage by stage)

1. **Broker** — Zebu/Noren WebSocket `wss://go.mynt.in/NorenWS/` (`.env ZEBU_WS_URL`). Session established with the `susertoken` obtained via QuickAuth at Module-1 broker login.
2. **Market feed connect** — `startZebuMarketDataFeedWithCredentials` (`zebuMarketDataClient.ts`) opens the WS and sends the connect frame; Zebu replies `t:"ck", s:"OK"` (connection ACK, `:384-391`), after which the subscription frame with all instrument keys is sent.
3. **Token resolution** — before every connect, `refreshInstrumentTokens()` (`instrumentTokenService.ts:215-317`) downloads the NFO instrument master (`NFO_symbols.txt.zip`), parses ~77k rows, keeps NIFTY FUTIDX/OPTIDX rows, picks the nearest futures contract and the nearest option expiry, and selects CE/PE tokens within ±1000 points of ATM (±5000 if the ATM seed was a stale fallback). ATM seed priority: Redis `ltp:NIFTY-SPOT` → `ltp:NIFTY-FUT` → hard-coded default (`:281-307`).
4. **Subscription** — the resolved tokens (typically NSE|26000 + 1 futures + ~40 CE + ~40 PE) are subscribed in one frame at ACK time (`[Feed:SUB] Subscription sent — N instruments`). Additional exact user strikes are subscribed on demand: frontend `subscribe:options` → `resolveOptionInstrument()` (exact match on instrument+expiry+strike+type against the cached master, `:337-357`) → `subscribeOptionTokens()` (`dataFeed.ts:28-38`) → incremental subscribe frame. Per-token ACK = the `t:"tk"` initial snapshot (rejects are logged and skipped, `zebuMarketDataClient.ts:416-429`).
5. **Tick** — `t:"tf"` touchline **delta** messages (only changed fields present); the client fills price gaps from the last known LTP per token (`:128-152`) and emits a normalized `Tick {symbol, ltp, oi?, volume?, timestamp}` to `processIncomingTick` (`dataFeed.ts:215-290`).
6. **OHLC aggregator** — every futures/spot/option tick is folded into all 12 timeframe candles (`dataFeed.ts:266-279`; option-symbol detection at `:254`). A boundary crossing finalizes the candle (`ohlcAggregator.ts:115-153`); a proactive timer also finalizes on boundary without waiting for the next tick.
7. **Mongo** — finalized candles go to an in-memory cache (immediately readable, max 400/symbol/TF) and a persist queue drained by a single worker into `FuturesOHLC` via bulk upsert keyed `{symbol, timeframe, bar_time}` (`ohlcAggregator.ts:185-255`). Previous-session bars are pruned once per session; a TTL index deletes anything older than 25 h.
8. **Redis** — the tick path buffers `ltp:<symbol>` (SET) and `oi:<symbol>` (SETEX 25 h) writes; a coalescing buffer flushes the latest value per key in one pipelined request every 500 ms (`redisWriteBuffer.ts`), with an in-process mirror for hot readers.
9. **Socket** — `setOnTickReceived` (`socketService.ts:170-229`) broadcasts each tick to room `market:<symbol>`; emits `market_ready` once on the first valid NIFTY-FUT tick; broadcasts `latest-oi` at most every 250 ms; evaluates legacy indicator rooms at most every 500 ms.
10. **Frontend store** — `useSocket` (`hooks/useSocket.ts`) writes every `tick` into `useStore.prices[symbol] = {ltp, lastUpdated}`; other events update OI metrics, feed status, and `marketDataReady`.
11. **Calculation** — `Dashboard` Effect 1 builds historical rows from fetched bars; Effect 2 (500 ms) folds live LTPs into the newest bar and recomputes MMA/TLA/Ranking/EMA/VWAP/RSI/SMC/FIB for it (`modules/dashboard/index.tsx`).
12. **UI** — `Worksheet` renders `rows` (newest first) with the formatting/colour rules of Section 5.

**Live verification (2026-07-06):** an independent client re-aggregated one full 1-minute candle from the raw socket ticks and compared it to the Mongo bar: Spot and Put matched exactly on all four fields; Future/Call differed ≤ 0.30 only on boundary ticks.

---

# SECTION 8 — GENERATE WORKFLOW

Trigger: Generate click or auto-generate (Section 2.9) → `generateKey` bump → **Effect 1** (`index.tsx:248-478`) runs:

1. Reset: clear rows, reset RSI/EMA/VWAP/session refs, `feedStatus="connecting"`, loading skeleton on.
2. **Market status check** (skipped for Custom): `GET /api/market/status`. `CLOSED` → "Market Closed" panel, stop. `zebuConnected=false` → "auth-error" or "api-error" panel, stop (`:280-296`).
3. **Symbol construction** (`:299-319`): `futSym = {INSTRUMENT}-FUT`; `expiryFmt = formatExpiryForBroker(expiryDate)` (e.g. `07JUL26`); `ceSymbol = {instrument}{expiryFmt}C{callStrike}` when Type includes Call; `peSymbol` likewise for Put.
4. **Four parallel API calls** (`:322-330`): futures OHLC (required), CE OHLC, PE OHLC, NIFTY-SPOT OHLC (each best-effort; errors → null). Custom mode calls `ohlc-history` for futures only.
5. **Normalization** (`:334-352`): tolerant bar parser (`normalizeBar`) accepts `t/openTime/timestamp` and `o/open` field variants; builds `ceMap/peMap/spotMap` keyed by openTime.
6. **Session filter** (`:363-369`): live mode keeps only bars from today's 09:15 IST session.
7. **Historical rows** (`:373-453`): for every *closed* futures bar (openTime < current window): look up CE/PE/Spot bars by timestamp (missing → NaN sentinel / spot→future fallback), compute all four MMAs+TLAs, Ranking, SMC, FIB; RSI series over future closes; EMA-20 and VWAP series over spot bars; `appendRow(...)`. Seeds the live-row continuation state (last EMA, cumulative TP, last-50 closes, session high/low) and sets header live prices from the last closed bar.
8. `feedStatus="live"`, loading off.

In parallel, **`useSocket`** reacts to the same state (`useSocket.ts:44-49, 253-281`): joins socket rooms `market:<CE>` / `market:<PE>` and emits **`subscribe:options`** `{instrument, expiry, callStrike, putStrike, type}`. The backend resolves each strike against the NFO master and subscribes the exact tokens on the live broker connection (Section 7 step 4). On any socket reconnect the rooms and the subscription request are re-established (`useSocket.ts:75-110`).

**Effect 2** (`index.tsx:482-659`) then runs every 500 ms while status is "live": computes the current window start (`floor(now/tfMs)×tfMs`); on window change finalizes the previous live bar into the RSI/EMA/VWAP state and appends a new row; otherwise updates the newest row in place — folding `prices[ceSymbol]`, `prices[peSymbol]`, `prices["NIFTY-FUT"]`, `prices["NIFTY-SPOT"]` into OHLC accumulators with the 8-second freshness guard for Future/Spot — and recomputes all formulas for that row. State updates flow `useDashStore.rows` → React re-render → Worksheet.

---

# SECTION 9 — BACKEND SERVICES

| Service (file in `apps/backend/src/services/`) | Purpose & responsibility | Key inputs → outputs | Important methods |
|---|---|---|---|
| `zebuMarketDataClient.ts` | Owns the Zebu/Noren WebSocket: auth frame, subscription frames, delta-tick parsing, token→symbol mapping, connection/session ACK handling, incremental subscribe | susertoken + instrument list → normalized `Tick` callbacks; connect/disconnect/session-expired callbacks | `startZebuMarketDataFeedWithCredentials`, `subscribeTokens`, `setRuntimeInstrumentTokens`, `parseInstrumentEnv`, `isZebuLiveConnected` |
| `dataFeed.ts` | Tick router & feed lifecycle: stores credentials, auto-reconnect (5 attempts, exponential backoff from 4 s), generation counter guards stale callbacks, one-time ATM band recompute from the first real tick | Ticks → Redis buffer writes, OI ingest, OHLC aggregation (12 TFs), socket callback | `startDataFeedWithCredentials`, `stopDataFeed`, `processIncomingTick`, `subscribeOptionTokens` |
| `instrumentTokenService.ts` | NFO instrument master: download/parse/cache (4 h TTL), nearest futures + option expiry, ATM strike-band selection, exact contract resolution | NFO_symbols.txt.zip + Redis ATM seed → token lists / single token | `refreshInstrumentTokens`, `resolveOptionInstrument`, `recomputeOptionBandFromLivePrice`, `getActiveInstrumentTokens` |
| `ohlcAggregator.ts` | Candle building for all timeframes; finalization; in-memory finalized cache; queued bulk persistence; session pruning; pivot-recalc callback | Ticks → active candles, finalized candles (cache + Mongo) | `aggregateOHLC`, `getBoundaryTime`, `getCachedOHLCBars`, `getActiveCandle`, `setOnCandleFinalized` |
| `socketService.ts` | Socket.io server: JWT handshake auth, room management, on-demand option subscribe handler, tick/OI/market_ready/broker_status broadcasting with throttles | socket events + tick callback → room emissions | `initSocketServer`, `broadcastBrokerStatus`, `resetMarketReady` |
| `module1OiService.ts` | Aggregates open interest per side (CE/PE/futures) into per-second metric rows and bull/bear signals | Ticks with `oi` → `Module1OiMetrics` (`latest-oi`) | `ingestModule1OiTick`, `getLatestModule1OiMetrics`, `initModule1OiService` (Redis warmup) |
| `pivotService.ts` | Legacy pivot levels (classic/camarilla/fibonacci) + Call/Put indicator states per finalized candle; feeds indicator rooms and `/api/market/pivots` | Finalized candles → `PivotLevels`, indicator payloads | `initPivotService`, `getPivotLevels`, `evaluateIndicators`, `setOnPivotsUpdated` |
| `redisWriteBuffer.ts` | Coalesced last-write-wins Redis writes; one pipelined flush per 500 ms; in-process mirror for reads; retry on failure | `bufferSet`/`bufferSetex` calls → pipelined SET/SETEX | `bufferSet`, `bufferSetex`, `getBufferedValue`, `startRedisWriteBuffer` |
| `monitoringService.ts` | Periodic health checks (tick counters, service status) surfaced at `/health` | — | `startMonitoringLoop`, `getMonitoringStatus`, `recordTickReceived` |
| `zebuOAuthService.ts` | Alternative OAuth token exchange for Zebu (callback route wired in `server.ts:76-77`) | — | `resolveZebuSessionToken` |
| Controller `controllers/brokerAuth.ts` | Module-1 broker login: SHA-256 credential hashing, QuickAuth POST, feed start, module JWT issue | userId/password/factor2 → `{moduleToken}` + side-effect feed start | `module1BrokerLogin` |

Not part of Module 1: `aetramMarketDataService`, `trackerService`, `module2InteractiveDataService` (Module 2), `emailService` (OTP mails).

---

# SECTION 10 — FRONTEND ARCHITECTURE

**Components** (`apps/frontend/src/modules/dashboard/`):
- `index.tsx — Dashboard`: page shell; owns Effect 1 (history) and Effect 2 (live bar); renders InfoBar → ConfigRow → TimeframeRow → StatusPanel | Worksheet. Also defines `InfoBar` (title + PP toggle) and `StatusPanel` (full-screen status/error panels with Retry).
- `ConfigRow.tsx`: header (Section 2). Uses TanStack Query for the five dependent dropdown datasets with `staleTime: Infinity`; contains the auto-generate effect and selection-validity guards.
- `TimeframeRow.tsx`: timeframe pills, custom-range panel, live status dot, Columns popover with drag-reorder.
- `Worksheet.tsx`: pure-render 31-column table (Sections 4–5); column resize, range selection, TSV copy, dev frozen-column detector.

**Hooks**: `hooks/useSocket.ts` — the only socket owner: connect on JWT, permanent SPOT/FUT rooms, option-room join/leave diffing, `subscribe:options` emission, reconnect re-subscription, event → store dispatch. `useLivePrice` (in ConfigRow) — per-symbol LTP + direction.

**Stores** (zustand):
- `store/useStore.ts` (global): auth (user, accessToken), module tokens/status, `prices` (symbol → {ltp, lastUpdated}), `oiMetrics`, `marketDataReady`, watchlist, Module-2 state.
- `modules/dashboard/store.ts` (`useDashStore`): the entire dashboard selection (exchange…strikes, type, expiry), `isGenerated`/`generateKey`, timeframe/customRange, `rows`, `feedStatus`, header LTPs, column prefs (localStorage-persisted per user).

**Props**: Worksheet receives `{rows, hiddenCols, colOrder, feedStatus, isLoading, type}` — everything else flows through the stores.

**Effects / update cycle**: store change → Effect 1 refetch (dependencies `[isGenerated, instrument, contractMonth, timeframe, customRange, retryKey, generateKey, expiryDate, callStrike, putStrike, type]`) → rows replaced; socket tick → `prices` update; Effect 2's next 500 ms tick reads `prices` imperatively via `getState()` and calls `appendRow`/`updateLatestRow` → table re-renders. `appendRow` dedupes identical window timestamps (`store.ts:129-135`).

**Calculation module**: `src/calc/index.ts` — pure functions, no React (Section 6).

---

# SECTION 11 — APIs

All routes JWT-protected via the `authenticate` middleware (Bearer token; Redis blacklist check; `middleware/auth.ts`) unless noted. Global rate limit 200 req/15 min/IP (`server.ts:66-74`); auth routes additionally rate-limited (`authRateLimiter`).

| Method & route | Request | Response | Purpose / validation / errors |
|---|---|---|---|
| POST `/api/auth/register`, `/login`, `/verify-otp` | email/password (+ OTP) | `{user, accessToken, refreshToken}` | App authentication. 400 validation, 401 bad credentials. |
| POST `/api/auth/refresh` | refresh token | new access token | Token rotation. |
| POST `/api/auth/logout` (auth) | — | — | Blacklists the JWT in Redis. |
| GET `/api/auth/me` (auth) | — | user session | Session restore. |
| POST `/api/auth/module1-broker-login` | `{userId, password, factor2}` | `{moduleToken, moduleId:"module1", userId}` | Zebu QuickAuth; on success starts the data feed. 400 missing fields, 502 gateway error, 401 broker-rejected. |
| GET `/api/market/status` | — | `{status:"LIVE"\|"CLOSED", zebuConnected:bool}` | Time gate Mon–Fri 09:00–15:45 IST + broker flag. Consumed at Generate. |
| GET `/api/market/ohlc/:symbol/:tf?limit=` | path params | `[{symbol,timeframe,open,high,low,close,openTime,volume}]` | Session-scoped candles: Mongo → memory cache → + active candle (Section 3.1). Never errors to the client on Mongo failure; may return `[]`. |
| GET `/api/market/ohlc-history/:symbol/:tf?date=` or `?from=&to=` | ISO datetimes | same bar array | Custom range. 400 invalid/missing range params. |
| GET `/api/market/option-chain/:index` | — | `{index, spotPrice, atmStrike, strikes:[{strikePrice, CE, PE}]}` | ATM±5 synthetic strikes from the Redis spot (fallback constant 22100 if the key is empty). 500 if the Redis call throws. Feeds the strike dropdowns. |
| GET `/api/market/spot/:symbol` | — | `{symbol, ltp, timestamp}` | Redis LTP read; 404 if absent. |
| GET `/api/market/futures/:symbol?timeframe=` | — | `{symbol, ltp, activeCandle}` | LTP + forming candle. |
| GET `/api/market/pivots/:symbol/:tf` | — | classic/camarilla/fibonacci levels | Legacy pivots. |
| GET `/api/module1/indicators/:symbol?timeframe=&method=` | — | indicator state | Legacy Call/Put indicator engine; 404 if not computable. |
| GET `/api/module1/latest-oi` (no auth) | — | `Module1OiMetrics` | OI matrix snapshot. |
| POST `/api/market/custom-timeframe` | `{timeframe:"10m"}` | confirmation | Stores a custom TF in Redis; clears its old bars. 400 invalid format. |
| GET/PUT `/api/watchlist` | symbols/prefs | watchlist | Watchlist persistence (Mongo with in-memory fallback). |
| GET `/api/module/status` | — | `{module1, module2}` | Broker connection states. |
| GET `/health` (no auth) | — | services + monitoring status | Ops health check. |
| GET `/api/module1/config` (no auth) | — | static defaults | Legacy config endpoint. |

---

# SECTION 12 — SOCKET EVENTS

Connection: Socket.io at the backend origin; handshake `auth.token` = app JWT, verified server-side (`socketService.ts:37-51`); invalid → connection refused. Client options: 10 reconnection attempts, 3 s delay (`useSocket.ts:63-67`).

**Client → server**

| Event | Payload | Effect |
|---|---|---|
| `join:symbol` | `"NIFTY-FUT"` etc. | Joins room `market:<symbol>` to receive that symbol's ticks. Emitted permanently for SPOT/FUT on every connect; for CE/PE while generated. |
| `leave:symbol` | symbol | Leaves the room. Emitted when the option selection changes/clears. |
| `subscribe:options` | `{instrument, expiry:"07JUL26", callStrike, putStrike, type}` | Backend resolves each requested contract in the NFO master and subscribes its token on the live broker feed. Missing instrument/expiry → warning, ignored. Unresolvable contract → `resolve FAILED` log, that leg skipped. Re-sent automatically on every reconnect. There is **no** `generate` socket event — Generate is REST plus these room/subscribe events. |
| `join:indicators` / `leave:indicators` | `{symbol, timeframe, method}` | Legacy indicator room (pushes initial state on join). |
| `join:tracker` / `leave:tracker` | sessionId | Module 2 only. |

**Server → client**

| Event | Payload | Consumer behaviour |
|---|---|---|
| `tick` | `{symbol, ltp, ...}` | `useStore.updatePrice(symbol, ltp)` → header prices, live row inputs. Emitted per broker tick to the symbol's room only (verified: no leakage to non-joined rooms). |
| `market_ready` | `{ltp, symbol:"NIFTY-FUT", timestamp}` | Sets `marketDataReady=true` → enables auto-Generate. Emitted once per broker session on the first valid FUT tick; replayed to late-connecting clients; reset on a new broker session. |
| `latest-oi` | `Module1OiMetrics` | OI matrix cache; throttled ≥ 250 ms; also sent once on connect. |
| `broker_status` | `{status: live\|reconnecting\|broker-disconnected\|session-expired, moduleId, detail}` | Drives `feedStatus`/status panels; module-scoped so Module-2 events cannot affect Module 1. Initial state pushed on connect. |
| `indicators`, `pivots` | legacy payloads | Indicator rooms only. |
| `tracker_update` | Module 2 payload | Module 2 only. |

**Reconnect flow** (`useSocket.ts:75-110`): on `connect` → rejoin SPOT/FUT + selected symbol + tracker + indicator rooms, and re-emit `subscribe:options` if generated — because a backend restart loses runtime broker subscriptions. `disconnect` with a transport error while live → `feedStatus="no-network"`.

---

# SECTION 13 — DATABASE

## MongoDB (Atlas; `MONGODB_URI`)

| Collection | Contents | Indexes | Retention |
|---|---|---|---|
| `futuresohlcs` (`FuturesOHLC`) | One doc per finalized candle: `symbol, timeframe, bar_open/high/low/close, bar_time (Date), volume` (`schemas/FuturesOHLCSchema.ts`) | single-field on `symbol`, `timeframe`, `bar_time`; compound `{symbol:1, timeframe:1, bar_time:-1}`; **TTL** `{bar_time:1}` expireAfterSeconds = 90000 (25 h). **No unique index** — duplicate `bar_time` docs are possible; the read path de-duplicates, but a boundary-race double-finalize was observed live producing two docs with slightly different values (known issue). | TTL 25 h + explicit previous-session `deleteMany` once per symbol/TF/session (`ohlcAggregator.ts:220-233`) |
| `watchlists` | Per-user symbols + column prefs | `user_id` | permanent |
| `pivotlevels` | Legacy pivot documents | see `models/PivotLevels.ts` | Unable to determine retention from the current implementation (not inspected in this audit). |
| `users` | App accounts (hashed passwords, OTP state) | email | permanent |
| Module-2 collections | `module2sessions`, strike ticks | — | Module 2 scope |

## Redis (Upstash REST; in-memory mock fallback when unreachable)

| Key | Value | TTL | Writer / reader |
|---|---|---|---|
| `ltp:<symbol>` | last trade price string | none | tick path (buffered) / ATM seeding, spot & option-chain endpoints, monitoring |
| `oi:<symbol>` | open interest | 90000 s | tick path / OI warmup |
| `oi:trading_date` | `YYYY-MM-DD` | none | OI warmup guard |
| `config:custom_timeframe` | e.g. `"10m"` | none | custom-TF endpoint / aggregator |
| `blacklist:<jwt>` | logout marker | token lifetime | logout / auth middleware |

**Caching layers:** Redis write-buffer mirror (in-process, Section 9); finalized-candle cache (400 bars per symbol/TF); NFO master cache (4 h); TanStack Query caches dropdown data (`staleTime: Infinity`); localStorage column/pivot prefs.

---

# SECTION 14 — LIVE UPDATE SYSTEM

| Aspect | Behaviour (code / measured) |
|---|---|
| Tick frequency | Broker-driven, per instrument. Measured 2026-07-06: NIFTY-SPOT ≈ 480 ticks/min, options ≈ 165–170 ticks/min each, FUT ≈ 55 ticks/min; backend total > 120k ticks by 10:30 IST. |
| Aggregation | Every tick updates 12 timeframe candles synchronously in memory (`dataFeed.ts:266-279`). |
| Candle close | On the first tick whose boundary exceeds the active candle's openTime, plus a proactive boundary timer; finalized candle → memory cache (instant) + queued Mongo bulk write (Section 13). |
| WebSocket updates | `tick` per broker tick to room subscribers (no throttle); `latest-oi` ≤ 1/250 ms; legacy indicators ≤ 1/500 ms/room. |
| Frontend polling | None for prices (push). The live row is *rebuilt* on a 500 ms interval from the latest pushed prices (`index.tsx:484`). |
| Current candle | Newest table row; updated in place (`updateLatestRow`); Open back-filled by the first option tick of the window. |
| Completed candle | On window rollover the finished live bar is folded into RSI/EMA/VWAP continuation state and a new row is appended; the authoritative closed bar also exists server-side (Mongo). |
| Staleness | Future/Spot rendered bars blank ("—") if no tick for > 8 s (`FRESH_TTL_MS`); Call/Put bars blank until their first tick. |
| Historical loading | At Generate: closed bars only (live window excluded, `index.tsx:378-380`); session-filtered; server returns up to 400 bars. History exists only from the moment the backend feed started aggregating — there is **no broker back-fill** of candles that formed before the feed connected. |

---

# SECTION 15 — DEPENDENCY MAP

```
Zebu tick (CE token) ──► Call O/H/L/C ──► Call MMA ──► Call TLA
                                        │
Zebu tick (PE token) ──► Put O/H/L/C ──► Put MMA ───► Put TLA
                                        │        │
                                        └──► RANKING (max of the two MMAs; colour = winner)

Zebu tick (FUT token) ──► Future O/H/L/C ──► Future MMA ──► Future TLA
                       │                └──► RSI-14 (historical series)
                       │                └──► session High/Low ──► SMC label
                       │                                      └─► FIB label
                       └──► market_ready ──► auto-Generate

Zebu tick (SPOT NSE|26000) ──► Spot O/H/L/C ──► Spot MMA ──► Spot TLA
                            │                └──► EMA-20
                            │                └──► TP=(H+L+C)/3 ──► VWAP
                            └──► header Spot box; ATM seed for strike band & option-chain strikes

Selection chain: Exchange ─► Instrument ─► Contract Month ─► Expiry ─► Strikes ─► (Type) ─► Generate
Generate ─► OHLC fetch ×4 ─► historical rows        Generate ─► join rooms + subscribe:options ─► live ticks ─► live row
Spot bar missing at t ─► Future bar substitutes (the only permitted cross-instrument fallback)
```

---

# SECTION 16 — ERROR HANDLING

| Scenario | Handling (verified in code; several verified live) |
|---|---|
| Missing data (any cell) | NaN sentinel → "—". No fabricated or cross-instrument values for Call/Put. |
| Market closed | `/api/market/status` CLOSED → full-screen "Market Closed" panel (hours Mon–Fri 09:00–15:45 IST). |
| Broker not logged in | `zebuConnected=false` at Generate → "Authentication Required" panel (or "API Error" if the module is already authenticated). |
| Broker disconnects mid-session | Backend auto-reconnects up to 5× (4 s → 8 s → … backoff), broadcasting `broker_status: reconnecting`; UI shows the Reconnecting panel; after max attempts → `broker-disconnected` with Retry. Stale disconnect callbacks are ignored via a generation counter (`dataFeed.ts:59-106`). |
| Broker session expired | Dedicated handler → `session-expired` broadcast → "Broker Session Expired" panel; credentials cleared; user must re-login (`dataFeed.ts:108-119`). |
| No subscription possible for requested strikes | `subscribeOptionTokens` with no live connection logs and drops the request (the frontend re-sends it on reconnect). |
| Invalid strike / expired contract | `resolveOptionInstrument` returns null → `[Feed:SUB] On-demand resolve FAILED — <symbol> not found in NFO master…` warning; that leg stays "—"; server unaffected (live-verified with strike 24444 and expiry 08JUL26). |
| No OHLC for a symbol | API returns `[]`/active-candle-only; dev console warns; columns show "—". |
| Backend HTTP error / timeout | Effect 1 catch → `api-error` (Retry button) or `no-network` for fetch/offline/timeout signatures (`index.tsx:458-467`). |
| Socket transport loss | `feedStatus="no-network"`; automatic reconnection; on reconnect, full room + subscription re-establishment. |
| Redis unavailable / quota exhausted | Server continues with an in-memory fallback (`server.ts:196-208`); the write buffer retries; the auth blacklist check soft-fails in dev. **Endpoints that read Redis directly (`option-chain`, `spot`) return 500/404 while Redis is down — observed live with the Upstash quota exhausted, which empties the strike dropdowns.** |
| Mongo unavailable | Startup: dev continues with fallbacks, production aborts fast. OHLC reads fall back to the in-memory cache; the watchlist falls back to memory; candle persistence retries and logs (throttled). |
| Duplicate rows | `appendRow` dedupes by timestamp; the Mongo read path dedupes by `bar_time`. |
| JWT invalid/expired | REST → 401; socket handshake rejected; token blacklisted on logout. |

---

# SECTION 17 — BUSINESS RULES

1. **Dependent selection cascade:** each parent change clears all children (Exchange→…→Strikes); still-valid child selections are preserved on data reload (`store.ts:107-115`, `ConfigRow.tsx:200-222`).
2. **Expiry calendar:** NIFTY weekly = Tuesdays; BANKNIFTY/FINNIFTY/MIDCPNIFTY monthly = last Tuesday; SENSEX weekly = Thursdays; BANKEX monthly = last Thursday; past dates excluded (`liveApi.ts:37-44, 84-114`).
3. **Strike universe (UI):** ATM ± 5 strikes, 50-point steps, centred on the Redis spot price (`market.ts:342-356`). **Strike universe (feed):** the backend auto-subscribes ATM ± 1000 points (± 5000 on an unreliable ATM seed) of the nearest expiry at connect, and always additionally subscribes the user's exact strikes on demand — so a user strike outside the auto band still works.
4. **ATM determination:** spot price rounded to the nearest 50 (`Math.round(spot/50)*50`).
5. **Contract months offered:** current + next 3 months.
6. **Type gating:** Call-only hides/skips all Put data and vice-versa; both strikes are required only in Call+Put mode.
7. **Session rules:** market considered LIVE Mon–Fri 09:00–15:45 IST; table bars start at the 09:15 IST session open; live mode shows only today's session; intraday-hour candles anchor to 09:15.
8. **Ranking:** the higher MMA wins; tie → Call; the winner sets the cell colour (blue Call / amber Put).
9. **Auto-Generate:** exactly once per completed selection, and only after backend-confirmed live data (`market_ready`).
10. **Data honesty:** a cell without real data for its own instrument shows "—" — the UI never substitutes another instrument's price (single documented exception: the Spot column may use the Future bar).
11. **Preferences are per user:** hidden columns, column order, pivot method — localStorage keys suffixed with the user id.
12. **Feeds start only after user broker login** — the server never auto-connects to brokers at boot (`server.ts:245-250`).

---

# SECTION 18 — CONFIGURATION

## Frontend constants

| Constant | Value | Location | Meaning |
|---|---|---|---|
| `MMA_CLOSE_SIGN` | −1 | `calc/index.ts:96` | Sign of Close in MMA (client spec; flagged for confirmation) |
| EMA period | 20 | `calc/index.ts:119` (default param) | EMA of spot closes |
| RSI period | 14 | `calc/index.ts:159` | Wilder RSI |
| FIB ratios | .236/.382/.5/.618/.786 | `calc/index.ts:188` | Retracement set |
| Live rebuild interval | 500 ms | `index.tsx:659` | Live row cadence |
| `FRESH_TTL_MS` | 8000 ms | `index.tsx:505` | Future/Spot staleness blanking |
| RSI rolling window | last 50 closes | `index.tsx:441` | Live RSI continuation buffer |
| Socket reconnection | 10 attempts / 3000 ms | `useSocket.ts:64-65` | Client side |
| Defaults | timeframe `5m`; type `Call+Put`; exchange `NFO` | `store.ts:95-101`, `liveApi.ts:19` | Initial state |
| Contract months shown | 4 | `liveApi.ts:68` | Dropdown depth |

## Backend constants

| Constant | Value | Location |
|---|---|---|
| Timeframes aggregated | 1, 2, 3, 5, 10, 15, 30, 45, 60, 120, 180, 240 min | `dataFeed.ts:266-279` |
| Session open | 03:45 UTC (09:15 IST) | `ohlcAggregator.ts:71` |
| OHLC fetch limit | 400 bars (default) | `market.ts:156` |
| Finalized cache depth | 400 candles/symbol/TF | `ohlcAggregator.ts:272` |
| Mongo candle TTL | 90000 s (25 h) | `FuturesOHLCSchema.ts:46` |
| Redis flush interval | 500 ms | `redisWriteBuffer.ts:18` |
| OI emit throttle | 250 ms; indicator eval throttle 500 ms | `socketService.ts:164-165` |
| NFO master cache | 4 h; download timeout 30 s | `instrumentTokenService.ts:12-13` |
| ATM strike radius | 1000 (reliable seed) / 5000 (fallback seed); ATM fallback constant 25500 | `instrumentTokenService.ts:203, 286` |
| Option-chain strikes | ATM ± 5 × 50 pts; spot fallback 22100 | `market.ts:340-349` |
| Reconnect policy | 5 attempts, base 4000 ms exponential | `dataFeed.ts:61-62` |
| Rate limits | 200 req/15 min global; auth limiter on auth routes | `server.ts:66-74` |
| Socket.io keepalive | ping 25 s / timeout 60 s; transports polling→websocket | `server.ts:48-50` |
| OI signal threshold | 500 | `module1OiService.ts:64` |
| Market hours check | Mon–Fri 09:00–15:45 IST | `market.ts:409-437` |

## Environment variables (`apps/backend/.env`)

`PORT` (5001) · `MONGODB_URI` · `JWT_SECRET` / `JWT_REFRESH_SECRET` · `FRONTEND_URL` (CORS) · `ZEBU_WS_URL` · `ZEBU_REST_BASE_URL` · `ZEBU_LOGIN_URL` (QuickAuth) · `ZEBU_USER_ID`/`ZEBU_CLIENT_ID`/`ZEBU_ACCOUNT_ID`/`ZEBU_VENDOR_CODE` · `ZEBU_PASSWORD` · `ZEBU_FACTOR2` · `ZEBU_IMEI` · `MOD1_API_KEY`/`MOD1_API_SECRET` · `ZEBU_SUSERTOKEN` (optional direct token) · OAuth variants (`ZEBU_OAUTH_*`, `ZEBU_REDIRECT_URL`) · instrument fallbacks `ZEBU_NIFTY_SPOT_TOKEN` (default `NSE|26000:NIFTY-SPOT`), `ZEBU_NIFTY_FUT_TOKEN`, `ZEBU_NIFTY_CE_TOKENS`, `ZEBU_NIFTY_PE_TOKENS` (all overridden at login by the live NFO refresh) · Redis/Upstash connection vars (see `config/redis.ts`). Frontend: `VITE_API_URL`, `VITE_SOCKET_URL`.

**Feature flags:** none remain — the former `EXPIRY_INTEGRATION_ENABLED` gate was removed on 2026-07-06; the option data path is always active.

---

# SECTION 19 — COMPLETE FILE MAP (Module 1)

## Frontend (`apps/frontend/src/`)

| File | Purpose / key functions |
|---|---|
| `modules/dashboard/index.tsx` | Dashboard page; `InfoBar`, `StatusPanel`; Effect 1 history builder, Effect 2 live-bar builder; `normalizeBar`, `MISSING_BAR`, `tfToMs` |
| `modules/dashboard/ConfigRow.tsx` | Header selection UI; `useLivePrice`, `DepSelect`, auto-generate |
| `modules/dashboard/TimeframeRow.tsx` | Timeframe pills, custom range, status dot, Columns popover |
| `modules/dashboard/Worksheet.tsx` | 31-column table; `ALL_COLS`, `getCellValue`, `getCellStyle`, `ohlcColor`, `p0`, copy/resize/frozen-detector |
| `modules/dashboard/store.ts` | `useDashStore` — selection, rows, feed status, prefs persistence |
| `calc/index.ts` | All formulas: `mmaBar`, `tlaFromMMA`, `computeRanking`, `computeEMASeries`, `computeVWAPSeries`, `computeRsiSeries`, `fibLevels`, `nearestFibLabel`, `smcNearest`, legacy pivots/rating; `DashboardRow` model |
| `hooks/useSocket.ts` | Socket lifecycle, rooms, `subscribe:options`, event dispatch |
| `store/useStore.ts` | Global store: auth, prices, OI, marketDataReady, module status |
| `data/liveApi.ts` | Selection catalogs (exchanges/instruments/months/expiries) + `fetchStrikes` |
| `data/models.ts` | Selection models; `formatExpiryDisplay`, `formatExpiryForBroker` |
| `utils/api.ts` | Fetch wrapper attaching the JWT |
| `components/Auth.tsx` | App login/register + module broker-login UI |
| `App.tsx` | Routing/shell; mounts `useSocket` |
| `__tests__/frozenColGuard.test.ts` | 14 tests proving no futures→option value leakage |
| `modules/docs/content.ts`, `index.tsx` | In-app documentation pages. **Note:** still describes pre-July-1 formulas (`MMA = 2×PP − High`) — outdated vs the implemented v2 spec. |

## Backend (`apps/backend/src/`)

| File | Purpose |
|---|---|
| `server.ts` | Express + Socket.io bootstrap, middleware, startup order, graceful shutdown |
| `services/zebuMarketDataClient.ts` | Broker WS client (Section 9) |
| `services/dataFeed.ts` | Feed lifecycle + tick router |
| `services/instrumentTokenService.ts` | NFO master, token/contract resolution |
| `services/ohlcAggregator.ts` | Candles, finalization, cache, persistence |
| `services/socketService.ts` | Socket server, rooms, broadcasts, `subscribe:options` handler |
| `services/module1OiService.ts` | OI metrics + signals |
| `services/pivotService.ts` | Legacy pivots/indicators |
| `services/redisWriteBuffer.ts` | Coalesced Redis writes |
| `services/monitoringService.ts` | Health/monitoring loop |
| `services/zebuOAuthService.ts` | Zebu OAuth alternative |
| `controllers/brokerAuth.ts` | `module1BrokerLogin` (QuickAuth) |
| `controllers/market.ts` | All market REST endpoints |
| `controllers/auth.ts` | App auth endpoints |
| `routes/auth.ts`, `routes/market.ts` | Route tables |
| `middleware/auth.ts` | JWT + blacklist middleware |
| `utils/token.ts` | JWT sign/verify |
| `utils/startupCheck.ts` | Env validation at boot |
| `models/FuturesOHLC.ts` + `schemas/FuturesOHLCSchema.ts` | Candle collection + indexes |
| `models/Watchlist.ts`, `models/User.ts`, `models/PivotLevels.ts` | Supporting collections |
| `config/db.ts`, `config/redis.ts` | Connections (Redis has an in-memory mock fallback) |

Shared: `packages/shared` (`@stock/shared`) — `Tick`, `Candle`, validation schemas. (Module-2-only files omitted; listed in the Section 9 note.)

---

# SECTION 20 — FINAL SUMMARY

1. **Module overview** — a live NIFTY derivatives worksheet: the user picks a CE and PE contract; the module streams and tabulates their candles beside Future and Spot with client-defined MMA/TLA/Ranking and five indicators, per any of 12 timeframes or a custom range.
2. **UI overview** — one screen: title bar (PP toggle) → config header (live prices + 6-step selection + Generate/Reset) → timeframe row (12 TFs + Custom, live status, column manager) → 31-column, 7-group Excel-style live table with conditional colouring.
3. **Backend overview** — Node/Express/Socket.io: Zebu WS feed started at user broker-login; per-tick aggregation into 12 timeframes; Mongo for finalized candles (25 h TTL), Redis for the LTP/OI cache; JWT-authenticated REST + per-symbol socket rooms; on-demand exact-contract subscription resolved against the daily NFO instrument master.
4. **Formula summary** — MMA = (O+H+L−C)/4; TLA = 2·MMA−H; Ranking = max(CallMMA, PutMMA) (tie→Call); EMA-20 on Spot closes (SMA-seeded); VWAP = cumulative mean of (H+L+C)/3 on Spot; RSI = Wilder-14 on Future closes; FIB = nearest of 5 retracement levels of the session range; SMC = nearest of SWH/SWL/PDH/PDL.
5. **Column summary** — 31 columns: datetime; OHLC+MMA+TLA per Call/Put/Future/Spot; Ranking; 5 indicators. All floored integers, "—" for missing, user-hideable/reorderable, Type-gated.
6. **Data-flow summary** — broker tick → parse → 12-TF aggregation → Mongo/memory + Redis → socket rooms → frontend price cache → 500 ms row builder → table. Verified end-to-end against live market data on 2026-07-06.
7. **API summary** — auth (app + broker), market status, session OHLC, historical OHLC, option-chain (strike list), pivots/indicators/OI, watchlist, health — all JWT-guarded and rate-limited.
8. **Socket summary** — client: `join/leave:symbol`, `subscribe:options`, indicator/tracker rooms; server: `tick`, `market_ready`, `latest-oi`, `broker_status`, `indicators`, `pivots`; full re-subscription on reconnect.
9. **Database summary** — Mongo `FuturesOHLC` (compound + TTL indexes, no uniqueness), watchlists, users, legacy pivots; Redis `ltp:/oi:` keys with coalesced 500 ms writes; layered in-memory fallbacks for both.
10. **Known limitations** (all code-verified; several live-verified on 2026-07-06):
    - **Live-row indicator defects (activated when option data began flowing):** (a) live RSI appends Call closes to a Future-close series, pinning live RSI near 0; (b) the live session-low reference absorbs Call lows, corrupting live FIB and degrading live SMC; (c) `computeRanking(real, NaN)` renders "—" though Call data exists. Historical rows are unaffected.
    - **Open client confirmations:** MMA close-sign (−1 vs +1), Ranking tie rule, floor-vs-round display.
    - **Boundary double-finalization:** duplicate Mongo candle docs (no unique index) can make a just-closed bar's H/C/volume differ slightly between reloads.
    - **Upstash Redis quota:** when exhausted, option-chain/spot endpoints fail → strike dropdowns empty (observed live).
    - **No pre-connect back-fill:** candles exist only from feed start; a mid-session backend restart loses earlier bars beyond the cache/TTL limits.
    - **NIFTY-only live feed** despite a multi-instrument selection UI; the strike list is synthetic (ATM±5) rather than master-derived; expiry/month catalogs are client-side.
    - **In-app docs page shows outdated formulas**; the PP toggle currently has no effect on the table; `oiMatrix` is computed but not displayed.
    - **Process supervision:** the backend runs unsupervised in dev; crashes require a manual restart + broker re-login.
11. **Future improvements** — fix the three live-row indicator defects; add a unique `{symbol, timeframe, bar_time}` index; serve expiries/strikes from the backend NFO master; volume-weight VWAP; multi-instrument feeds; Redis quota management; process supervision; update the in-app docs to the v2 formulas; render or remove `oiMatrix`; remove or wire the PP toggle.
12. **Overall architecture** — a strictly symbol-keyed, push-based pipeline (broker → backend aggregation → socket rooms → frontend compute) with honest missing-data semantics ("—" everywhere, no fabricated values), layered fallbacks (memory over Mongo/Redis), and user-driven broker sessions. The price pipeline is production-accurate; remaining work is concentrated in three small frontend indicator fixes, client formula confirmations, and operational hardening.

---
*End of document. Generated from source-code inspection on 2026-07-06; file/line references refer to the repository state on that date.*
