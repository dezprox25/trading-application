"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getModule2Status = void 0;
const trackerService_1 = require("../services/trackerService");
const module2InteractiveDataService_1 = require("../services/module2InteractiveDataService");
/**
 * Returns Module 2 configuration status and session count (safe, no secrets exposed)
 */
const getModule2Status = (req, res) => {
    const isConfigured = !!(process.env.MOD2_API_KEY && process.env.MOD2_API_SECRET);
    const dataSource = (0, module2InteractiveDataService_1.getModule2DataSource)();
    res.json({
        status: isConfigured ? "configured" : "missing_credentials",
        dataSource,
        missingRequirements: dataSource === "UNAVAILABLE" ? (0, module2InteractiveDataService_1.getModule2MissingInteractiveConfig)() : [],
        activeSessionsCount: Object.keys(trackerService_1.activeSessions).length,
    });
};
exports.getModule2Status = getModule2Status;
