# Production Readiness Audit — TradePro Analytics Suite

> **Audit Date:** 2026-06-27 | **Scope:** Full-stack (Frontend + Backend + Infrastructure)

---

## Executive Summary

The application has solid architectural bones: clean separation of concerns, proper WebSocket lifecycle management, graceful degradation patterns, and a well-structured data pipeline. However, **several critical and high-priority issues must be resolved before this application handles real trading sessions**. The most severe findings involve a plaintext credential file that is almost certainly tracked in version control, expired broker instrument tokens causing a complete data blackout in Module 1, and insecure JWT secrets that allow token forgery.

---

## Production Readiness Scores

| Category | Score | Notes |
|---|---|---|
| Architecture | 72/100 | Good separation of concerns, some duplication |
| UI/UX | 65/100 | Professional look, several dead-code areas, no mobile |
| Performance | 60/100 | 12 sequential DB writes per tick, unbounded collections |
| Reliability | 55/100 | Good fallbacks, but critical data is currently broken |
| Security | 30/100 | Expired secrets, plaintext credential file |
| Code Quality | 68/100 | TypeScript mostly clean, 245 console statements |
| API Integration | 70/100 | Good error handling, no request timeouts |
| Maintainability | 65/100 | Good structure, hardcoded symbols need monthly updates |
| **Overall** | **54/100** | **NOT production-ready in current state** |

---

## Findings

---

### CRITICAL — Must fix before any production deployment

---

**C-1 — `.env` File Contains Production Secrets in Plaintext**

- **Impact:** Complete credential exposure. MongoDB Atlas password, Upstash Redis token, Zebu broker API key and password, Aetram API keys, and the application login password are all readable. If this file is committed to the repository — which is the default risk when no `.gitignore` is verified — every secret is compromised.
- **Affected:** `apps/backend/.env`
- **Evidence:** MongoDB URI contains embedded password, Upstash token exposed, `ZEBU_PASSWORD=Success@555`, `APP_LOGIN_PASSWORD=TradePro2026`
- **Fix:** Rotate all credentials immediately. Verify `.env` is in `.gitignore` and not present in any commit. Move secrets to the platform's environment variable manager (Render Dashboard, not files). Audit git history with `git log --all --full-history -- '**/.env'`.
- **Effort:** 1–2 hours (rotation + verification)

---

**C-2 — JWT Secrets Are Insecure Placeholder Values**

- **Impact:** Any attacker who knows the strings `your_jwt_secret_here` (which are committed in `token.ts` as fallbacks) can forge valid access tokens and authenticate as any user without credentials.
- **Affected:** `apps/backend/.env` lines 13–14, `apps/backend/src/utils/token.ts` lines 3–4
- **Evidence:** `.env`: `JWT_SECRET=your_jwt_secret_here`. `token.ts` fallback `"supersecretjwtkeyforstockdashboardintraday2026"` is also hardcoded and included in the `INSECURE_DEFAULTS` blocklist — meaning the startup check itself knows these are compromised.
- **Fix:** Set both `JWT_SECRET` and `JWT_REFRESH_SECRET` to cryptographically random 64-character strings via `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`.
- **Effort:** 15 minutes

---

**C-3 — NIFTY Option Tokens Are Expired — Module 1 OI Data Is Completely Non-Functional**

- **Impact:** The entire OI analytics core of Module 1 is producing zero data. CE/PE open interest shows as zeros. The `.env` file explicitly documents this with comments reading "ALREADY BROKEN" and "ACTION REQUIRED (CRITICAL)". The June 23 weekly expiry tokens are still configured; those contracts no longer exist in Zebu's feed.
- **Affected:** `apps/backend/.env` — `ZEBU_NIFTY_CE_TOKENS`, `ZEBU_NIFTY_PE_TOKENS`, `ZEBU_NIFTY_FUT_TOKEN`
- **Evidence:** `.env` comment: `"ALREADY BROKEN: NIFTY23JUN26 weekly options EXPIRED 2026-06-23"`. Audit date is 2026-06-27, four days after expiry.
- **Fix:** Download the current `NFO_symbols.txt` from Zebu, identify active ATM strikes for the next valid expiry, and update all three token variables. This is a weekly operational task that must be performed every Thursday before market open.
- **Effort:** 30 minutes to fix; requires a documented weekly process going forward

