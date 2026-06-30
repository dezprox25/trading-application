# Module 1 Conformance Audit — Trading Dashboard
**Audit date:** 2026-06-30  
**Auditor:** Claude Sonnet 4.6 (read-only pass)  
**Scope:** `apps/frontend/src/modules/dashboard/` and supporting files

---

## 1. Summary Verdict

**DOES NOT CONFORM**

| Severity | Count |
|----------|-------|
| Critical | 3 |
| Major    | 5 |
| Minor    | 6 |
| Extra    | 7 |

---

## 2. Conformance Matrix

| Section | Check | Status | Evidence (file:line) | Notes |
|---------|-------|--------|----------------------|-------|
| **A** | `/login` route exists | PASS | `App.tsx:352` | `<Route path="/login" element={accessToken ? <Navigate> : <Auth />} />` |
| **A** | `/dashboard` route exists | PASS | `App.tsx:355-369` | `/dashboard/*` with `RequireAppAuth` guard |
| **A** | Missing/expired session → `/login` | PASS | `App.tsx:17-21` | `RequireAppAuth`: if `!accessToken` → `<Navigate to="/login">` |
| **A** | Session = username + password + **OTP** | **FAIL — Critical** | `Auth.tsx:183-256` | App login form has only username + password fields. No OTP/2FA input. `Module1LoginPanel.tsx:12` has `factor2` but that is **broker** auth, not the app session. |
| **A** | Single role, no RBAC | PASS | (entire src tree) | No role-check, no admin/KYC routes found. |
| **A** | Preferences persist **per user** and rehydrate | **FAIL — Major** | `store.ts:69-72` | Column visibility: `localStorage.getItem("m1_cols")` — no user-ID in the key; all users on the same browser share the same prefs. Pivot method (`pivotMethod`): Zustand memory only — NOT persisted. Column order: not persisted (no reorder feature exists). |
| **B** | Spot Value displayed (live) | PASS | `ConfigRow.tsx:222` | `<LivePrice label="Spot" value={spotLtp}>` wired to `useLivePrice("NIFTY-SPOT")` |
| **B** | Future Value displayed (live) | PASS | `ConfigRow.tsx:223` | `<LivePrice label="Future" value={futureLtp}>` wired to `useLivePrice("NIFTY-FUT")` |
| **B** | Exchange dropdown | PASS | `ConfigRow.tsx:231-241` | Fetches from static catalog; loading state shown. |
| **B** | Instrument dropdown (cascades from Exchange) | PASS | `ConfigRow.tsx:244-254` | `disabled={!exchange \|\| loadIn}` |
| **B** | Symbol dropdown (cascades from Instrument) | PASS | `ConfigRow.tsx:257-267` | `disabled={!instrument \|\| loadSy}` |
| **B** | Type = Call / Put / Call+Put | PARTIAL | `ConfigRow.tsx:329` | Functional but button label for "Call+Put" renders as **"All"** instead of "Call + Put" as spec states. |
| **B** | Call Strike selector (enabled when Type ∋ Call) | PASS | `ConfigRow.tsx:294-306` | Conditional on `includesCall`; disabled when `!symbol` |
| **B** | Put Strike selector (enabled when Type ∋ Put) | PASS | `ConfigRow.tsx:308-321` | Conditional on `includesPut` |
| **B** | Strike dropdown (NIFTY 50-pt strikes) | PASS | `ConfigRow.tsx:281-291` | Fetches from `/api/market/option-chain/{index}` |
| **B** | Generate button disabled until chain valid | PASS | `ConfigRow.tsx:175-178` | `canGenerate = !!exchange && !!instrument && !!symbol && strike !== null && (callStrike/putStrike by type)` |
| **B** | Cascade resets downstream on upstream change | PASS | `store.ts:85-87` | `setExchange` clears instrument/symbol/strikes; `setInstrument` clears symbol/strikes; `setSymbol` clears strikes. |
| **B** | Control order matches spec | **FAIL — Major** | `ConfigRow.tsx:219-399` | Code order: Spot, Future \| Exchange, Instrument, Symbol, **Expiry Date (EXTRA)**, Strike, Call Strike, Put Strike, **Type**, Generate. Spec order: Spot, Future, Exchange, Instrument, Symbol, **Type**, Call, Put, Strike, Generate. **Type is rendered last before Generate** instead of before the strike selectors. |
| **B** | Dropdown loading/empty/error states | PARTIAL | `ConfigRow.tsx:238,251,263` | Loading ("Loading…") and empty ("Select…") present. No error state rendered if `fetchExchanges` / `fetchInstruments` throws. |
| **C** | Exactly 22 data columns | PASS | `Worksheet.tsx:39-62` | 22 entries in `ALL_COLS`. See column block below. |
| **C** | Exact column ORDER matches spec | PASS | `Worksheet.tsx:39-62` | All 22 columns in identical order. See column block below. |
| **C** | Group banner "Call (CE)" over cols 3-7 | PASS | `Worksheet.tsx:69` | `GROUP_DEFS` entry: `{ label: "Call (CE)", ids: ["ce-o","ce-h","ce-l","ce-c","call-pp"] }` |
| **C** | Group banner "Put (PE)" over cols 8-12 | PASS | `Worksheet.tsx:70` | `{ label: "Put (PE)", ids: ["pe-o","pe-h","pe-l","pe-c","put-pp"] }` |
| **C** | NO "Market", "Signal", "Analysis" banners | PASS | `Worksheet.tsx:67-81` | All other `GROUP_DEFS` entries have `label: ""`. Forbidden banners absent. |
| **C** | MMA/TLA = 4 flat standalone columns | PASS | `Worksheet.tsx:55-58` | `mma-c`, `mma-p`, `tla-c`, `tla-p` all `group: "flat"` — no merged group header. |
| **C** | Date + Time frozen on horizontal scroll | PASS | `Worksheet.tsx:40-41, 265-268, 471-473` | `frozen: true`; `position: sticky; left: frozenLeft(c.id)` in tbody cells. |
| **C** | Header frozen on vertical scroll | PASS | `Worksheet.tsx:284-286` | `<th>` style includes `position: sticky; top: 0; zIndex: 4`. |
| **D** | CE/PE OHLC = option premium (~80-320) | **FAIL — Critical** | `index.tsx:375-376, 489-490` | **Live rows:** `callO: oi.c_tl` — this is total Call OI (e.g. 26,195 contracts), NOT an option premium price. **Historical rows:** `call: { ...bar }` where `bar` is NIFTY-FUT futures OHLC (~26,000) — index-level numbers. Neither source produces option premium values. |
| **D** | CE and PE OHLC differ (independent sources) | **FAIL — Critical** | `index.tsx:375-376` | Historical rows: `callBar = { ...bar }; putBar = { ...bar }` — both cloned from the **same futures bar**. CE and PE show **identical** values in all historical rows. (Live rows do diverge: CE uses `oi.c_tl`, PE uses `oi.p_tl`.) |
| **D** | Future = index level (~23,900) | PASS | `index.tsx:498, 543` | Live: `futureLtp = prices["NIFTY-FUT"]?.ltp`. Correct index-level source. |
| **D** | Spot = index level, separate from Future | PARTIAL | `index.tsx:383, 499` | Historical: `spotLtp: bar.c` = **futures close** (spot ≠ future). Live: `spotLtp = prices["NIFTY-SPOT"]?.ltp` — correct. Spot and Future are identical for all historical rows. |
| **E** | Client PP = (O+H+L+C)/4 | PASS | `calc/index.ts:67` | `const pp = (bar.o + bar.h + bar.l + bar.c) / 4` |
| **E** | Classic PP = (H+L+C)/3 | PASS | `calc/index.ts:80` | `const pp = (bar.h + bar.l + bar.c) / 3` |
| **E** | R1 = (2·PP)−L | PASS | `calc/index.ts:71` | `r1: 2 * pp - bar.l` |
| **E** | R2 = PP+(H−L) | PASS | `calc/index.ts:72` | `r2: pp + (bar.h - bar.l)` |
| **E** | R3 = H+2·(PP−L) | PASS | `calc/index.ts:73` | `r3: bar.h + 2 * (pp - bar.l)` |
| **E** | S1 = (2·PP)−H | PASS | `calc/index.ts:74` | `s1: 2 * pp - bar.h` |
| **E** | S2 = PP−(H−L) | PASS | `calc/index.ts:75` | `s2: pp - (bar.h - bar.l)` |
| **E** | S3 = L−2·(H−PP) | PASS | `calc/index.ts:76` | `s3: bar.l - 2 * (bar.h - pp)` |
| **E** | MMA = (2·PP)−High | PASS | `calc/index.ts:94` | `export const mma = (pp, high) => 2 * pp - high` |
| **E** | TLA = (2·PP)−Low | PASS | `calc/index.ts:95` | `export const tla = (pp, low) => 2 * pp - low` |
| **E** | RSI(14) Wilder smoothing | PASS | `calc/index.ts:99-126` | Seed from SMA of first 14 changes; then Wilder: `avgGain = (avgGain*(period-1) + max(ch,0)) / period` |
| **E** | Fibonacci ratios .236 .382 .5 .618 .786 | PASS | `calc/index.ts:130-137` | `FIB_RATIOS = [0.236, 0.382, 0.5, 0.618, 0.786]`; formula `high - diff * r` |
| **E** | Rating = avg of −1/0/+1 votes | PASS | `calc/index.ts:172-179; index.tsx:23-28` | Three votes (RSI, PP, MMA/TLA); averaged in `aggregateRating` |
| **E** | Rating thresholds exact | PASS | `calc/index.ts:175-178` | `v<-0.5→"Strong Sell"`, `v<-0.1→"Sell"`, `v≤0.1→"Hold"`, `v≤0.5→"Buy"`, else `"Strong Buy"` — exact match |
| **E** | Worthy Price = stub | N/A | — | Not in any column, not in `DashboardRow`. Spec marks it "pending"; feature simply absent. |
| **F** | 12 timeframes (1m 2m 3m 5m 10m 15m 30m 45m 1h 2h 3h 4h) | PASS | `TimeframeRow.tsx:4-5` | `TFS_MIN` = 8 minute TFs + `TFS_HR` = 4 hour TFs = exactly 12. |
| **F** | Switching recomputes all columns | PASS | `index.tsx:444` | `timeframe` in Effect 1 deps triggers full rebuild: `clearRows()` + fresh fetch + row assembly. |
| **F** | Pivot toggle recomputes PP display | PASS | `Worksheet.tsx:436-438` | `pp = pivotMethod === "client" ? row.callPP : row.callPPClassic` — toggles live. |
| **F** | Pivot toggle recomputes MMA/TLA | **FAIL — Major** | `index.tsx:368, 502` | `callMMA = mma(clientPivot4Bar(bar).pp, bar.h)` — ALWAYS uses client PP. `DashboardRow` has no `callMMAClassic`/`putMMAClassic` fields. MMA/TLA display does **not** change when Classic mode is selected. |
| **F** | Column show/hide works + persists | PASS | `store.ts:126-131; TimeframeRow.tsx:235-255` | `toggleColumn` updates `hiddenCols` and saves to `localStorage("m1_cols")`. |
| **F** | Column **reorder** works + persists | **FAIL — Major** | (entire src tree) | No drag-to-reorder implementation found in any source file. `TimeframeRow.tsx` only shows a show/hide checklist, not reorder. |
| **F** | Spot & Future pills live-update | PASS | `ConfigRow.tsx:140-141` | `useLivePrice("NIFTY-SPOT")` and `useLivePrice("NIFTY-FUT")` read from socket tick cache; update on every tick. |
| **G** | White spreadsheet grid | PASS | `Worksheet.tsx:376` | `background: "#FFFFFF"` on scroll container |
| **G** | Gridlines on every cell | PASS | `Worksheet.tsx:277, 293` | `border: "1px solid #BDC4CF"` on both `thBase` and `tdBase` |
| **G** | Calibri font | PASS | `Worksheet.tsx:279, 295` | `fontFamily: "'Calibri','Segoe UI',system-ui,sans-serif"` throughout |
| **G** | Frozen panes | PASS | Covered in section C | |
| **G** | Banded rows | **FAIL — Minor** | `Worksheet.tsx:363` | Only hover highlight (`.ws-row:hover td { background: #F0F4F8 }`). No alternating even/odd row bands. |
| **G** | Call-side cells blue-tinted | PARTIAL | `Worksheet.tsx:94, 129-131` | `call-pp`, `mma-c`, `tla-c` use `C_CALL_TINT = { bg: "#EFF6FF" }` ✓. But CE OHLC cells (`ce-o/h/l/c`) use conditional color scale (green/red/blue) — not consistent blue tint. |
| **G** | Put-side cells amber-tinted | PARTIAL | `Worksheet.tsx:95, 133-135` | `put-pp`, `mma-p`, `tla-p` use `C_PUT_TINT = { bg: "#FFFBEB" }` ✓. PE OHLC cells use conditional color scale — not amber tint. |
| **G** | Conditional-format color scale (OHLC) | PASS | `Worksheet.tsx:89-114` | `ohlcColor()` maps H→green, L→red, C/O → bullish/bearish colors. |
| **G** | Rating badge colored | **FAIL — Minor** | `Worksheet.tsx:54, 137` | `rating` column has `group: "flat"`; `getCellStyle` returns `C_DEFAULT` (white bg). Value renders as plain text (e.g. "Strong Buy"), no colored badge element. |
| **G** | Numbers right-aligned | **FAIL — Minor** | `Worksheet.tsx:299` | `tdBase` uses `textAlign: "center"`. Column spec `align` field defaults to `"center"`. No column uses `"right"`. |
| **G** | Tabular number rendering | PARTIAL | `Worksheet.tsx:295` | Calibri is used (not a true tabular/monospace font). `en-IN` locale formatting applied via `toLocaleString`. |
| **H** | No order entry / Buy-Sell / broker calls | PASS | (dashboard src tree) | No order/position/P&L UI or logic found in any dashboard file. |
| **H** | No candlestick/charting library | PARTIAL | `frontend/package.json:14,19` | `lightweight-charts ^5.2.0` and `recharts ^2.12.7` are **installed** in `package.json`. However, **neither is imported** in any `.tsx`/`.ts` source file (grep confirms 0 matches). Installed but unused. Flag as EXTRA dependency risk. |
| **H** | No RBAC / admin / KYC / alerts | PASS | (entire src tree) | None found. |
| **H** | Data mock/local only (no direct external calls) | PASS | `liveApi.ts:23-25` | Exchanges/instruments/symbols are static hardcoded objects. Strikes call the own backend. Frontend does not call Zebu or any external broker API directly. |

