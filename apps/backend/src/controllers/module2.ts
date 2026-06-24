import { Request, Response } from "express";
import { activeSessions } from "../services/trackerService";
import { getModule2DataSource, getModule2MissingInteractiveConfig } from "../services/module2InteractiveDataService";

/**
 * Returns Module 2 configuration status and session count (safe, no secrets exposed)
 */
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
