"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportCSV = exports.updateFilters = exports.updateStrikes = exports.getCurrentSession = exports.stopSession = exports.startSession = void 0;
const Module2Session_1 = require("../models/Module2Session");
const trackerService_1 = require("../services/trackerService");
const shared_1 = require("@stock/shared");
// Start Module 2 Session
const startSession = async (req, res) => {
    console.log("[MODULE2][TRACKER] Request received at backend /api/module2/session/start");
    try {
        const userId = req.user?.id;
        if (!userId) {
            console.error("[MODULE2][TRACKER] Unauthorized: No user ID");
            return res.status(401).json({ error: "Unauthorized" });
        }
        console.log("[MODULE2][TRACKER] Authenticated module/session state:", { userId });
        const parseResult = shared_1.Module2SessionStartSchema.safeParse(req.body);
        if (!parseResult.success) {
            console.error("[MODULE2][TRACKER] Validation failed:", parseResult.error.errors);
            return res.status(400).json({ error: "Validation failed", details: parseResult.error.errors });
        }
        const { sessionType, indexSymbol, expiryDate, selectedStrikes } = parseResult.data;
        console.log("[MODULE2][TRACKER] Symbol:", indexSymbol);
        console.log("[MODULE2][TRACKER] Expiry:", expiryDate);
        console.log("[MODULE2][TRACKER] Session type:", sessionType);
        console.log("[MODULE2][TRACKER] Selected strikes:", selectedStrikes);
        console.log("[MODULE2][TRACKER] Strike count:", selectedStrikes?.length);
        // Start new session
        console.log("[MODULE2][TRACKER] Calling startTrackerSession...");
        const session = await (0, trackerService_1.startTrackerSession)(userId, sessionType, indexSymbol, expiryDate, selectedStrikes);
        console.log("[MODULE2][TRACKER] startTrackerSession returned:", session ? "Session Data" : "null/undefined");
        if (session) {
            console.log("[MODULE2][TRACKER] Tracker/session ID:", session.sessionId);
        }
        return res.status(201).json(session);
    }
    catch (error) {
        console.error("[MODULE2][TRACKER] Start Session Error:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
};
exports.startSession = startSession;
// Stop Module 2 Session
const stopSession = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        console.log(`[MODULE2][TRACKER] Stop button clicked for user=${userId}`);
        // Collect all active session IDs for this user
        const userActiveSessionIds = Object.keys(trackerService_1.activeSessions).filter((sId) => trackerService_1.activeSessions[sId].userId === userId);
        const bodySessionId = req.body?.sessionId;
        if (bodySessionId && !userActiveSessionIds.includes(bodySessionId)) {
            userActiveSessionIds.push(bodySessionId);
        }
        console.log(`[MODULE2][TRACKER] Stopping ${userActiveSessionIds.length} active session(s) for user=${userId}`);
        for (const sId of userActiveSessionIds) {
            await (0, trackerService_1.stopTrackerSession)(sId);
        }
        // Purge memory cache for user
        for (const [sId, sess] of Object.entries(trackerService_1.activeSessions)) {
            if (sess.userId === userId) {
                delete trackerService_1.activeSessions[sId];
            }
        }
        // Delete database session records for this user asynchronously so nothing remains for restoration
        Module2Session_1.Module2Session.deleteMany({ user_id: userId }).catch((err) => {
            console.warn("[MODULE2][TRACKER] Non-blocking DB session delete notice:", err?.message || err);
        });
        console.log("[MODULE2][TRACKER] Session stopped successfully");
        return res.status(200).json({ status: "success", message: "Session stopped successfully" });
    }
    catch (error) {
        console.error("[MODULE2][TRACKER] Stop Session Error:", error);
        // Idempotent fallback — always return 200 OK so frontend state is cleared cleanly
        return res.status(200).json({ status: "success", message: "Session stopped successfully" });
    }
};
exports.stopSession = stopSession;
// Get current active session for user
const getCurrentSession = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        // Only return a session if it is actively running in memory
        const userActiveSession = Object.values(trackerService_1.activeSessions).find((s) => s.userId === userId);
        if (userActiveSession) {
            return res.status(200).json(userActiveSession);
        }
        return res.status(200).json(null);
    }
    catch (error) {
        console.error("Get Current Session Error:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
};
exports.getCurrentSession = getCurrentSession;
// Update strikes list in the active session
const updateStrikes = async (req, res) => {
    try {
        const parseResult = shared_1.Module2StrikeUpdateSchema.safeParse(req.body);
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
            doc = await Module2Session_1.Module2Session.findOne({
                user_id: userId,
                created_at: { $gte: today }
            }).sort({ created_at: -1 });
        }
        catch (err) {
            console.warn("[Tracker] DB offline during updateStrikes. Checking memory cache.");
        }
        let sessionId = null;
        if (doc) {
            sessionId = doc._id.toString();
        }
        else {
            // Fallback: check in-memory activeSessions
            const userSessions = Object.values(trackerService_1.activeSessions).filter((s) => s.userId === userId && new Date(s.createdAt).getTime() >= today.getTime());
            if (userSessions.length > 0) {
                sessionId = userSessions[userSessions.length - 1].sessionId;
            }
        }
        if (!sessionId) {
            return res.status(404).json({ error: "No active session found for today" });
        }
        const updatedSession = await (0, trackerService_1.updateTrackerStrikes)(sessionId, selectedStrikes);
        return res.status(200).json(updatedSession);
    }
    catch (error) {
        console.error("Update Strikes Error:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
};
exports.updateStrikes = updateStrikes;
// Update filters settings (Front-end stores them, but this updates backend state cache if required)
const updateFilters = async (req, res) => {
    try {
        const parseResult = shared_1.Module2FiltersSchema.safeParse(req.body);
        if (!parseResult.success) {
            return res.status(400).json({ error: "Validation failed", details: parseResult.error.errors });
        }
        return res.status(200).json({
            message: "Filters updated successfully",
            filters: parseResult.data
        });
    }
    catch (error) {
        console.error("Update Filters Error:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
};
exports.updateFilters = updateFilters;
// Export Grid as CSV
const exportCSV = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        let doc = null;
        try {
            doc = await Module2Session_1.Module2Session.findOne({
                user_id: userId,
                created_at: { $gte: today }
            }).sort({ created_at: -1 });
        }
        catch (err) {
            console.warn("[Tracker] DB offline during exportCSV. Checking memory cache.");
        }
        let sessionId = null;
        if (doc) {
            sessionId = doc._id.toString();
        }
        else {
            const userSessions = Object.values(trackerService_1.activeSessions).filter((s) => s.userId === userId && new Date(s.createdAt).getTime() >= today.getTime());
            if (userSessions.length > 0) {
                sessionId = userSessions[userSessions.length - 1].sessionId;
            }
        }
        if (!sessionId) {
            return res.status(404).json({ error: "No active session found for today" });
        }
        const session = await (0, trackerService_1.getSessionData)(sessionId);
        if (!session) {
            return res.status(404).json({ error: "Session data not found" });
        }
        const csvContent = buildCSV(session);
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename=session_${sessionId}.csv`);
        return res.status(200).send(csvContent);
    }
    catch (error) {
        console.error("CSV Export Error:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
};
exports.exportCSV = exportCSV;
/**
 * Builds CSV string from active session data
 */
const buildCSV = (session) => {
    let maxMinutes = 0;
    for (const state of Object.values(session.strikes)) {
        maxMinutes = Math.max(maxMinutes, state.grid.length);
    }
    const headers = [
        "Strike", "Day Open", "Day High", "Day Low", "Trend Badge", "Pct Change",
        "OI Buy (Latest)", "OI Sell (Latest)", "OI High", "OI Low"
    ];
    const firstStrikeKey = Object.keys(session.strikes)[0];
    const firstStrike = firstStrikeKey ? session.strikes[firstStrikeKey] : null;
    for (let m = 0; m < maxMinutes; m++) {
        const timeLabel = firstStrike?.grid[m]?.timestamp || `Min ${m}`;
        headers.push(timeLabel);
    }
    const csvRows = [headers.join(",")];
    for (const strike of session.selectedStrikes) {
        const s = session.strikes[strike];
        if (!s)
            continue;
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
                if (cell.isHigh)
                    val += " (H)";
                if (cell.isLow)
                    val += " (L)";
                row.push(val);
            }
            else {
                row.push("");
            }
        }
        csvRows.push(row.join(","));
    }
    return csvRows.join("\n");
};