---

## 3. Column Verification Block

| # | Spec Column | Code `id` | Code `sub` | Code `group` | Match? |
|---|-------------|-----------|------------|--------------|--------|
| 1 | Date | `date` | "Date" | date (frozen) | **MATCH** |
| 2 | Time | `time` | "Time" | date (frozen) | **MATCH** |
| 3 | CE Open | `ce-o` | "Open" | call | **MATCH** |
| 4 | CE High | `ce-h` | "High" | call | **MATCH** |
| 5 | CE Low | `ce-l` | "Low" | call | **MATCH** |
| 6 | CE Close | `ce-c` | "Close" | call | **MATCH** |
| 7 | Call PP | `call-pp` | "Call PP" | call | **MATCH** |
| 8 | PE Open | `pe-o` | "Open" | put | **MATCH** |
| 9 | PE High | `pe-h` | "High" | put | **MATCH** |
| 10 | PE Low | `pe-l` | "Low" | put | **MATCH** |
| 11 | PE Close | `pe-c` | "Close" | put | **MATCH** |
| 12 | Put PP | `put-pp` | "Put PP" | put | **MATCH** |
| 13 | Future | `future` | "Future" | flat | **MATCH** |
| 14 | Spot | `spot` | "Spot" | flat | **MATCH** |
| 15 | Rating | `rating` | "Rating" | flat | **MATCH** |
| 16 | MMA Call | `mma-c` | "MMA Call" | flat | **MATCH** |
| 17 | MMA Put | `mma-p` | "MMA Put" | flat | **MATCH** |
| 18 | TLA Call | `tla-c` | "TLA Call" | flat | **MATCH** |
| 19 | TLA Put | `tla-p` | "TLA Put" | flat | **MATCH** |
| 20 | SMC | `smc` | "SMC" | flat | **MATCH** |
| 21 | Fib | `fib` | "Fib" | flat | **MATCH** |
| 22 | RSI(14) | `rsi` | "RSI(14)" | flat | **MATCH** |