---

**C-4 — NIFTY FUT Token Also Expired**

- **Impact:** Futures OHLC aggregation and LTP tracking for NIFTY-FUT are broken. The June monthly futures (`NFO|62329`) expired on June 26, 2026. All OHLC candles for Module 1 use this feed.
- **Affected:** `apps/backend/.env` — `ZEBU_NIFTY_FUT_TOKEN`
- **Evidence:** `.env` comment: `"ACTION REQUIRED (URGENT — TODAY 2026-06-24): NIFTY June monthly futures (NFO|62329) expire on 2026-06-26. Update to July 2026 contract."`
- **Fix:** Identify July 2026 NIFTY-FUT token from `NFO_symbols.txt` and update `ZEBU_NIFTY_FUT_TOKEN`. This is a monthly operational task (last Thursday of each month).
- **Effort:** 15 minutes to fix; requires a monthly rollover process

---

**C-5 — No Automated Instrument Token Rollover — Recurring Operational Risk**

- **Impact:** Every Thursday at 3:30 PM, weekly option contracts expire. Every last Thursday of the month, the front-month futures contract expires. Currently there is no automation: a human must manually find the new tokens and redeploy `.env`. If this is missed by even 15 minutes on a trading day, all live data stops and traders lose their feed mid-session.
- **Affected:** Operational process, `apps/backend/.env`
- **Fix:** Build a token discovery service that queries Zebu's symbol master file before market open to automatically identify active near-expiry contracts and update the subscription list. At minimum, add a monitoring alert that warns when the subscribed symbols have fewer than 24 hours until expiry.
- **Effort:** 2–4 days

---

### HIGH PRIORITY — Should fix before client delivery

---

**H-1 — No Request Timeout on Frontend API Calls**

- **Impact:** If the backend hangs or is slow, `fetch()` calls in `api.ts` wait indefinitely. The dashboard loading spinner will never resolve. During a trading session, a hung request could leave the trader staring at a skeleton table.
- **Affected:** `apps/frontend/src/utils/api.ts`
- **Fix:** Wrap all `fetch` calls with `AbortController` and a configurable timeout (e.g., 10 seconds). Catch `AbortError` and surface a timeout-specific UI message.
- **Effort:** 2 hours

---

**H-2 — WebSocket Reconnection Gives Up After 10 Attempts**

- **Impact:** `reconnectionAttempts: 10` with `reconnectionDelay: 3000` means the socket stops trying after 30 seconds. If the backend restarts during a 6-hour trading session, the frontend silently loses its live feed and never recovers. The trader would need to manually refresh the page.
- **Affected:** `apps/frontend/src/hooks/useSocket.ts`
- **Fix:** Set `reconnectionAttempts: Infinity`. Add a `reconnect_failed` handler that surfaces a "Connection lost — please refresh" banner so the trader knows the feed is dead.
- **Effort:** 30 minutes

---

**H-3 — `PivotLevels` Collection Grows Unboundedly**

- **Impact:** `pivotService.ts` calls `PivotLevelsModel.create(...)` every time a candle is finalized. With 12 timeframes × 3 pivot methods = 36 documents per candle close. A single trading day generates ~375 1m candles × 36 = ~13,500 pivot documents. There is no pruning, TTL index, or cap. The collection will eventually degrade query performance and storage.
- **Affected:** `apps/backend/src/services/pivotService.ts`
- **Fix:** Use `findOneAndUpdate` with upsert for pivot documents (keyed on `{ symbol, timeframe, method, date }`), or add a TTL index: `PivotLevelsSchema.index({ computed_at: 1 }, { expireAfterSeconds: 7 * 24 * 3600 })`.
- **Effort:** 1 hour

---

**H-4 — 12 Sequential Awaited DB Writes Per Tick**

