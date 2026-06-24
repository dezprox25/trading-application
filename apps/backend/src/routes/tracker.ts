import { Router } from "express";
import { authenticate } from "../middleware/auth";
import {
  startSession,
  getCurrentSession,
  updateStrikes,
  updateFilters,
  exportCSV
} from "../controllers/tracker";

const router = Router();

router.post("/session/start", authenticate, startSession);
router.get("/session/current", authenticate, getCurrentSession);
router.put("/session/strikes", authenticate, updateStrikes);
router.put("/filters", authenticate, updateFilters);
router.get("/export", authenticate, exportCSV);

export default router;
