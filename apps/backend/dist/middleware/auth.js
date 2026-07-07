"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticate = exports.markTokenRevoked = void 0;
const token_1 = require("../utils/token");
const redis_1 = __importDefault(require("../config/redis"));
// ── In-memory blacklist cache ─────────────────────────────────────────────────
// The old middleware issued one Redis GET per authenticated request — thousands
// of commands/day spent re-asking the same answer for the same token. This is a
// single-instance deployment: logout happens in THIS process, so the local map
// is authoritative for tokens revoked during this process's lifetime. Redis is
// consulted at most ONCE per unique token per process (covers tokens revoked
// before a restart); the durable blacklist:<token> SETEX in logout is unchanged.
const revokedTokens = new Map(); // token → revoked-until (ms)
const clearedTokens = new Set(); // tokens confirmed not blacklisted
const REVOKED_CACHE_MAX_MS = 24 * 60 * 60 * 1000;
const pruneCaches = () => {
    if (revokedTokens.size > 1000) {
        const now = Date.now();
        for (const [t, exp] of revokedTokens) {
            if (exp <= now)
                revokedTokens.delete(t);
        }
    }
    // Bounded negative cache — worst case a cleared token is re-verified once.
    if (clearedTokens.size > 5000)
        clearedTokens.clear();
};
/** Called by the logout controller so revocation takes effect in-process
 *  immediately, without any per-request Redis reads. */
const markTokenRevoked = (token, ttlSeconds) => {
    revokedTokens.set(token, Date.now() + Math.min(ttlSeconds * 1000, REVOKED_CACHE_MAX_MS));
    clearedTokens.delete(token);
    pruneCaches();
};
exports.markTokenRevoked = markTokenRevoked;
const authenticate = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({ error: "Access denied. No token provided." });
        }
        const token = authHeader.split(" ")[1];
        // 1. Local revocation cache (no Redis command)
        const revokedUntil = revokedTokens.get(token);
        if (revokedUntil !== undefined) {
            if (Date.now() < revokedUntil) {
                return res.status(401).json({ error: "Session revoked. Please log in again." });
            }
            revokedTokens.delete(token);
        }
        // 2. First sighting of this token in this process: one durable-blacklist
        //    check against Redis, then cache the verdict either way.
        if (!clearedTokens.has(token)) {
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
                revokedTokens.set(token, Date.now() + REVOKED_CACHE_MAX_MS);
                return res.status(401).json({ error: "Session revoked. Please log in again." });
            }
            clearedTokens.add(token);
            pruneCaches();
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
