import { z } from "zod";
// Authentication Validation
export const RegisterSchema = z.object({
    username: z.string().min(3, "Username must be at least 3 characters").max(30, "Username must not exceed 30 characters"),
    password: z.string().min(6, "Password must be at least 6 characters"),
    name: z.string().min(2, "Name must be at least 2 characters").optional(),
});
export const LoginSchema = z.object({
    username: z.string().min(1, "Username is required"),
    password: z.string().min(1, "Password is required"),
});
// Module 1 Configuration Validation
export const Module1ConfigSchema = z.object({
    timeframe: z.enum(["1m", "3m", "5m", "custom"]),
    customTimeframeMinutes: z.number().int().min(1).max(60).optional(),
    pivotMethod: z.enum(["classic", "camarilla", "fibonacci"]),
    symbol: z.string().min(1, "Symbol is required"),
});
// Watchlist Validation
export const WatchlistSchema = z.object({
    symbols: z.array(z.string()),
    columnPrefs: z.record(z.boolean()).optional(),
});
// Module 2 Session Start Validation
export const Module2SessionStartSchema = z.object({
    sessionType: z.enum(["CE", "PE", "mixed"]),
    indexSymbol: z.string().min(1, "Index symbol is required"),
    expiryDate: z.string().min(1, "Expiry date is required"),
    selectedStrikes: z.array(z.string()).max(10, "Cannot track more than 10 strikes simultaneously"),
});
// Module 2 Strike Update Validation
export const Module2StrikeUpdateSchema = z.object({
    selectedStrikes: z.array(z.string()).max(10, "Cannot track more than 10 strikes simultaneously"),
});
// Module 2 Dynamic Filters Validation
export const Module2FiltersSchema = z.object({
    sortOrder: z.enum(["high_value", "low_value", "default"]),
    priceAbove: z.number().nullable().optional(),
    priceBelow: z.number().nullable().optional(),
    highlightTop3: z.boolean().default(false),
});
