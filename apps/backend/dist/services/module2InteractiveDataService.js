"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logModule2InteractiveStatus = exports.getModule2DataSource = exports.getModule2MissingInteractiveConfig = void 0;
const isPlaceholder = (value) => !value || value.includes("your-") || value.includes("placeholder");
const getModule2MissingInteractiveConfig = () => {
    const missing = [];
    if (isPlaceholder(process.env.MOD2_API_KEY))
        missing.push("MOD2_API_KEY");
    if (isPlaceholder(process.env.MOD2_API_SECRET))
        missing.push("MOD2_API_SECRET");
    if (isPlaceholder(process.env.AETRAM_MARKETDATA_API_BASE_URL))
        missing.push("AETRAM_MARKETDATA_API_BASE_URL");
    if (isPlaceholder(process.env.AETRAM_MARKETDATA_AUTH_URL))
        missing.push("AETRAM_MARKETDATA_AUTH_URL");
    return missing;
};
exports.getModule2MissingInteractiveConfig = getModule2MissingInteractiveConfig;
const getModule2DataSource = () => (0, exports.getModule2MissingInteractiveConfig)().length === 0 ? "LIVE_INTERACTIVE_API" : "UNAVAILABLE";
exports.getModule2DataSource = getModule2DataSource;
const logModule2InteractiveStatus = () => {
    const missing = (0, exports.getModule2MissingInteractiveConfig)();
    if (missing.length === 0) {
        console.log("[Module2] MarketData API configured.");
        return;
    }
    console.log(`[Module2] MarketData API not fully configured — missing: ${missing.join(", ")}`);
};
exports.logModule2InteractiveStatus = logModule2InteractiveStatus;
