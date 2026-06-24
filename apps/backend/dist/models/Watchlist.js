"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Watchlist = void 0;
const mongoose_1 = require("mongoose");
const WatchlistSchema_1 = require("../schemas/WatchlistSchema");
exports.Watchlist = (0, mongoose_1.model)("Watchlist", WatchlistSchema_1.WatchlistSchema);
