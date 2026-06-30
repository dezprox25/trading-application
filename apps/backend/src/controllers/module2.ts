import { Request, Response } from "express";
import { activeSessions } from "../services/trackerService";
import { getModule2DataSource, getModule2MissingInteractiveConfig } from "../services/module2InteractiveDataService";
import { getAetramExpiryDates } from "../services/aetramMarketDataService";

export const getModule2Status = (req: Request, res: Response) => {
  const isConfigured = !!(process.env.MOD2_API_KEY && process.env.MOD2_API_SECRET);
  const dataSource = getModule2DataSource();
  res.json({
    status: isConfigured ? "configured" : "missing_credentials",
    dataSource,
    missingRequirements: dataSource === "UNAVAILABLE" ? getModule2MissingInteractiveConfig() : [],
    activeSessionsCount: Object.keys(activeSessions).length,
  });
};

export const getModule2Expiries = async (req: Request, res: Response) => {
  const symbol = ((req.query.symbol as string) || "NIFTY50").trim().toUpperCase();
  try {
    const expiries = await getAetramExpiryDates(symbol);
    res.json({ symbol, expiries });
  } catch {
    res.json({ symbol, expiries: [] });
  }
};