**Column count: 22 / 22. All 22 MATCH in exact order.**  
**Group banners: "Call (CE)" spans cols 3-7, "Put (PE)" spans cols 8-12. All other group cells have empty label. No forbidden banners ("Market", "Signal", "Analysis").** ✓

---

## 4. Discrepancy List

### Critical

---

**C-1 — CE/PE OHLC data source is wrong (index-level / OI, not option premium)**

- **Spec says:** CE and PE OHLC columns display option-premium price values (small numbers, e.g. ~80–320).
- **Code does:**
  - *Historical rows* (`index.tsx:375-376`): `callBar = { ...bar }; putBar = { ...bar }` where `bar` is the NIFTY-FUT futures OHLC bar. CE and PE columns display the futures price (~26,000 index points).
  - *Live rows* (`index.tsx:489-490`): `callO: oi.c_tl` where `c_tl` is the **total Call Open Interest** across all strikes (e.g. 26,195 contracts). Not an option price.
- **Severity:** Critical — the primary data meaning of the dashboard's two most important column groups is wrong.
- **Note:** The in-memory OI architecture (`c_tl` / `p_tl`) appears to be an intentional design decision (per project context). If this is the agreed design, the spec's "option-premium" wording must be updated to reflect OI values.
- **Recommended fix:** Either (a) wire CE/PE OHLC to actual option chain premium data from the backend, or (b) update the spec to state "CE/PE OHLC = aggregate Call/Put OI" and add clarifying labels to the column headers.

