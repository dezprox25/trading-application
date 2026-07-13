import axios from "axios";
import { getModule2MissingInteractiveConfig } from "./module2InteractiveDataService";

/**
 * Market Data (Symphony XTS / AETRAM) authentication & session management.
 *
 * Single source of truth for the Module 2 Market Data session. All other
 * services (REST lookups, WebSocket feed) must read the token from here and
 * must never keep their own copy of session state.
 *
 * Only session information is stored — credentials are used transiently for
 * the login request and never retained.
 */

export type MarketDataAuthStatus =
  | "AUTHENTICATED"
  | "NOT_AUTHENTICATED"
  | "EXPIRED"
  | "WAITING_FOR_CONFIGURATION";

export interface MarketDataSession {
  token: string;
  userID: string;
  loginTime: Date;
  expiresAt: Date;
}

export interface MarketDataLoginResult {
  ok: boolean;
  status: MarketDataAuthStatus;
  userID?: string;
  expiresAt?: string;
  error?: string;
  httpStatus?: number;
}

export interface MarketDataAuthHealth {
  status: MarketDataAuthStatus;
  authenticated: boolean;
  userID: string | null;
  loginTime: string | null;
  expiresAt: string | null;
  missingConfig: string[];
}

// ── In-memory session state ───────────────────────────────────────────────────
let session: MarketDataSession | null = null;
// Distinguishes "was authenticated but the session ended" (EXPIRED) from
// "never authenticated" (NOT_AUTHENTICATED) in status reports.
let sessionEnded: "expired" | "logout" | null = null;

// XTS tokens have no expiry field in the login response; track a local TTL so
// stale sessions are detected proactively instead of only via 401 responses.
// Kept at 8h to match the module JWT lifetime issued on broker login.
const DEFAULT_SESSION_TTL_HOURS = 8;

const getSessionTtlMs = (): number => {
  const hours = Number(process.env.MOD2_SESSION_TTL_HOURS || DEFAULT_SESSION_TTL_HOURS);
  return (Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_SESSION_TTL_HOURS) * 3600 * 1000;
};

const getAuthUrl = () => (process.env.AETRAM_MARKETDATA_AUTH_URL || "").trim();
const getBaseUrl = () => (process.env.AETRAM_MARKETDATA_API_BASE_URL || "").trim();
const getEnvAppKey = () => (process.env.MOD2_API_KEY || "").trim();
const getEnvSecret = () => (process.env.MOD2_API_SECRET || "").trim();

const isTtlElapsed = (): boolean =>
  !!session && Date.now() >= session.expiresAt.getTime();

/** Strips anything token-like from an upstream response before it is logged or returned. */
const sanitizeUpstreamBody = (body: unknown): unknown => {
  if (!body || typeof body !== "object") return body;
  const clone: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  if (clone.result && typeof clone.result === "object") {
    const result = { ...(clone.result as Record<string, unknown>) };
    delete result.token;
    clone.result = result;
  }
  delete (clone as Record<string, unknown>).token;
  return clone;
};

// ── Session accessors ─────────────────────────────────────────────────────────

export const isMarketDataAuthenticated = (): boolean => {
  if (!session) return false;
  if (isTtlElapsed()) {
    markMarketDataSessionExpired();
    return false;
  }
  return true;
};

export const getMarketDataToken = (): string | null =>
  isMarketDataAuthenticated() ? session!.token : null;

export const getMarketDataUser = (): string | null =>
  isMarketDataAuthenticated() ? session!.userID : null;

export const getMarketDataSession = (): MarketDataSession | null =>
  isMarketDataAuthenticated() ? { ...session! } : null;

export const getMarketDataAuthStatus = (): MarketDataAuthStatus => {
  if (getModule2MissingInteractiveConfig().length > 0 && !session) {
    return "WAITING_FOR_CONFIGURATION";
  }
  if (isMarketDataAuthenticated()) return "AUTHENTICATED";
  return sessionEnded === "expired" ? "EXPIRED" : "NOT_AUTHENTICATED";
};

export const getMarketDataAuthHealth = (): MarketDataAuthHealth => {
  const authenticated = isMarketDataAuthenticated();
  return {
    status: getMarketDataAuthStatus(),
    authenticated,
    userID: authenticated ? session!.userID : null,
    loginTime: authenticated ? session!.loginTime.toISOString() : null,
    expiresAt: authenticated ? session!.expiresAt.toISOString() : null,
    missingConfig: getModule2MissingInteractiveConfig(),
  };
};

/** Called on 401s from any Market Data request so all consumers see the same state. */
export const markMarketDataSessionExpired = (): void => {
  if (session) {
    console.warn("[Module2Auth] Session expired.");
  }
  session = null;
  sessionEnded = "expired";
};

