"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const market_1 = require("../controllers/market");
const router = (0, express_1.Router)();
// Watchlist routes
router.get("/watchlist", auth_1.authenticate, market_1.getWatchlist);
router.put("/watchlist", auth_1.authenticate, market_1.updateWatchlist);
// Market pricing & data routes
router.get("/market/spot/:symbol", auth_1.authenticate, market_1.getSpotPrice);
router.get("/market/futures/:symbol", auth_1.authenticate, market_1.getFuturesData);
router.get("/market/ohlc/:symbol/:tf", auth_1.authenticate, market_1.getOHLCBars);
router.get("/market/ohlc-history/:symbol/:tf", auth_1.authenticate, market_1.getHistoricalOHLCBars);
router.get("/market/pivots/:symbol/:tf", auth_1.authenticate, market_1.getPivotLevelsEndpoint);
router.get("/market/option-chain/:index", auth_1.authenticate, market_1.getOptionChain);
router.post("/market/custom-timeframe", auth_1.authenticate, market_1.updateCustomTimeframe);
router.get("/market/status", auth_1.authenticate, market_1.getMarketStatus);
router.get("/module/status", auth_1.authenticate, market_1.getModuleStatus);
// Module 1 Indicators
router.get("/module1/indicators/:symbol", auth_1.authenticate, market_1.getIndicatorsEndpoint);
router.get("/module1/latest-oi", market_1.getModule1LatestOi);
exports.default = router;