---

**C-2 — Historical CE and PE OHLC are identical (same object cloned from futures bar)**

- **Spec says:** CE and PE are independent OHLC series that reflect their respective option/OI movement.
- **Code does** (`index.tsx:375-376`): `const callBar: OHLCBar = { ...bar }; const putBar: OHLCBar = { ...bar }` — both are shallow clones of the SAME futures bar. CE Open = PE Open, CE High = PE High, etc., for every historical row.
- **Severity:** Critical — the Call vs Put comparison (the entire point of the two-sided table) is meaningless for historical data.
- **Recommended fix:** Fetch separate CE and PE OHLC series from the backend (option chain history endpoint) rather than cloning the futures bar into both sides.

---

**C-3 — App login has no OTP step**

- **Spec says:** "Session = username + password + OTP, single role."
- **Code does** (`Auth.tsx:183-256`): Login form has only `username` + `password` inputs. `Module1LoginPanel.tsx:12` has a `factor2` field, but that authenticates the Zebu **broker** session, not the application session.
- **Severity:** Critical — the application authentication flow is missing a required security factor.
- **Recommended fix:** Add an OTP/TOTP input field to `Auth.tsx` and validate it against the backend's `/auth/login` endpoint.

---

### Major

---

**M-1 — Pivot method toggle does not update MMA / TLA**

