import { create } from "zustand";
import {
  UserSession,
  PivotLevels,
  Module1Indicators,
  Module2SessionData,
  Module2Cell,
  Module2StrikeState
} from "@stock/shared";

interface AppState {
  // Authentication State
  user: UserSession | null;
  accessToken: string | null;
  setAuth: (user: UserSession | null, token: string | null) => void;
  clearAuth: () => void;
  clearAppAuth: () => void;   // clears only app-level auth, preserves module tokens

  // Module-level authentication tokens (sessionStorage-persisted)
  module1Token: string | null;
  module2Token: string | null;
  setModule1Token: (token: string | null) => void;
  setModule2Token: (token: string | null) => void;

  // Watchlist & Column Preferences State
  watchlist: string[];
  columnPrefs: Record<string, boolean>;
  setWatchlist: (symbols: string[]) => void;
  setColumnPrefs: (prefs: Record<string, boolean>) => void;

  // Module 1 Interactive State
  selectedSymbol: string;
  selectedTimeframe: string;
  selectedMethod: "classic" | "camarilla" | "fibonacci";
  setSelectedSymbol: (symbol: string) => void;
  setSelectedTimeframe: (tf: string) => void;
  setSelectedMethod: (method: "classic" | "camarilla" | "fibonacci") => void;

  // Live Pricing Feed Cache
  prices: Record<string, { ltp: number; lastUpdated: Date }>;
  updatePrice: (symbol: string, ltp: number) => void;

  // Pivot Levels & Signals State
  pivots: Record<string, Record<string, Record<string, PivotLevels>>>; // pivots[symbol][tf][method]
  indicators: Record<string, Record<string, Record<string, Module1Indicators>>>; // indicators[symbol][tf][method]
  setPivots: (symbol: string, tf: string, method: string, levels: PivotLevels) => void;
  setIndicators: (symbol: string, tf: string, method: string, signal: Module1Indicators) => void;

  // Module 2 Tracker Session State
  activeSession: Module2SessionData | null;
  setActiveSession: (session: Module2SessionData | null) => void;
  updateSessionStrikes: (strikes: string[]) => void;
  appendTrackerCell: (strike: string, cell: Module2Cell, stateUpdate: Partial<Module2StrikeState>) => void;
  updateFuturesOI: (futuresOI: any) => void;

  // Module 1 latest metrics state
  latestOiMetrics: Module1OiMetrics | null;
  setLatestOiMetrics: (metrics: Module1OiMetrics | null) => void;
}

export interface Module1OiMetrics {
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
  callSignal: "STRONG_BULL" | "MILD_BULL" | "NEUTRAL" | "MILD_BEAR" | "STRONG_BEAR" | "DIVERGENCE";
  putSignal: "STRONG_BULL" | "MILD_BULL" | "NEUTRAL" | "MILD_BEAR" | "STRONG_BEAR" | "DIVERGENCE";
}

export const useStore = create<AppState>((set) => ({
  // Authentication State
  user: null,
  accessToken: null,
  setAuth: (user, token) => set({ user, accessToken: token }),
  clearAuth: () => {
    sessionStorage.removeItem("m1_token");
    sessionStorage.removeItem("m2_token");
    set({ user: null, accessToken: null, activeSession: null, latestOiMetrics: null, module1Token: null, module2Token: null });
  },
  // Clears only the app JWT — module tokens remain intact
  clearAppAuth: () => {
    set({ user: null, accessToken: null, activeSession: null, latestOiMetrics: null });
  },

  // Module token state
  module1Token: sessionStorage.getItem("m1_token") || null,
  module2Token: sessionStorage.getItem("m2_token") || null,
  setModule1Token: (token) => {
    if (token) sessionStorage.setItem("m1_token", token);
    else sessionStorage.removeItem("m1_token");
    set({ module1Token: token });
  },
  setModule2Token: (token) => {
    if (token) sessionStorage.setItem("m2_token", token);
    else sessionStorage.removeItem("m2_token");
    set({ module2Token: token });
  },

  // Module 1 metrics
  latestOiMetrics: null,
  setLatestOiMetrics: (metrics) => set({ latestOiMetrics: metrics }),

  // Watchlist State
  watchlist: ["NIFTY-SPOT", "NIFTY-FUT"],
  columnPrefs: { pivots: true, indicators: true },
  setWatchlist: (symbols) => set({ watchlist: symbols }),
  setColumnPrefs: (prefs) => set({ columnPrefs: prefs }),

  // Module 1 Preferences
  selectedSymbol: "NIFTY-FUT",
  selectedTimeframe: "5m",
  selectedMethod: "classic",
  setSelectedSymbol: (symbol) => set({ selectedSymbol: symbol }),
  setSelectedTimeframe: (tf) => set({ selectedTimeframe: tf }),
  setSelectedMethod: (method) => set({ selectedMethod: method }),

  // Live Price Cache
  prices: {},
  updatePrice: (symbol, ltp) =>
    set((state) => ({
      prices: {
        ...state.prices,
        [symbol]: { ltp, lastUpdated: new Date() }
      }
    })),

  // Pivots & Indicators State Cache
  pivots: {},
  indicators: {},
  setPivots: (symbol, tf, method, levels) =>
    set((state) => {
      const copy = { ...state.pivots };
      if (!copy[symbol]) copy[symbol] = {};
      if (!copy[symbol][tf]) copy[symbol][tf] = {};
      copy[symbol][tf][method] = levels;
      return { pivots: copy };
    }),
  setIndicators: (symbol, tf, method, signal) =>
    set((state) => {
      const copy = { ...state.indicators };
      if (!copy[symbol]) copy[symbol] = {};
      if (!copy[symbol][tf]) copy[symbol][tf] = {};
      copy[symbol][tf][method] = signal;
      return { indicators: copy };
    }),

  // Module 2 Session State
  activeSession: null,
  setActiveSession: (session) => set({ activeSession: session }),
  updateSessionStrikes: (strikes) =>
    set((state) => {
      if (!state.activeSession) return {};
      return {
        activeSession: {
          ...state.activeSession,
          selectedStrikes: strikes
        }
      };
    }),
  appendTrackerCell: (strike, cell, stateUpdate) =>
    set((state) => {
      if (!state.activeSession || !state.activeSession.strikes[strike]) return {};

      const currentStrikeState = state.activeSession.strikes[strike];
      
      // Prevent duplicate cell additions for the same minute index
      const gridCopy = [...currentStrikeState.grid];
      const existingCellIdx = gridCopy.findIndex((c) => c.minute === cell.minute);
      if (existingCellIdx >= 0) {
        gridCopy[existingCellIdx] = cell; // Update existing
      } else {
        gridCopy.push(cell); // Append new minute cell
      }

      const updatedStrikeState: Module2StrikeState = {
        ...currentStrikeState,
        ...stateUpdate,
        grid: gridCopy
      };

      return {
        activeSession: {
          ...state.activeSession,
          strikes: {
            ...state.activeSession.strikes,
            [strike]: updatedStrikeState
          }
        }
      };
    }),
  updateFuturesOI: (futuresOI) =>
    set((state) => {
      if (!state.activeSession) return {};
      return {
        activeSession: {
          ...state.activeSession,
          futuresOI: {
            ...state.activeSession.futuresOI,
            ...futuresOI
          }
        }
      };
    })
}));
