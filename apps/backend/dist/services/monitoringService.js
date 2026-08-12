"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stopMonitoringLoop = exports.startMonitoringLoop = exports.getMonitoringStatus = exports.recordTickReceived = void 0;
const redisWriteBuffer_1 = require("./redisWriteBuffer");
const zebuMarketDataClient_1 = require("./zebuMarketDataClient");
const aetramMarketDataService_1 = require("./aetramMarketDataService");
let lastTickTimeModule1 = Date.now();
let lastTickTimeModule2 = Date.now();
/**
 * Call this whenever a new tick is received to update the freshness timestamp for the specified module.
 */
const recordTickReceived = (moduleId = "module1") => {
    const now = Date.now();
    if (moduleId === "module2") {
        lastTickTimeModule2 = now;
        console.log(`[MODULE2][MONITOR] module2 lastTickAt updated: ${new Date(now).toISOString()}`);
    }
    else {
        lastTickTimeModule1 = now;
    }
};
exports.recordTickReceived = recordTickReceived;
/**
 * Evaluates the status of the live data feed, cached prices, and generates alerts if needed.
 */
const getMonitoringStatus = async () => {
    const now = Date.now();
    const secondsSinceModule1Tick = (now - lastTickTimeModule1) / 1000;
    const secondsSinceModule2Tick = (now - lastTickTimeModule2) / 1000;
    // Memory-first: this loop runs every 10s — hitting Redis for it cost ~100K
    // commands/month for values the tick pipeline already holds in-process.
    const spotLtp = await (0, redisWriteBuffer_1.readLive)("ltp:NIFTY-SPOT");
    const futLtp = await (0, redisWriteBuffer_1.readLive)("ltp:NIFTY-FUT");
    const alerts = [];
    const zebuLive = (0, zebuMarketDataClient_1.isZebuLiveConnected)();
    const aetramLive = (0, aetramMarketDataService_1.isAetramConnected)() === "CONNECTED";
    if (zebuLive) {
        if (secondsSinceModule1Tick > 30) {
            alerts.push(`Module 1 (Zebu) live feed data freshness alert: No ticks received for ${secondsSinceModule1Tick.toFixed(1)} seconds.`);
        }
    }
    if (aetramLive) {
        if (secondsSinceModule2Tick > 30) {
            alerts.push(`Module 2 (Aetram) live feed data freshness alert: No ticks received for ${secondsSinceModule2Tick.toFixed(1)} seconds.`);
        }
    }
    if (!zebuLive && !aetramLive) {
        alerts.push("Module 1 (Zebu) and Module 2 (Aetram) live feeds are disconnected — waiting for broker login/reconnection.");
    }
    if (zebuLive && (!spotLtp || parseFloat(spotLtp) === 0)) {
        alerts.push("Spot LTP is missing or zero.");
    }
    if (zebuLive && (!futLtp || parseFloat(futLtp) === 0)) {
        alerts.push("Futures LTP is missing or zero.");
    }
    // Log alerts to console if any exist
    if (alerts.length > 0) {
        console.warn(`[MONITOR] Active Alerts:\n${alerts.map(a => ` - ${a}`).join("\n")}`);
    }
    return {
        status: alerts.length === 0 ? "OK" : "WARNING",
        lastTickTimeModule1: new Date(lastTickTimeModule1),
        lastTickTimeModule2: new Date(lastTickTimeModule2),
        secondsSinceModule1Tick,
        secondsSinceModule2Tick,
        alerts,
        metrics: {
            spotLtp: spotLtp ? parseFloat(spotLtp) : null,
            futLtp: futLtp ? parseFloat(futLtp) : null,
        }
    };
};
exports.getMonitoringStatus = getMonitoringStatus;
let monitoringInterval = null;
/**
 * Starts a background loop to perform validation checks every 10 seconds.
 * Safe to call multiple times — prevents duplicate intervals.
 */
const startMonitoringLoop = () => {
    if (monitoringInterval)
        return;
    console.log("[MonitoringService] Active validation and freshness loop started.");
    monitoringInterval = setInterval(async () => {
        try {
            await (0, exports.getMonitoringStatus)();
        }
        catch (err) {
            console.error("[MonitoringService] Error running monitoring status checks:", err);
        }
    }, 10000);
};
exports.startMonitoringLoop = startMonitoringLoop;
const stopMonitoringLoop = () => {
    if (monitoringInterval) {
        clearInterval(monitoringInterval);
        monitoringInterval = null;
    }
};
exports.stopMonitoringLoop = stopMonitoringLoop;
