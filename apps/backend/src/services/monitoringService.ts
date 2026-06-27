import redis from "../config/redis";
import { isZebuLiveConnected } from "./zebuMarketDataClient";

let lastTickTime = Date.now();

/**
 * Call this whenever a new tick is received to update the freshness timestamp.
 */
export const recordTickReceived = () => {
  lastTickTime = Date.now();
};

/**
 * Evaluates the status of the live data feed, cached prices, and generates alerts if needed.
 */
export const getMonitoringStatus = async () => {
  const now = Date.now();
  const secondsSinceLastTick = (now - lastTickTime) / 1000;
  
  const spotLtp = await redis.get("ltp:NIFTY-SPOT");
  const futLtp = await redis.get("ltp:NIFTY-FUT");
  
  const alerts: string[] = [];
  
  if (isZebuLiveConnected()) {
    if (secondsSinceLastTick > 15) {
      alerts.push(`Live feed data freshness alert: No ticks received for ${secondsSinceLastTick.toFixed(1)} seconds.`);
    }
  } else {
    alerts.push("Live feed is disconnected. No live data available — waiting for broker reconnection.");
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

let monitoringInterval: NodeJS.Timeout | null = null;

/**
 * Starts a background loop to perform validation checks every 10 seconds.
 * Safe to call multiple times — prevents duplicate intervals.
 */
export const startMonitoringLoop = () => {
  if (monitoringInterval) return;
  console.log("[MonitoringService] Active validation and freshness loop started.");
  monitoringInterval = setInterval(async () => {
    try {
      await getMonitoringStatus();
    } catch (err) {
      console.error("[MonitoringService] Error running monitoring status checks:", err);
    }
  }, 10000);
};

export const stopMonitoringLoop = () => {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
  }
};
