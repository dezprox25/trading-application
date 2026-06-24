"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticate = void 0;
const token_1 = require("../utils/token");
const redis_1 = __importDefault(require("../config/redis"));
const authenticate = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({ error: "Access denied. No token provided." });
        }
        const token = authHeader.split(" ")[1];
        // Check if token is blacklisted in Redis (logged-out tokens)
        let isBlacklisted = null;
        try {
            isBlacklisted = await redis_1.default.get(`blacklist:${token}`);
        }
        catch (err) {
            if (process.env.NODE_ENV === "production") {
                throw err;
            }
            console.warn("[Auth Middleware] Failed to check token blacklist in Redis (Redis may be offline). Proceeding without blacklist check.");
        }
        if (isBlacklisted) {
            return res
                .status(401)
                .json({ error: "Session revoked. Please log in again." });
        }
        const decoded = (0, token_1.verifyAccessToken)(token);
        req.user = { id: decoded.userId };
        next();
    }
    catch (error) {
        return res.status(401).json({ error: "Invalid or expired access token." });
    }
};
exports.authenticate = authenticate;