- **Spec says:** "Pivot method toggle (Client PP / Classic) recomputes pivots / MMA / TLA."
- **Code does** (`index.tsx:368, 502; calc/index.ts:94-95`): `callMMA = mma(clientPivot4Bar(bar).pp, bar.h)` — always computed with Client PP. `DashboardRow` has no `callMMAClassic` / `putMMAClassic` fields. The pivot toggle updates PP cells only; MMA and TLA cells are frozen at client-PP-computed values.
- **Severity:** Major — Classic mode is visually broken: PP column updates but MMA/TLA columns remain at Client values, creating an internally inconsistent table.
- **Recommended fix:** Add `callMMAClassic`, `callTLAClassic`, `putMMAClassic`, `putTLAClassic` fields to `DashboardRow`; compute them alongside the existing client variants in both Effect 1 and Effect 2; select the correct variant in `Worksheet.tsx`'s `getCellValue`.

---

**M-2 — Column reorder not implemented**

- **Spec says:** "Column show/hide + reorder works and persists."
- **Code does** (`TimeframeRow.tsx:235-255`): Column panel renders a checkbox list for show/hide only. No drag-to-reorder implementation exists in any source file. `ALL_COLS` order is fixed at definition time.
- **Severity:** Major — half of the column preference feature is absent.
- **Recommended fix:** Add a drag-and-drop reorder list in the Columns popover (e.g., using the HTML5 Drag API or a small library); persist the order array to `localStorage("m1_col_order")`.

