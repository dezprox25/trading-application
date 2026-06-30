import { Router } from "express";
import { getModule2Status, getModule2Expiries } from "../controllers/module2";

const router = Router();

router.get("/status", getModule2Status);
router.get("/expiries", getModule2Expiries);

export default router;
