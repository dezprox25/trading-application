"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const auth_1 = require("../controllers/auth");
const brokerAuth_1 = require("../controllers/brokerAuth");
const auth_2 = require("../middleware/auth");
const router = (0, express_1.Router)();
const authRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 15,
    message: { error: "Too many authentication requests. Please try again after 15 minutes." },
    standardHeaders: true,
    legacyHeaders: false,
});
// Application auth
router.post("/register", authRateLimiter, auth_1.register);
router.post("/login", authRateLimiter, auth_1.login);
router.post("/refresh", auth_1.refresh);
router.post("/logout", auth_2.authenticate, auth_1.logout);
router.get("/me", auth_2.authenticate, auth_1.me);
// Broker auth — standalone (no app JWT required, rate-limited)
router.post("/module1-broker-login", authRateLimiter, brokerAuth_1.module1BrokerLogin);
router.post("/module2-broker-login", authRateLimiter, brokerAuth_1.module2BrokerLogin);
exports.default = router;
