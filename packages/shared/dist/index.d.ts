export * from "./schemas";
export interface Tick {
    symbol: string;
    ltp: number;
    timestamp: Date;
    volume?: number;
    oi?: number;
}
export interface Candle {
    symbol: string;
    timeframe: string;
    open: number;
    high: number;
    low: number;
    close: number;
    openTime: number;
    volume: number;
}
export interface PivotLevels {
    symbol: string;
    timeframe: string;
    method: "classic" | "camarilla" | "fibonacci";
    pivot: number;
    r1: number;
    r2: number;
    r3: number;
    r4?: number;
    s1: number;
    s2: number;
    s3: number;
    s4?: number;
    computedAt: Date;
}
export type CallIndicatorState = "CALL_BULLISH" | "CALL_NEAR_RESISTANCE" | "CALL_POSITIVE_BIAS" | "CALL_NEUTRAL" | "CALL_BEARISH_BIAS" | "CALL_BEARISH" | "DIVERGENCE_WARNING";
export type PutIndicatorState = "PUT_BULLISH" | "PUT_NEAR_SUPPORT" | "PUT_POSITIVE_BIAS" | "PUT_NEUTRAL" | "PUT_BEARISH_BIAS" | "PUT_BEARISH" | "SENTIMENT_ALERT";
export interface Module1Indicators {
    symbol: string;
    callState: CallIndicatorState;
    putState: PutIndicatorState;
    divergencePct: number;
    hasDivergenceWarning: boolean;
    computedAt: Date;
}
export interface Module2Cell {
    ltp: number;
    minute: number;
    timestamp: string;
    isHigh: boolean;
    isLow: boolean;
    oi?: number;
    oiDelta?: number;
    oiBuy?: number;
    oiSell?: number;
}
export type TrendBadgeState = "H_TO_L" | "L_TO_H" | "FLAT" | "REVERSAL";
export interface Module2StrikeState {
    strike: string;
    dayOpen: number;
    dayHigh: number;
    dayLow: number;
    grid: Module2Cell[];
    trendBadge: TrendBadgeState;
    isDowntrendActive: boolean;
    isDeepLoss: boolean;
    pctChange: number;
    oiLatest?: number;
    oiBuyLatest?: number;
    oiSellLatest?: number;
    oiHigh?: number;
    oiLow?: number;
    oiMean?: number;
}
export interface Module2SessionData {
    sessionId: string;
    userId: string;
    dataSource?: "LIVE_INTERACTIVE_API" | "UNAVAILABLE";
    sessionType: "CE" | "PE" | "mixed";
    indexSymbol: string;
    expiryDate: string;
    selectedStrikes: string[];
    dayOpenPrices: Record<string, number>;
    strikes: Record<string, Module2StrikeState>;
    createdAt: Date;
    futuresOI?: {
        symbol: string;
        oiLatest?: number;
        oiDelta?: number;
        oiBuy?: number;
        oiSell?: number;
        oiHigh?: number;
        oiLow?: number;
    };
}
export interface UserSession {
    id: string;
    username: string;
    name?: string;
    status: "active" | "inactive";
    createdAt: Date;
}
