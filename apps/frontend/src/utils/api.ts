import { useStore } from "../store/useStore";

interface RequestOptions extends RequestInit {
  skipAuth?: boolean;
}

const handleResponse = async (response: Response) => {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    // Create an enriched error that carries all fields from the response body
    const err: any = new Error(data?.error || `Request failed with status ${response.status}`);
    if (data) Object.assign(err, data);
    throw err;
  }
  return data;
};

export const api = {
  request: async (url: string, options: RequestOptions = {}): Promise<any> => {
    const { accessToken, setAuth } = useStore.getState();
    const headers = new Headers(options.headers || {});

    // Set default JSON headers
    if (!(options.body instanceof FormData) && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    // Set JWT Bearer Token
    if (accessToken && !options.skipAuth) {
      headers.set("Authorization", `Bearer ${accessToken}`);
    }

    options.headers = headers;

    try {
      const response = await fetch(url, options);

      // Handle 401 Unauthorized (attempt token refresh)
      if (response.status === 401 && accessToken && !options.skipAuth) {
        console.log("[API] Access token expired. Attempting silent token refresh...");

        try {
          const refreshRes = await fetch("/auth/refresh", { method: "POST" });
          const refreshData = await refreshRes.json();

          if (refreshRes.ok && refreshData.accessToken) {
            // Update app token in Zustand and retry original request
            const { user } = useStore.getState();
            setAuth(user, refreshData.accessToken);

            // Re-bind new header and retry
            headers.set("Authorization", `Bearer ${refreshData.accessToken}`);
            options.headers = headers;
            const retryResponse = await fetch(url, options);
            return await handleResponse(retryResponse);
          } else {
            // Refresh token expired — clear only the app JWT, preserve module tokens
            console.warn("[API] Refresh token expired or invalid. Clearing app session only.");
            useStore.getState().clearAppAuth();
            throw new Error("Session expired. Please log in again.");
          }
        } catch (refreshErr: any) {
          // Network error during refresh — clear only app JWT, preserve module tokens
          if (!refreshErr?.message?.includes("Session expired")) {
            useStore.getState().clearAppAuth();
          }
          throw refreshErr;
        }
      }

      return await handleResponse(response);
    } catch (error) {
      throw error;
    }
  },

  get: (url: string, options?: RequestOptions) => api.request(url, { ...options, method: "GET" }),
  post: (url: string, body?: any, options?: RequestOptions) =>
    api.request(url, { ...options, method: "POST", body: body ? JSON.stringify(body) : undefined }),
  put: (url: string, body?: any, options?: RequestOptions) =>
    api.request(url, { ...options, method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  delete: (url: string, options?: RequestOptions) => api.request(url, { ...options, method: "DELETE" }),
};
export default api;

export type Module1OiSignal = "STRONG_BULL" | "MILD_BULL" | "NEUTRAL" | "MILD_BEAR" | "STRONG_BEAR" | "DIVERGENCE";

export interface Module1OiMetricsResponse {
  timestamp: string;
  dataSource?: "LIVE_MARKET_API" | "SIMULATOR";
  tin: number;
  c_tl: number;
  c_mn: number;
  c_hig: number;
  c_low: number;
  c_buy: number;
  c_sell: number;
  f_buy: number;
  f_sell: number;
  p_tl: number;
  p_mn: number;
  p_hig: number;
  p_low: number;
  p_buy: number;
  p_sell: number;
  callSignal: Module1OiSignal;
  putSignal: Module1OiSignal;
}

// Module1 is display-only analytics, so this must be backed by MARKET DATA API endpoints only.
// Future backend integration should source real option-chain OI totals and futures OI from backend
// env-protected credentials. Frontend must never receive API keys/secrets.
export const getModule1LatestMetrics = async (): Promise<Module1OiMetricsResponse | null> => {
  try {
    return await api.get("/api/module1/latest-oi");
  } catch (error: any) {
    // Endpoint is not wired yet. Keep Module1 alive by falling back to current UI proxy calculations.
    if (error?.message?.includes("404") || error?.status === 404) return null;
    console.warn("[Module1] Latest OI metrics unavailable; using proxy fallback values.", error);
    return null;
  }
};