- **Impact:** Every FUT tick triggers 12 sequential `aggregateOHLC` calls, each potentially triggering a `finaliseCandle` → `FuturesOHLC.findOneAndUpdate`. Under high-frequency ticks (NIFTY-FUT can receive 10–50 ticks/sec), this creates a queue of synchronous DB operations that will back up on a shared MongoDB Atlas connection. The in-memory boundary checker also fires every second across 12 TFs with an async Redis call per TF.
- **Affected:** `apps/backend/src/services/dataFeed.ts`, `apps/backend/src/services/ohlcAggregator.ts`
- **Fix:** Separate the in-memory aggregation (fast, synchronous) from the persistence (async). Run aggregation synchronously on every tick, defer persistence to a batch writer that flushes every 5 seconds. Cache `getTimeframeMinutes` results instead of calling async Redis every second.
- **Effort:** 1 day

---

**H-5 — Module 1 Live Feed Has No Re-authentication After Zebu Session Expires**

- **Impact:** Zebu session tokens have a limited validity period. Once the token expires mid-session, the WebSocket disconnects and the feed dies. The frontend shows `feedStatus = "interrupted"` but there is no re-login flow triggered. The trader must manually navigate back to the Module 1 login panel.
- **Affected:** `apps/backend/src/services/zebuMarketDataClient.ts`, `apps/frontend/src/modules/dashboard/index.tsx`
- **Fix:** In the Zebu disconnect handler, emit a socket event (e.g., `feed:auth-expired`) that the frontend intercepts to show a re-login prompt or automatically opens the Module 1 login panel.
- **Effort:** 3–4 hours

---

**H-6 — CE/PE OI Map Never Cleaned After Option Expiry**

- **Impact:** `ceOiBySymbol` and `peOiBySymbol` Maps in `module1OiService.ts` accumulate entries for every option symbol ever seen. After an expiry, the old strikes remain in the map with stale OI values and continue to distort the `c_tl` and `p_tl` totals. On the next weekly expiry cycle, the sum includes both expired and active contracts.
- **Affected:** `apps/backend/src/services/module1OiService.ts`
- **Fix:** When the Zebu data feed is restarted (new session), call a `clearOiMaps()` function to reset both Maps to empty. Also clear them when the subscribed token set changes.
- **Effort:** 1 hour

---

**H-7 — `redis.keys("oi:*")` on Startup Is an O(N) Blocking Command**

- **Impact:** `initModule1OiService` calls `redis.keys("oi:*")` which scans the entire Redis keyspace. On a shared Redis instance (Upstash) with many keys, this blocks the event loop. `KEYS` is documented as dangerous in production.
- **Affected:** `apps/backend/src/services/module1OiService.ts`
- **Fix:** Replace with `redis.scan` iterated in batches, or store a set of tracked OI symbol keys in a Redis Set and use `smembers` to retrieve them.
- **Effort:** 2 hours

---

**H-8 — Module Token Signed With Same Secret as App Token**

- **Impact:** Module JWT tokens (issued on broker login, 8h expiry) and app JWT tokens (15-minute access tokens) are both signed with `JWT_SECRET`. The auth middleware `verifyAccessToken` accepts any token signed with this key. A module token can authenticate app-level API endpoints and vice versa, erasing the boundary between the two auth layers.
- **Affected:** `apps/backend/src/controllers/brokerAuth.ts`, `apps/backend/src/middleware/auth.ts`
- **Fix:** Use a separate `MODULE_JWT_SECRET` environment variable for signing module tokens, and add a `type` check in the middleware to reject module tokens on app-level endpoints.
- **Effort:** 2 hours

---

**H-9 — `latest-oi` Broadcast to ALL Sockets on Every Tick**

- **Impact:** `ioServer.emit("latest-oi", oiMetrics)` in `socketService.ts` broadcasts to every connected client on every single tick. If 10 users are connected and NIFTY-FUT sends 20 ticks/sec, that is 200 socket messages per second just for OI metrics. This does not scale and creates unnecessary traffic for clients on Module 2 who do not need OI data.
- **Affected:** `apps/backend/src/services/socketService.ts`
- **Fix:** Create a `module1:oi` room. Clients on Module 1 join this room; use `ioServer.to("module1:oi").emit(...)` to only send to relevant subscribers.
- **Effort:** 3 hours