---

**M-3 — Control order mismatch: Type positioned after Put Strike**

- **Spec says order:** Spot, Future, Exchange, Instrument, Symbol, **Type**, Call, Put, Strike, Generate.
- **Code renders** (`ConfigRow.tsx:219-399`): Spot, Future | Exchange, Instrument, Symbol, Expiry Date (EXTRA), Strike, Call Strike, Put Strike, **Type** | Generate.
- **Severity:** Major — Type selector appears to the right of the strike selectors instead of to the left. Users expecting the spec layout will find the logical grouping broken.
- **Recommended fix:** Move the Type segmented control (`ConfigRow.tsx:323-350`) to appear immediately after Symbol and before the strike fields. Also rename the "All" label to "Call + Put".

---

**M-4 — Column preferences not user-scoped; pivot method not persisted**

- **Spec says:** "User preferences persist per user and rehydrate on load."
- **Code does** (`store.ts:69-72`): `localStorage.getItem("m1_cols")` with a fixed key — no user ID. All users on the same device share column preferences. Pivot method (`pivotMethod`) is never written to localStorage.
- **Severity:** Major — multi-user environments corrupt each other's preferences; reloading resets the pivot method to "client".
- **Recommended fix:** Key localStorage entries by user ID (e.g., `m1_cols_${user.id}`); add `localStorage.setItem("m1_pivot", m)` inside the `setPivotMethod` action in `store.ts` and read it back on store init.

---

**M-5 — Historical Spot value uses futures close (Spot ≠ Futures)**

- **Spec says:** "Spot = index level (~23,900)." Spot and Future are distinct display columns.
- **Code does** (`index.tsx:382-383`): `futureLtp: bar.c, spotLtp: bar.c` — both set to the **futures close price**. Historical Spot and Future columns are identical; the Spot-Future premium/discount cannot be derived from historical rows.
- **Severity:** Major — the Spot column is meaningless for any historical row (always equals Future).
- **Recommended fix:** Fetch a separate NIFTY-SPOT OHLC history series from the backend and use its close to populate `spotLtp`; or source Spot from a separate `/api/market/ohlc/NIFTY-SPOT/{tf}` call in Effect 1.

---

### Minor

---

**m-1 — Type button label "All" vs spec "Call + Put"**
- **Spec:** "Type: `Call` / `Put` / `Call + Put`."
- **Code** (`ConfigRow.tsx:329`): `opt === "Call+Put" ? "All" : opt` — renders "All".
- **Recommended fix:** Replace `"All"` with `"Call+Put"` (or "Call + Put") in the button label.

---

**m-2 — EXTRA control: "Expiry Date" dropdown not in spec**
- **Code** (`ConfigRow.tsx:269-278`): Renders an Expiry Date picker with hardcoded future Thursdays. Not connected to any filter logic in the OHLC fetch.
- **Impact:** Cosmetic clutter; currently has no functional effect (the value is never passed to the fetch URL).
- **Recommended fix:** Either remove it (if not needed) or wire it to the OHLC fetch URL and add it to the spec.

---

