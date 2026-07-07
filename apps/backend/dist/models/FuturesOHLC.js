"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureUniqueCandleIndex = exports.FuturesOHLC = void 0;
const mongoose_1 = require("mongoose");
const FuturesOHLCSchema_1 = require("../schemas/FuturesOHLCSchema");
exports.FuturesOHLC = (0, mongoose_1.model)("FuturesOHLC", FuturesOHLCSchema_1.FuturesOHLCSchema);
/**
 * One-time startup migration for the unique candle index:
 * 1. Deletes any duplicate (symbol, timeframe, bar_time) documents left behind
 *    by the old non-unique index, keeping the most recently written one (it
 *    holds the final finalized bar values).
 * 2. Syncs schema indexes so the unique compound index is actually built and
 *    the old non-unique / conflicting indexes are dropped.
 * Must run after MongoDB connects and before live ticks start persisting.
 */
const ensureUniqueCandleIndex = async () => {
    const dupes = await exports.FuturesOHLC.aggregate([
        {
            $group: {
                _id: { symbol: "$symbol", timeframe: "$timeframe", bar_time: "$bar_time" },
                ids: { $push: "$_id" },
                count: { $sum: 1 },
            },
        },
        { $match: { count: { $gt: 1 } } },
    ]);
    for (const d of dupes) {
        // ObjectIds sort chronologically as hex strings — keep the newest.
        const stale = d.ids
            .map(String)
            .sort()
            .slice(0, -1);
        await exports.FuturesOHLC.deleteMany({ _id: { $in: stale } });
    }
    if (dupes.length > 0) {
        console.log(`[OHLC] Removed duplicate candles for ${dupes.length} (symbol, timeframe, bar_time) key(s).`);
    }
    await exports.FuturesOHLC.syncIndexes();
    console.log("[OHLC] Unique candle index (symbol, timeframe, bar_time) ensured.");
};
exports.ensureUniqueCandleIndex = ensureUniqueCandleIndex;
