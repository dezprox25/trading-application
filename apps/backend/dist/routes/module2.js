"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const module2_1 = require("../controllers/module2");
const module2Auth_1 = require("../controllers/module2Auth");
const router = (0, express_1.Router)();
// Same policy as routes/auth.ts — credential endpoints are brute-force targets.
const authRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 15,
    message: { error: "Too many authentication requests. Please try again after 15 minutes." },
    standardHeaders: true,
    legacyHeaders: false,
});
router.get("/status", module2_1.getModule2Status);
router.get("/expiries", module2_1.getModule2Expiries);
// Market Data authentication & session management
router.post("/auth/login", authRateLimiter, module2Auth_1.module2AuthLogin);
router.post("/auth/logout", authRateLimiter, module2Auth_1.module2AuthLogout);
router.get("/auth/status", module2Auth_1.module2AuthStatus);
exports.default = router;
