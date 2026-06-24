"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.User = void 0;
const mongoose_1 = require("mongoose");
const UserSchema_1 = require("../schemas/UserSchema");
exports.User = (0, mongoose_1.model)("User", UserSchema_1.UserSchema);
