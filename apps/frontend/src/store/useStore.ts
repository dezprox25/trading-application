import { create } from "zustand";
import {
  UserSession,
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
  clearAppAuth: () => void;

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

  // Module 1: selected instrument and timeframe
  selectedSymbol: string;
  selectedTimeframe: string;
  setSelectedSymbol: (symbol: string) => void;
  setSelectedTimeframe: (tf: string) => void;

  // Live Pricing Feed Cache (populated by WebSocket ticks)
  prices: Record<string, { ltp: number; lastUpdated: Date }>;
  updatePrice: (symbol: string, ltp: number) => void;

  // Module 2 Tracker Session State
  activeSession: Module2SessionData | null;
  setActiveSession: (session: Module2SessionData | null) => void;
  updateSessionStrikes: (strikes: string[]) => void;
  appendTrackerCell: (strike: string, cell: Module2Cell, stateUpdate: Partial<Module2StrikeState>) => void;
  updateFuturesOI: (futuresOI: any) => void;
}

export const useStore = create<AppState>((set) => ({
  // Authentication State
  user: null,
  accessToken: null,
  setAuth: (user, token) => set({ user, accessToken: token }),
  clearAuth: () => {
    sessionStorage.removeItem("m1_token");
    sessionStorage.removeItem("m2_token");
    set({ user: null, accessToken: null, activeSession: null, module1Token: null, module2Token: null });
  },
  clearAppAuth: () => {
    set({ user: null, accessToken: null, activeSession: null });
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

  // Watchlist State
  watchlist: ["NIFTY-SPOT", "NIFTY-FUT"],
  columnPrefs: {},
  setWatchlist: (symbols) => set({ watchlist: symbols }),
  setColumnPrefs: (prefs) => set({ columnPrefs: prefs }),

  // Module 1: selected instrument and timeframe
  selectedSymbol: "NIFTY-FUT",
  selectedTimeframe: "5m",
  setSelectedSymbol: (symbol) => set({ selectedSymbol: symbol }),
  setSelectedTimeframe: (tf) => set({ selectedTimeframe: tf }),

  // Live Price Cache
  prices: {},
  updatePrice: (symbol, ltp) =>
    set((state) => ({
      prices: {
        ...state.prices,
        [symbol]: { ltp, lastUpdated: new Date() }
      }
    })),

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
      const gridCopy = [...currentStrikeState.grid];
      const existingCellIdx = gridCopy.findIndex((c) => c.minute === cell.minute);
      if (existingCellIdx >= 0) {
        gridCopy[existingCellIdx] = cell;
      } else {
        gridCopy.push(cell);
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
