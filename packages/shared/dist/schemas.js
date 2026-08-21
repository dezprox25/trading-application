"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Module2FiltersSchema = exports.Module2StrikeUpdateSchema = exports.Module2SessionStartSchema = exports.SelectedStrikesSchema = exports.isPutStrike = exports.isCallStrike = exports.WatchlistSchema = exports.Module1ConfigSchema = exports.LoginSchema = exports.RegisterSchema = void 0;
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
// Helper to classify CE and PE strikes
const isCallStrike = (symbol) => symbol.toUpperCase().endsWith("CE");
exports.isCallStrike = isCallStrike;
const isPutStrike = (symbol) => symbol.toUpperCase().endsWith("PE");
exports.isPutStrike = isPutStrike;
// Module 2 Selected Strikes Validation Rule: max 10 CE, max 10 PE, max 20 total
exports.SelectedStrikesSchema = zod_1.z
    .array(zod_1.z.string())
    .superRefine((strikes, ctx) => {
    if (strikes.length > 20) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            message: "Cannot select more than 20 option contracts total",
        });
    }
    const ceCount = strikes.filter(exports.isCallStrike).length;
    const peCount = strikes.filter(exports.isPutStrike).length;
    if (ceCount > 10) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            message: "Cannot select more than 10 Call (CE) strikes",
        });
    }
    if (peCount > 10) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            message: "Cannot select more than 10 Put (PE) strikes",
        });
    }
});
// Module 2 Session Start Validation
exports.Module2SessionStartSchema = zod_1.z.object({
    sessionType: zod_1.z.enum(["CE", "PE", "mixed"]),
    indexSymbol: zod_1.z.string().min(1, "Index symbol is required"),
    expiryDate: zod_1.z.string().min(1, "Expiry date is required"),
    selectedStrikes: exports.SelectedStrikesSchema,
});
// Module 2 Strike Update Validation
exports.Module2StrikeUpdateSchema = zod_1.z.object({
    selectedStrikes: exports.SelectedStrikesSchema,
});
// Module 2 Dynamic Filters Validation
exports.Module2FiltersSchema = zod_1.z.object({
    sortOrder: zod_1.z.enum(["high_value", "low_value", "default"]),
    priceAbove: zod_1.z.number().nullable().optional(),
    priceBelow: zod_1.z.number().nullable().optional(),
    highlightTop3: zod_1.z.boolean().default(false),
});