---

**H-10 — Module Login Endpoint Has Hardcoded Default Credentials**

- **Impact:** `auth.ts` `moduleLogin` function defaults to `validPass = "module123"` if `MOD1_ACCESS_PASSWORD` is not set. This legacy endpoint is still mounted and accessible. Any user who discovers the `/auth/module-login` endpoint can authenticate to modules with `module1user`/`module123`.
- **Affected:** `apps/backend/src/controllers/auth.ts`
- **Fix:** Remove the legacy `moduleLogin` function and its route entirely, or at minimum throw an error if the env vars are not set (no insecure defaults).
- **Effort:** 1 hour

---

### MEDIUM PRIORITY — Recommended before long-term use

---

**M-1 — `liveApi.ts` Symbol Lists Are Hardcoded With Expired Contracts**

- **Impact:** `SYMBOLS` in `liveApi.ts` contains `"NIFTY 26JUN"`, which expired June 26. Users selecting this symbol get no data. These must be updated after every expiry.
- **Affected:** `apps/frontend/src/data/liveApi.ts`
- **Fix:** Derive the symbol list dynamically from the active instrument list endpoint, or expose a backend endpoint that returns the current active expiry symbols.
- **Effort:** 1 day

---

**M-2 — Access Token Has No Refresh on Expiry During Active Session**

- **Impact:** Access tokens expire in 15 minutes. If the refresh also fails (e.g., the refresh token expired after 7 days), the user is silently logged out mid-trade with no error message.
- **Affected:** `apps/frontend/src/utils/api.ts`, `apps/frontend/src/App.tsx`
- **Fix:** When `clearAppAuth()` is called on refresh failure, navigate to `/login` immediately and show a toast: "Your session has expired. Please log in again." Currently the user sees a broken dashboard.
- **Effort:** 2 hours

---

**M-3 — `App.tsx` Has Dead Code UI (Hidden Timeframe Buttons, Market Status Indicator)**

- **Impact:** The `ModuleTopBar` has timeframe selector buttons and a market status dot both wrapped in `display: "none"`. These are wired to real state but never shown. They add bundle weight and confusion.
- **Affected:** `apps/frontend/src/App.tsx`
- **Fix:** Remove the dead JSX blocks since timeframe and status are now handled inside Module 1's `TimeframeRow` and `InfoBar`.
- **Effort:** 30 minutes

---

**M-4 — `server.ts` Has Two Duplicate `/module1/config` Endpoints With Stale Data**

- **Impact:** Both `/module1/config` and `/api/module1/config` return `timeframes: ["1m", "3m", "5m"]` — the old list that predates the 12-timeframe support. No code consumes these endpoints currently, but they will mislead any future integrations.
- **Affected:** `apps/backend/src/server.ts`
- **Fix:** Remove the duplicate endpoint (keep only `/api/module1/config`) and update the timeframes list to all 12 values.
- **Effort:** 15 minutes

---

**M-5 — 245 Console Statements Will Flood Production Logs**

- **Impact:** The backend has 245 `console.log/warn/error` calls across 23 files. `brokerAuth.ts` alone logs 39 statements including full request/response bodies on every login attempt. In production, this fills log quota rapidly and makes real errors hard to find. It also risks logging partial sensitive data from Zebu response bodies.
- **Affected:** All backend service files, particularly `brokerAuth.ts`, `module1OiService.ts`, `socketService.ts`
- **Fix:** Implement a structured logger (e.g., `pino`) with log levels. Set `LOG_LEVEL=warn` in production. Downgrade routine diagnostic statements to `debug` level.
- **Effort:** 1 day

---

**M-6 — No API Rate Limiting Per User (Only Global)**

- **Impact:** The global rate limiter (200 req/15 min) applies to all users combined. A single misbehaving client can consume the full quota and rate-limit all other users.
- **Affected:** `apps/backend/src/server.ts`
- **Fix:** Add per-user rate limiting on authenticated endpoints using `req.user.id` as the key.
- **Effort:** 2 hours

---

**M-7 — No Reconnection Feedback to the User on Extended Feed Outage**

