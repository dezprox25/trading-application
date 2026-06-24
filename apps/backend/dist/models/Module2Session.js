"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Module2Session = void 0;
const mongoose_1 = require("mongoose");
const Module2SessionSchema_1 = require("../schemas/Module2SessionSchema");
exports.Module2Session = (0, mongoose_1.model)("Module2Session", Module2SessionSchema_1.Module2SessionSchema);
