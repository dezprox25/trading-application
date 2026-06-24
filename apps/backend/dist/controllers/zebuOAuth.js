"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getZebuOAuthStatusEndpoint = exports.zebuOAuthCallback = void 0;
const zebuOAuthService_1 = require("../services/zebuOAuthService");
const zebuOAuthCallback = (req, res) => {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    if (!code) {
        return res.status(400).json({ error: "Missing OAuth code in callback." });
    }
    (0, zebuOAuthService_1.setZebuAuthCode)(code);
    return res.status(200).json({
        message: "Zebu OAuth code received. Restart the Module1 data feed/backend to exchange it for a live session token.",
    });
};
exports.zebuOAuthCallback = zebuOAuthCallback;
const getZebuOAuthStatusEndpoint = (_req, res) => {
    return res.status(200).json((0, zebuOAuthService_1.getZebuOAuthStatus)());
};
exports.getZebuOAuthStatusEndpoint = getZebuOAuthStatusEndpoint;
