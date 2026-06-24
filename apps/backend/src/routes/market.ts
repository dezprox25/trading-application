import { Router } from "express";
import { authenticate } from "../middleware/auth";
import {
  getWatchlist,
  updateWatchlist,
  getSpotPrice,
  getFuturesData,
  getOHLCBars,
  getPivotLevelsEndpoint,
  getIndicatorsEndpoint,
  getModule1LatestOi,
  getOptionChain,
  updateCustomTimeframe,
  getMarketStatus,
  getModuleStatus
} from "../controllers/market";

const router = Router();

// Watchlist routes
router.get("/watchlist", authenticate, getWatchlist);
router.put("/watchlist", authenticate, updateWatchlist);

// Market pricing & data routes
router.get("/market/spot/:symbol", authenticate, getSpotPrice);
router.get("/market/futures/:symbol", authenticate, getFuturesData);
router.get("/market/ohlc/:symbol/:tf", authenticate, getOHLCBars);
router.get("/market/pivots/:symbol/:tf", authenticate, getPivotLevelsEndpoint);
router.get("/market/option-chain/:index", authenticate, getOptionChain);
router.post("/market/custom-timeframe", authenticate, updateCustomTimeframe);
router.get("/market/status", authenticate, getMarketStatus);
router.get("/module/status", authenticate, getModuleStatus);

// Module 1 Indicators
router.get("/module1/indicators/:symbol", authenticate, getIndicatorsEndpoint);
router.get("/module1/latest-oi", getModule1LatestOi);

export default router;
