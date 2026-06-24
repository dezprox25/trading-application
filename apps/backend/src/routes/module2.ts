import { Router } from "express";
import { getModule2Status } from "../controllers/module2";

const router = Router();

// Endpoint to check configuration status and session statistics
router.get("/status", getModule2Status);

export default router;
