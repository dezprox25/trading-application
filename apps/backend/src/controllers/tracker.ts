import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth";
import { Module2Session } from "../models/Module2Session";
import {
  startTrackerSession,
  updateTrackerStrikes,
  getSessionData,
  activeSessions
} from "../services/trackerService";
import {
  Module2SessionStartSchema,
  Module2StrikeUpdateSchema,
  Module2FiltersSchema,
  Module2SessionData
} from "@stock/shared";

// Start Module 2 Session
export const startSession = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parseResult = Module2SessionStartSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Validation failed", details: parseResult.error.errors });
    }

    const { sessionType, indexSymbol, expiryDate, selectedStrikes } = parseResult.data;

    // Start new session
    const session = await startTrackerSession(
      userId,
      sessionType,
      indexSymbol,
      expiryDate,
      selectedStrikes
    );

    return res.status(201).json(session);
  } catch (error) {
    console.error("Start Session Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

// Get current active session for user
export const getCurrentSession = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    // Find the latest session created today for this user
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let doc = null;
    try {
      doc = await Module2Session.findOne({
        user_id: userId,
        created_at: { $gte: today }
      }).sort({ created_at: -1 });
    } catch (err) {
      console.warn("[Tracker] DB offline. Fetching active session from memory cache.");
    }

    if (!doc) {
      // Fallback: check in-memory activeSessions
      const userSessions = Object.values(activeSessions).filter(
        (s) => s.userId === userId && new Date(s.createdAt).getTime() >= today.getTime()
      );
      if (userSessions.length > 0) {
        // Return latest
        return res.status(200).json(userSessions[userSessions.length - 1]);
      }
      return res.status(200).json(null);
    }

    const session = await getSessionData(doc._id.toString());
    return res.status(200).json(session);
  } catch (error) {
    console.error("Get Current Session Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

// Update strikes list in the active session
export const updateStrikes = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parseResult = Module2StrikeUpdateSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Validation failed", details: parseResult.error.errors });
    }

    const { selectedStrikes } = parseResult.data;

    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let doc = null;
    try {
      doc = await Module2Session.findOne({
        user_id: userId,
        created_at: { $gte: today }
      }).sort({ created_at: -1 });
    } catch (err) {
      console.warn("[Tracker] DB offline during updateStrikes. Checking memory cache.");
    }

    let sessionId: string | null = null;
    if (doc) {
      sessionId = doc._id.toString();
    } else {
      // Fallback: check in-memory activeSessions
      const userSessions = Object.values(activeSessions).filter(
        (s) => s.userId === userId && new Date(s.createdAt).getTime() >= today.getTime()
      );
      if (userSessions.length > 0) {
        sessionId = userSessions[userSessions.length - 1].sessionId;
      }
    }

    if (!sessionId) {
      return res.status(404).json({ error: "No active session found for today" });
    }

    const updatedSession = await updateTrackerStrikes(sessionId, selectedStrikes);
    return res.status(200).json(updatedSession);
  } catch (error) {
    console.error("Update Strikes Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

// Update filters settings (Front-end stores them, but this updates backend state cache if required)
export const updateFilters = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parseResult = Module2FiltersSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Validation failed", details: parseResult.error.errors });
    }

    // Filters are primarily handled on client rendering side,
    // we return 200 OK acknowledging preferences.
    return res.status(200).json({
      message: "Filters updated successfully",
      filters: parseResult.data
    });
  } catch (error) {
    console.error("Update Filters Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

// Export Grid as CSV
export const exportCSV = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let doc = null;
    try {
      doc = await Module2Session.findOne({
        user_id: userId,
        created_at: { $gte: today }
      }).sort({ created_at: -1 });
    } catch (err) {
      console.warn("[Tracker] DB offline during exportCSV. Checking memory cache.");
    }

    let sessionId: string | null = null;
    if (doc) {
      sessionId = doc._id.toString();
    } else {
      const userSessions = Object.values(activeSessions).filter(
        (s) => s.userId === userId && new Date(s.createdAt).getTime() >= today.getTime()
      );
      if (userSessions.length > 0) {
        sessionId = userSessions[userSessions.length - 1].sessionId;
      }
    }

    if (!sessionId) {
      return res.status(404).json({ error: "No active session found for today" });
    }

    const session = await getSessionData(sessionId);
    if (!session) {
      return res.status(404).json({ error: "Session data not found" });
    }

    const csvContent = buildCSV(session);

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=session_${sessionId}.csv`);
    return res.status(200).send(csvContent);
  } catch (error) {
    console.error("CSV Export Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

/**
 * Builds CSV string from active session data
 */
const buildCSV = (session: Module2SessionData): string => {
  let maxMinutes = 0;
  for (const state of Object.values(session.strikes)) {
    maxMinutes = Math.max(maxMinutes, state.grid.length);
  }

  // Generate headers
  const headers = [
    "Strike", "Day Open", "Day High", "Day Low", "Trend Badge", "Pct Change",
    "OI Buy (Latest)", "OI Sell (Latest)", "OI High", "OI Low"
  ];
  
  // Reconstruct timestamps for header minutes using the first available strike grid
  const firstStrikeKey = Object.keys(session.strikes)[0];
  const firstStrike = firstStrikeKey ? session.strikes[firstStrikeKey] : null;

  for (let m = 0; m < maxMinutes; m++) {
    const timeLabel = firstStrike?.grid[m]?.timestamp || `Min ${m}`;
    headers.push(timeLabel);
  }

  const csvRows = [headers.join(",")];

  for (const strike of session.selectedStrikes) {
    const s = session.strikes[strike];
    if (!s) continue;

    const row = [
      s.strike,
      s.dayOpen,
      s.dayHigh,
      s.dayLow,
      s.trendBadge,
      `${s.pctChange}%`,
      s.oiBuyLatest || 0,
      s.oiSellLatest || 0,
      s.oiHigh || 0,
      s.oiLow || 0
    ];

    for (let m = 0; m < maxMinutes; m++) {
      const cell = s.grid[m];
      if (cell) {
        let val = cell.ltp.toString();
        if (cell.isHigh) val += " (H)";
        if (cell.isLow) val += " (L)";
        row.push(val);
      } else {
        row.push("");
      }
    }
    csvRows.push(row.join(","));
  }

  return csvRows.join("\n");
};

