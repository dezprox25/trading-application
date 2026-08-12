"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logModule2InteractiveStatus = exports.getModule2DataSource = exports.getModule2MissingInteractiveConfig = exports.getModule2MissingMarketDataConfig = void 0;
const isPlaceholder = (value) => !value || value.includes("your-") || value.includes("placeholder");
const getModule2MissingMarketDataConfig = () => {
    const missing = [];
    const key = process.env.AETRAM_APP_KEY || process.env.MOD2_API_KEY;
    const secret = process.env.AETRAM_SECRET_KEY || process.env.MOD2_API_SECRET;
    if (isPlaceholder(key))
        missing.push("AETRAM_APP_KEY");
    if (isPlaceholder(secret))
        missing.push("AETRAM_SECRET_KEY");
    if (isPlaceholder(process.env.AETRAM_MARKETDATA_API_BASE_URL))
        missing.push("AETRAM_MARKETDATA_API_BASE_URL");
    if (isPlaceholder(process.env.AETRAM_MARKETDATA_AUTH_URL))
        missing.push("AETRAM_MARKETDATA_AUTH_URL");
    return missing;
};
exports.getModule2MissingMarketDataConfig = getModule2MissingMarketDataConfig;
exports.getModule2MissingInteractiveConfig = exports.getModule2MissingMarketDataConfig;
const getModule2DataSource = () => (0, exports.getModule2MissingMarketDataConfig)().length === 0 ? "LIVE_MARKET_DATA_API" : "UNAVAILABLE";
exports.getModule2DataSource = getModule2DataSource;
const logModule2InteractiveStatus = () => {
    const missing = (0, exports.getModule2MissingMarketDataConfig)();
    if (missing.length === 0) {
        console.log("[Module2] Market Data API configured (Pure Live Display System).");
        return;
    }
    console.log(`[Module2] Market Data API not fully configured — missing: ${missing.join(", ")}`);
};
exports.logModule2InteractiveStatus = logModule2InteractiveStatus;