- **Impact:** When the WebSocket disconnects, `feedStatus` becomes `"interrupted"` showing an amber dot. If the socket exhausts its reconnection attempts, the status never updates to reflect that the feed is permanently dead. The user assumes it will recover on its own.
- **Affected:** `apps/frontend/src/hooks/useSocket.ts`
- **Fix:** On `reconnect_failed`, dispatch a store update setting `feedStatus = "no-network"` and show the full StatusPanel with a "Refresh Page" button.
- **Effort:** 2 hours

---

**M-8 — `Worksheet.tsx` Has an Unused State Variable (TypeScript Error)**

- **Impact:** `hoveredRow` is declared but never used — a TypeScript error that indicates a code quality gap.
- **Affected:** `apps/frontend/src/modules/dashboard/Worksheet.tsx`
- **Fix:** Remove the unused `hoveredRow` state and its setter.
- **Effort:** 5 minutes

---

**M-9 — Google Fonts Loaded from CDN in Production**

- **Impact:** `App.tsx` injects `@import url('https://fonts.googleapis.com/...')` via a `<style>` tag in the JSX render. This adds an external network dependency to every page load, affects Core Web Vitals (FOUC risk), and is a GDPR concern in some jurisdictions (Google records user IPs).
- **Affected:** `apps/frontend/src/App.tsx`
- **Fix:** Bundle the Inter font locally using the `@fontsource/inter` package, or self-host via Vite's font handling.
- **Effort:** 1 hour

---

**M-10 — `pivotService.ts` Contains Unreachable Code**

- **Impact:** `getPivotLevels` has a `return null` statement after a block that always returns. This is dead code left from a refactor.
- **Affected:** `apps/backend/src/services/pivotService.ts` line 184
- **Fix:** Remove the unreachable `return null`.
- **Effort:** 5 minutes

---

### LOW PRIORITY — Polish and future improvements

---

**L-1 — No Automated Tests of Any Kind**

- **Impact:** For a trading application handling financial data, zero test coverage means every refactor is a gamble. Calculation bugs in pivot formulas, RSI, OI aggregation, and signal generation go undetected until a trader notices wrong values mid-session.
- **Fix:** Add unit tests for the pure calculation engine (`calc/index.ts`), the OI service (`module1OiService.ts`), and the OHLC aggregator boundary logic. Jest or Vitest are natural fits for this monorepo.
- **Effort:** 3–5 days

---

**L-2 — No Mobile / Responsive Layout**

- **Impact:** The Worksheet table is a fixed-width multi-column grid. On screens narrower than ~1400px, it requires horizontal scrolling. On mobile, the dashboard is unusable.
- **Fix:** Add a minimum viewport width media query and appropriate warnings. A dedicated mobile view is a long-term enhancement.
- **Effort:** 2–5 days for a proper mobile view

---

**L-3 — No Deployment Documentation or Runbook**

- **Impact:** The weekly option token rotation (C-3, C-4) requires someone to know what to do. There is no documentation of this process. When the person who configured the system is unavailable, the feed breaks and nobody knows how to fix it.
- **Fix:** Write a `RUNBOOK.md` covering: weekly token rotation, monthly futures rollover, environment variable reference, service restart procedures, and emergency contact escalation.
- **Effort:** 1 day

---

**L-4 — `window.prompt()` Used in `App.tsx` for Custom Timeframe**

- **Impact:** The legacy custom timeframe entry uses a native browser alert dialog. This is jarring UX for professional traders and is blocked in some browser security contexts. The code is currently hidden but could be re-enabled accidentally.
- **Affected:** `apps/frontend/src/App.tsx`
- **Fix:** Remove this code path since custom timeframe is now handled properly in `TimeframeRow.tsx`.
- **Effort:** 15 minutes

---

**L-5 — `mongoose` Loaded via `require()` Inside Functions in `server.ts`**

- **Impact:** Mixing `import` (ESM) and `require()` (CJS) in the same file is an inconsistency that can cause issues in stricter ESM environments or future upgrades.
- **Affected:** `apps/backend/src/server.ts`
- **Fix:** Import mongoose at the top of the file: `import mongoose from "mongoose"`.
- **Effort:** 10 minutes

