import { Schema } from "mongoose";

export const FuturesOHLCSchema = new Schema({
  symbol: {
    type: String,
    required: true,
    index: true,
  },
  timeframe: {
    type: String,
    required: true,
    index: true,
  },
  bar_open: {
    type: Number,
    required: true,
  },
  bar_high: {
    type: Number,
    required: true,
  },
  bar_low: {
    type: Number,
    required: true,
  },
  bar_close: {
    type: Number,
    required: true,
  },
  bar_time: {
    type: Date,
    required: true,
    index: true,
  },
  volume: {
    type: Number,
    default: 0,
  },
});

// Index to query the latest candles for pivot calculation
FuturesOHLCSchema.index({ symbol: 1, timeframe: 1, bar_time: -1 });

// TTL index: MongoDB auto-deletes candles older than 25 hours (90000 seconds).
// This ensures previous-day bars are purged automatically without a cron job.
FuturesOHLCSchema.index({ bar_time: 1 }, { expireAfterSeconds: 90000 });
