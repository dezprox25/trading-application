"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startMonitoringLoop = exports.getMonitoringStatus = exports.recordTickReceived = void 0;
const redis_1 = __importDefault(require("../config/redis"));
const zebuMarketDataClient_1 = require("./zebuMarketDataClient");
let lastTickTime = Date.now();
/**
 * Call this whenever a new tick is received to update the freshness timestamp.
 */
const recordTickReceived = () => {
    lastTickTime = Date.now();
};
exports.recordTickReceived = recordTickReceived;
/**
 * Evaluates the status of the live data feed, cached prices, and generates alerts if needed.
 */
const getMonitoringStatus = async () => {
    const now = Date.now();
    const secondsSinceLastTick = (now - lastTickTime) / 1000;
    const spotLtp = await redis_1.default.get("ltp:NIFTY-SPOT");
    const futLtp = await redis_1.default.get("ltp:NIFTY-FUT");
    const alerts = [];
    if ((0, zebuMarketDataClient_1.isZebuLiveConnected)()) {
        if (secondsSinceLastTick > 15) {
            alerts.push(`Live feed data freshness alert: No ticks received for ${secondsSinceLastTick.toFixed(1)} seconds.`);
        }
    }
    else {
        alerts.push("Live feed is disconnected (running in fallback simulator mode).");
    }
    if (!spotLtp || parseFloat(spotLtp) === 0) {
        alerts.push("Spot LTP is missing or zero.");
    }
    if (!futLtp || parseFloat(futLtp) === 0) {
        alerts.push("Futures LTP is missing or zero.");
    }
    // Log alerts to console if any exist
    if (alerts.length > 0) {
        console.warn(`[MONITOR] Active Alerts:\n${alerts.map(a => ` - ${a}`).join("\n")}`);
    }
    return {
        status: alerts.length === 0 ? "OK" : "WARNING",
        lastTickTime: new Date(lastTickTime),
        secondsSinceLastTick,
        alerts,
        metrics: {
            spotLtp: spotLtp ? parseFloat(spotLtp) : null,
            futLtp: futLtp ? parseFloat(futLtp) : null,
        }
    };
};
exports.getMonitoringStatus = getMonitoringStatus;
/**
 * Starts a background loop to perform validation checks every 10 seconds.
 */
const startMonitoringLoop = () => {
    console.log("[MonitoringService] Active validation and freshness loop started.");
    setInterval(async () => {
        try {
            await (0, exports.getMonitoringStatus)();
        }
        catch (err) {
            console.error("[MonitoringService] Error running monitoring status checks:", err);
        }
    }, 10000); // Check every 10 seconds
};
exports.startMonitoringLoop = startMonitoringLoop;