---

## Summary Priority Table

| ID | Severity | Description | Effort |
|---|---|---|---|
| C-1 | Critical | `.env` with live secrets likely in git | 1–2h |
| C-2 | Critical | Insecure JWT secrets — tokens can be forged | 15 min |
| C-3 | Critical | All CE/PE option tokens expired — zero OI data | 30 min |
| C-4 | Critical | NIFTY-FUT token expired — no OHLC feed | 15 min |
| C-5 | Critical | No automated token rollover process | 2–4d |
| H-1 | High | No API request timeouts on frontend | 2h |
| H-2 | High | Socket stops reconnecting after 30 seconds | 30 min |
| H-3 | High | PivotLevels collection grows unboundedly | 1h |
| H-4 | High | 12 sequential DB writes per tick | 1d |
| H-5 | High | No Zebu session re-auth after expiry | 3–4h |
| H-6 | High | Stale OI from expired option strikes | 1h |
| H-7 | High | `redis.keys()` blocks event loop on startup | 2h |
| H-8 | High | Module tokens share secret with app tokens | 2h |
| H-9 | High | OI broadcast floods all clients on every tick | 3h |
| H-10 | High | Legacy module login with hardcoded defaults | 1h |
| M-1 | Medium | Hardcoded expired symbol lists in frontend | 1d |
| M-2 | Medium | Silent logout on refresh token expiry | 2h |
| M-3 | Medium | Dead UI code in App.tsx (hidden TF buttons) | 30 min |
| M-4 | Medium | Duplicate stale config endpoints in server.ts | 15 min |
| M-5 | Medium | 245 console statements in production logs | 1d |
| M-6 | Medium | No per-user rate limiting | 2h |
| M-7 | Medium | No user feedback when reconnect permanently fails | 2h |
| M-8 | Medium | Unused TypeScript variable in Worksheet.tsx | 5 min |
| M-9 | Medium | Google Fonts CDN dependency in production | 1h |
| M-10 | Medium | Unreachable code in pivotService.ts | 5 min |
| L-1 | Low | No automated tests of any kind | 3–5d |
| L-2 | Low | No mobile / responsive layout | 2–5d |
| L-3 | Low | No deployment runbook or token rotation docs | 1d |
| L-4 | Low | `window.prompt()` for custom timeframe in App.tsx | 15 min |
| L-5 | Low | `require()` mixed with ESM imports in server.ts | 10 min |

---

## Final Recommendation

### Is this application ready for daily professional use?

**No.** The four Critical findings mean the application is currently producing zero OI data (expired tokens), has a forgeable authentication system (insecure JWT secrets), and has exposed production credentials in the `.env` file. A trader using this today would see blank OI columns and an empty table.

### Would you confidently deploy it for a client who trades every day?

Not in its current state. After fixing the Critical issues, the application has a strong foundation and could serve a professional trader well — the architecture is sound, the data pipeline is correctly designed, and the UI is clean. But two recurring operational risks (weekly option rollover, monthly futures rollover) would break the system every Thursday without a documented process and ideally automated handling.

### What must be completed before production deployment?

In strict order:

1. **Rotate all credentials** (C-1) — every secret in `.env` must be considered compromised
2. **Set real JWT secrets** (C-2) — otherwise authentication is trivially bypassable
3. **Update NIFTY instrument tokens** (C-3, C-4) — Module 1 produces no data without this
4. **Establish weekly/monthly rollover process** (C-5) — document it and ideally automate it
5. **Fix WebSocket reconnection** (H-2) — 30-second give-up during a 6-hour trading day is unacceptable
6. **Add request timeouts** (H-1) — hung API calls leave traders staring at spinners indefinitely
7. **Fix PivotLevels collection growth** (H-3) — will cause a database incident within weeks
8. **Remove legacy module login defaults** (H-10) — security gap accessible to any user
9. **Separate module token signing secret** (H-8) — removes auth layer boundary violation

Items H-4 through H-9 and all Medium items can be addressed in the first maintenance sprint after initial deployment, but should not be deferred beyond the first month of live operation.
