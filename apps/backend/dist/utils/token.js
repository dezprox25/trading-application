"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.JWT_REFRESH_SECRET = exports.JWT_SECRET = exports.verifyRefreshToken = exports.verifyAccessToken = exports.generateRefreshToken = exports.generateAccessToken = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const INSECURE_PLACEHOLDERS = [
    "your_jwt_secret_here",
    "your_jwt_refresh_secret_here",
    "supersecretjwtkeyforstockdashboardintraday2026",
    "anotherrefreshsecretjwtkeyforstockdashboardintraday2026",
];
const isInsecure = (v) => !v || INSECURE_PLACEHOLDERS.includes(v);
const resolveSecret = (envKey, label) => {
    const val = process.env[envKey];
    if (!isInsecure(val))
        return val;
    if (process.env.NODE_ENV === "production") {
        // startupCheck.ts exits before we reach here in production, but be defensive.
        throw new Error(`[Auth] FATAL: ${label} (${envKey}) is not set or uses an insecure default in production.`);
    }
    // Development fallback — predictable so tokens survive restarts during dev.
    console.warn(`[Auth] ${envKey} not configured — using development fallback. Set a real value in .env before going to production.`);
    return `dev-only-${envKey.toLowerCase()}-not-for-production`;
};
const JWT_SECRET = resolveSecret("JWT_SECRET", "JWT access token secret");
exports.JWT_SECRET = JWT_SECRET;
const JWT_REFRESH_SECRET = resolveSecret("JWT_REFRESH_SECRET", "JWT refresh token secret");
exports.JWT_REFRESH_SECRET = JWT_REFRESH_SECRET;
const generateAccessToken = (userId) => jsonwebtoken_1.default.sign({ userId }, JWT_SECRET, { expiresIn: "8h" });
exports.generateAccessToken = generateAccessToken;
const generateRefreshToken = (userId) => jsonwebtoken_1.default.sign({ userId }, JWT_REFRESH_SECRET, { expiresIn: "7d" });
exports.generateRefreshToken = generateRefreshToken;
const verifyAccessToken = (token) => jsonwebtoken_1.default.verify(token, JWT_SECRET);
exports.verifyAccessToken = verifyAccessToken;
const verifyRefreshToken = (token) => jsonwebtoken_1.default.verify(token, JWT_REFRESH_SECRET);
exports.verifyRefreshToken = verifyRefreshToken;