// ── Login / logout ────────────────────────────────────────────────────────────

/**
 * Authenticate against the Symphony XTS Market Data API.
 * Credentials may be provided at runtime (user login) or omitted to fall back
 * to the configured MOD2_API_KEY / MOD2_API_SECRET.
 */
export const loginMarketData = async (
  appKey?: string,
  secretKey?: string
): Promise<MarketDataLoginResult> => {
  const authUrl = getAuthUrl();
  const key = (appKey || getEnvAppKey()).trim();
  const secret = (secretKey || getEnvSecret()).trim();

  const missing: string[] = [];
  if (!authUrl) missing.push("AETRAM_MARKETDATA_AUTH_URL");
  if (!getBaseUrl()) missing.push("AETRAM_MARKETDATA_API_BASE_URL");
  if (!key) missing.push("MOD2_API_KEY (or request appKey)");
  if (!secret) missing.push("MOD2_API_SECRET (or request secretKey)");

  if (missing.length > 0) {
    console.error(`[Module2Auth] Configuration error — missing: ${missing.join(", ")}`);
    return {
      ok: false,
      status: "WAITING_FOR_CONFIGURATION",
      error: `Market Data API not configured. Missing: ${missing.join(", ")}`,
    };
  }

  console.log("[Module2Auth] Authentication started.");

  try {
    const response = await axios.post(
      authUrl,
      { secretKey: secret, appKey: key, source: "WEBAPI" },
      { headers: { "Content-Type": "application/json" }, timeout: 15000 }
    );

    const body = response.data;
    // XTS wraps every response as { type: "success"|"error", code: "<granular-code>", ... } —
    // e.g. a successful login carries code "s-response-0001", never the literal string
    // "success". "type" is the actual success/failure discriminant (verified against the
    // official symphonyfintech/xts-binary-marketdata-nodeJS-api SDK + public API docs).
    if (body?.type === "success" && body?.result?.token) {
      const now = new Date();
      session = {
        token: String(body.result.token),
        userID: String(body.result.userID || ""),
        loginTime: now,
        expiresAt: new Date(now.getTime() + getSessionTtlMs()),
      };
      sessionEnded = null;
      console.log(
        `[Module2Auth] Authentication success. User: ${session.userID} | Session valid until ${session.expiresAt.toISOString()}`
      );
      return {
        ok: true,
        status: "AUTHENTICATED",
        userID: session.userID,
        expiresAt: session.expiresAt.toISOString(),
      };
    }

    console.warn(
      "[Module2Auth] Authentication failed — unexpected response:",
      JSON.stringify(sanitizeUpstreamBody(body))
    );
    return {
      ok: false,
      status: "NOT_AUTHENTICATED",
      error: body?.description || "Authentication rejected by Market Data API.",
      httpStatus: response.status,
    };
  } catch (error: any) {
    const httpStatus: number | undefined = error?.response?.status;
    let reason: string;

    if (error?.code === "ECONNABORTED") {
      reason = "Market Data API request timed out.";
    } else if (httpStatus) {
      const upstream = sanitizeUpstreamBody(error.response?.data) as any;
      reason = upstream?.description || `Market Data API rejected the request (HTTP ${httpStatus}).`;
      console.warn(
        `[Module2Auth] Authentication failed — HTTP ${httpStatus}:`,
        JSON.stringify(upstream)
      );
    } else {
      reason = "Could not reach the Market Data API (network error).";
    }

    if (!httpStatus) {
      console.error(`[Module2Auth] Authentication failed — ${reason} (${error?.message || error})`);
    }
    return { ok: false, status: "NOT_AUTHENTICATED", error: reason, httpStatus };
  }
};

/**
 * End the Market Data session. Best-effort remote invalidation, then the local
 * session is always cleared.
 */
export const logoutMarketData = async (): Promise<{ loggedOut: boolean }> => {
  const token = session?.token;
  const baseUrl = getBaseUrl();

  if (token && baseUrl) {
    try {
      await axios.delete(`${baseUrl}/auth/logout`, {
        headers: { authorization: token },
        timeout: 8000,
      });
      console.log("[Module2Auth] Remote session invalidated.");
    } catch (error: any) {
      // Local logout still proceeds — the token dies with the local session.
      console.warn(
        `[Module2Auth] Remote logout failed (${error?.response?.status || error?.code || error?.message}). Clearing local session anyway.`
      );
    }
  }

  session = null;
  sessionEnded = "logout";
  console.log("[Module2Auth] Logout complete — session cleared.");
  return { loggedOut: true };
};
