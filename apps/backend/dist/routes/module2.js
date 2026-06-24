"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const module2_1 = require("../controllers/module2");
const router = (0, express_1.Router)();
// Endpoint to check configuration status and session statistics
router.get("/status", module2_1.getModule2Status);
exports.default = router;
