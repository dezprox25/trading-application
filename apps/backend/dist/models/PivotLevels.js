"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PivotLevels = void 0;
const mongoose_1 = require("mongoose");
const PivotLevelsSchema_1 = require("../schemas/PivotLevelsSchema");
exports.PivotLevels = (0, mongoose_1.model)("PivotLevels", PivotLevelsSchema_1.PivotLevelsSchema);
