"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpotTicks = void 0;
const mongoose_1 = require("mongoose");
const SpotTicksSchema_1 = require("../schemas/SpotTicksSchema");
exports.SpotTicks = (0, mongoose_1.model)("SpotTicks", SpotTicksSchema_1.SpotTicksSchema);
