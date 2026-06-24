"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Module2StrikeTick = void 0;
const mongoose_1 = require("mongoose");
const Module2StrikeTickSchema_1 = require("../schemas/Module2StrikeTickSchema");
exports.Module2StrikeTick = (0, mongoose_1.model)("Module2StrikeTick", Module2StrikeTickSchema_1.Module2StrikeTickSchema);
