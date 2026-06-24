"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Module2FiltersSchema = exports.Module2StrikeUpdateSchema = exports.Module2SessionStartSchema = exports.WatchlistSchema = exports.Module1ConfigSchema = exports.LoginSchema = exports.RegisterSchema = void 0;
const zod_1 = require("zod");
// Authentication Validation
exports.RegisterSchema = zod_1.z.object({
    username: zod_1.z.string().min(3, "Username must be at least 3 characters").max(30, "Username must not exceed 30 characters"),
    password: zod_1.z.string().min(6, "Password must be at least 6 characters"),
    name: zod_1.z.string().min(2, "Name must be at least 2 characters").optional(),
});
exports.LoginSchema = zod_1.z.object({
    username: zod_1.z.string().min(1, "Username is required"),
    password: zod_1.z.string().min(1, "Password is required"),
});
// Module 1 Configuration Validation
exports.Module1ConfigSchema = zod_1.z.object({
    timeframe: zod_1.z.enum(["1m", "3m", "5m", "custom"]),
    customTimeframeMinutes: zod_1.z.number().int().min(1).max(60).optional(),
    pivotMethod: zod_1.z.enum(["classic", "camarilla", "fibonacci"]),
    symbol: zod_1.z.string().min(1, "Symbol is required"),
});
// Watchlist Validation
exports.WatchlistSchema = zod_1.z.object({
    symbols: zod_1.z.array(zod_1.z.string()),
    columnPrefs: zod_1.z.record(zod_1.z.boolean()).optional(),
});
// Module 2 Session Start Validation
exports.Module2SessionStartSchema = zod_1.z.object({
    sessionType: zod_1.z.enum(["CE", "PE", "mixed"]),
    indexSymbol: zod_1.z.string().min(1, "Index symbol is required"),
    expiryDate: zod_1.z.string().min(1, "Expiry date is required"),
    selectedStrikes: zod_1.z.array(zod_1.z.string()).max(10, "Cannot track more than 10 strikes simultaneously"),
});
// Module 2 Strike Update Validation
exports.Module2StrikeUpdateSchema = zod_1.z.object({
    selectedStrikes: zod_1.z.array(zod_1.z.string()).max(10, "Cannot track more than 10 strikes simultaneously"),
});
// Module 2 Dynamic Filters Validation
exports.Module2FiltersSchema = zod_1.z.object({
    sortOrder: zod_1.z.enum(["high_value", "low_value", "default"]),
    priceAbove: zod_1.z.number().nullable().optional(),
    priceBelow: zod_1.z.number().nullable().optional(),
    highlightTop3: zod_1.z.boolean().default(false),
});
