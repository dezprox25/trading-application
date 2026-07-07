import { Router } from "express";
import rateLimit from "express-rate-limit";
import { getModule2Status, getModule2Expiries } from "../controllers/module2";
import { module2AuthLogin, module2AuthLogout, module2AuthStatus } from "../controllers/module2Auth";

const router = Router();

// Same policy as routes/auth.ts — credential endpoints are brute-force targets.
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { error: "Too many authentication requests. Please try again after 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

router.get("/status", getModule2Status);
router.get("/expiries", getModule2Expiries);

// Market Data authentication & session management
router.post("/auth/login",  authRateLimiter, module2AuthLogin);
router.post("/auth/logout", authRateLimiter, module2AuthLogout);
router.get("/auth/status",  module2AuthStatus);

export default router;
