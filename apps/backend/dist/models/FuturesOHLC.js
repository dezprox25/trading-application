"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FuturesOHLC = void 0;
const mongoose_1 = require("mongoose");
const FuturesOHLCSchema_1 = require("../schemas/FuturesOHLCSchema");
exports.FuturesOHLC = (0, mongoose_1.model)("FuturesOHLC", FuturesOHLCSchema_1.FuturesOHLCSchema);
