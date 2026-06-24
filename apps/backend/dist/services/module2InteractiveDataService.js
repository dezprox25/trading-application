"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logModule2InteractiveStatus = exports.getModule2DataSource = exports.getModule2MissingInteractiveConfig = void 0;
const isPlaceholder = (value) => !value || value.includes("your-") || value.includes("placeholder");
const getInteractiveBaseUrl = () => process.env.AETRAM_INTERACTIVE_API_BASE_URL || process.env.MOD2_INTERACTIVE_API_BASE_URL || "";
const getInteractiveAuthUrl = () => process.env.AETRAM_INTERACTIVE_AUTH_URL || process.env.MOD2_INTERACTIVE_AUTH_URL || "";
const getModule2MissingInteractiveConfig = () => {
    const missing = [];
    const key = process.env.MOD2_INTERACTIVE_API_KEY || process.env.MOD2_API_KEY;
    const secret = process.env.MOD2_INTERACTIVE_API_SECRET || process.env.MOD2_API_SECRET;
    if (isPlaceholder(key))
        missing.push("MOD2_INTERACTIVE_API_KEY");
    if (isPlaceholder(secret))
        missing.push("MOD2_INTERACTIVE_API_SECRET");
    if (isPlaceholder(getInteractiveBaseUrl())) {
        missing.push("AETRAM_INTERACTIVE_API_BASE_URL or MOD2_INTERACTIVE_API_BASE_URL");
    }
    if (isPlaceholder(getInteractiveAuthUrl())) {
        missing.push("AETRAM_INTERACTIVE_AUTH_URL or MOD2_INTERACTIVE_AUTH_URL");
    }
    return missing;
};
exports.getModule2MissingInteractiveConfig = getModule2MissingInteractiveConfig;
const getModule2DataSource = () => (0, exports.getModule2MissingInteractiveConfig)().length === 0 ? "LIVE_INTERACTIVE_API" : "UNAVAILABLE";
exports.getModule2DataSource = getModule2DataSource;
const logModule2InteractiveStatus = () => {
    console.log("[Module2] Authenticating with Interactive Data API");
    const missing = (0, exports.getModule2MissingInteractiveConfig)();
    if (missing.length === 0) {
        console.log("[Module2] Live data connected");
        return;
    }
    console.log(`[Module2] Live data unavailable: missing ${missing.join(", ")}`);
};
exports.logModule2InteractiveStatus = logModule2InteractiveStatus;