**m-3 — No error state for dropdown API failures**
- **Spec:** "Each dropdown has loading / empty / error states."
- **Code** (`ConfigRow.tsx:238-239`): Only loading and placeholder ("Select…") states shown. No error banner if `fetchExchanges` / `fetchInstruments` / `fetchSymbols` rejects.
- **Recommended fix:** Add `isError` checks from the `useQuery` result and render an error label (e.g. "Failed to load").

---

**m-4 — No banded rows**
- **Spec:** "Excel-style … banded rows."
- **Code** (`Worksheet.tsx:363`): Only hover highlight. No alternating `nth-child` styling.
- **Recommended fix:** Add `background: ri % 2 === 0 ? "#FFFFFF" : "#F7FAFC"` on `<tr>` (or via CSS nth-child selector).

---

**m-5 — Rating column: plain text, no colored badge**
- **Spec:** "Rating (badge: Strong Buy / Buy / Hold / Sell / Strong Sell)."
- **Code** (`Worksheet.tsx:54, 137; getCellValue:175`): Rating cell returns plain text label in `C_DEFAULT` (white background). No badge, no color coding.
- **Recommended fix:** Render a `<span>` with background color based on `row.rating.label` (green for Strong Buy, red for Strong Sell, etc.) in the Rating `<td>` render branch.

---

**m-6 — Numbers center-aligned, spec requires right-aligned**
- **Spec:** "Numbers right-aligned, tabular."
- **Code** (`Worksheet.tsx:299`): `tdBase` uses `textAlign: "center"`. Column-level `align` field also defaults to `"center"` for most numeric columns.
- **Recommended fix:** Change `tdBase.textAlign` to `"right"` for numeric columns; keep `"center"` for Date, Time, and Rating.

---

## 5. Extra Features (present in code, not in spec)

| # | Feature | Location | Note |
|---|---------|----------|------|
| X-1 | "Expiry Date" dropdown | `ConfigRow.tsx:269-278` | Also listed as m-2 |
| X-2 | "Reset" button (clear generation) | `ConfigRow.tsx:357-369` | Useful UX but not in spec |
| X-3 | Config row collapse/expand toggle (▲/▼) | `ConfigRow.tsx:182-209, 387-398` | Not in spec |
| X-4 | Custom date range mode (From / To / Candle TF) | `TimeframeRow.tsx:259-343` | Full historical range picker — not in spec |
| X-5 | TSV copy selection (Ctrl/Cmd-C) | `Worksheet.tsx:215-231` | Excel-like convenience; not in spec |
| X-6 | Column width resize (drag handle) | `Worksheet.tsx:247-261` | Excel-like convenience; not in spec |
| X-7 | `lightweight-charts` + `recharts` in package.json | `frontend/package.json:14,19` | Installed but **not imported** in any source file. Dead dependencies violating Section H spirit. |

---

## 6. Cannot-Verify List

| Item | Reason |
|------|--------|
| Live CE/PE OHLC values in browser | No dev server access during audit; data-meaning defects (C-1, C-2) are confirmed from static code analysis but actual rendered numbers cannot be screenshot-verified. |
| OTP field "per spec" vs "per current client agreement" | `Module1LoginPanel.tsx` has a `factor2` field for broker auth. It is unclear whether the OTP requirement in Section A was intended for the app login, the broker login, or both. The audit treats it as the app-level login per the spec wording; this should be confirmed with the client. |
| Worthiness Price stub | Not in code at all. The spec says "pending — must be a stub." Cannot verify whether a stub was ever agreed to be required or if absent is acceptable. |
| Runtime CE/PE column data after live broker connection | The data source of live rows (`oi.c_tl` / `oi.p_tl`) was verified to be OI totals rather than premiums by reading the code path. Live verification requires an active Zebu session. |
| Column reorder drag UX (browser test) | Confirmed absent by reading all source files; no runtime verification needed. |

---

## Ready for review

The three **Critical** items (C-1, C-2, C-3) and five **Major** items (M-1 through M-5) represent the highest-priority gaps. The column structure (Section C) and all formula implementations (Section E) are fully correct and require no changes.

**Proceed with fixes for Critical / Major items?**
