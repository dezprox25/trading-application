import { z } from "zod";
export declare const RegisterSchema: z.ZodObject<{
    username: z.ZodString;
    password: z.ZodString;
    name: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    username: string;
    password: string;
    name?: string | undefined;
}, {
    username: string;
    password: string;
    name?: string | undefined;
}>;
export declare const LoginSchema: z.ZodObject<{
    username: z.ZodString;
    password: z.ZodString;
}, "strip", z.ZodTypeAny, {
    username: string;
    password: string;
}, {
    username: string;
    password: string;
}>;
export declare const Module1ConfigSchema: z.ZodObject<{
    timeframe: z.ZodEnum<["1m", "3m", "5m", "custom"]>;
    customTimeframeMinutes: z.ZodOptional<z.ZodNumber>;
    pivotMethod: z.ZodEnum<["classic", "camarilla", "fibonacci"]>;
    symbol: z.ZodString;
}, "strip", z.ZodTypeAny, {
    symbol: string;
    timeframe: "custom" | "1m" | "3m" | "5m";
    pivotMethod: "classic" | "camarilla" | "fibonacci";
    customTimeframeMinutes?: number | undefined;
}, {
    symbol: string;
    timeframe: "custom" | "1m" | "3m" | "5m";
    pivotMethod: "classic" | "camarilla" | "fibonacci";
    customTimeframeMinutes?: number | undefined;
}>;
export declare const WatchlistSchema: z.ZodObject<{
    symbols: z.ZodArray<z.ZodString, "many">;
    columnPrefs: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
}, "strip", z.ZodTypeAny, {
    symbols: string[];
    columnPrefs?: Record<string, boolean> | undefined;
}, {
    symbols: string[];
    columnPrefs?: Record<string, boolean> | undefined;
}>;
export declare const Module2SessionStartSchema: z.ZodObject<{
    sessionType: z.ZodEnum<["CE", "PE", "mixed"]>;
    indexSymbol: z.ZodString;
    expiryDate: z.ZodString;
    selectedStrikes: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    sessionType: "CE" | "PE" | "mixed";
    indexSymbol: string;
    expiryDate: string;
    selectedStrikes: string[];
}, {
    sessionType: "CE" | "PE" | "mixed";
    indexSymbol: string;
    expiryDate: string;
    selectedStrikes: string[];
}>;
export declare const Module2StrikeUpdateSchema: z.ZodObject<{
    selectedStrikes: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    selectedStrikes: string[];
}, {
    selectedStrikes: string[];
}>;
export declare const Module2FiltersSchema: z.ZodObject<{
    sortOrder: z.ZodEnum<["high_value", "low_value", "default"]>;
    priceAbove: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    priceBelow: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    highlightTop3: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    sortOrder: "high_value" | "low_value" | "default";
    highlightTop3: boolean;
    priceAbove?: number | null | undefined;
    priceBelow?: number | null | undefined;
}, {
    sortOrder: "high_value" | "low_value" | "default";
    priceAbove?: number | null | undefined;
    priceBelow?: number | null | undefined;
    highlightTop3?: boolean | undefined;
}>;
export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type Module1ConfigInput = z.infer<typeof Module1ConfigSchema>;
export type WatchlistInput = z.infer<typeof WatchlistSchema>;
export type Module2SessionStartInput = z.infer<typeof Module2SessionStartSchema>;
export type Module2StrikeUpdateInput = z.infer<typeof Module2StrikeUpdateSchema>;
export type Module2FiltersInput = z.infer<typeof Module2FiltersSchema>;
