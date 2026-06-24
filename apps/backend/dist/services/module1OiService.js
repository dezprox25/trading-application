"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initModule1OiService = exports.getLatestModule1OiMetrics = exports.ingestModule1OiTick = exports.setModule1OiDataSource = void 0;
const redis_1 = __importDefault(require("../config/redis"));
const PUT_INVERSE = {
    STRONG_BULL: "STRONG_BEAR",
    MILD_BULL: "MILD_BEAR",
    NEUTRAL: "NEUTRAL",
    MILD_BEAR: "MILD_BULL",
    STRONG_BEAR: "STRONG_BULL",
    DIVERGENCE: "DIVERGENCE",
};
const ceOiBySymbol = new Map();
const peOiBySymbol = new Map();
const rows = [];
const futuresOiRows = [];
let latestFuturesOi = 0;
let latestSecondBucket = "";
let latestRow = null;
let activeDataSource = "SIMULATOR";
const setModule1OiDataSource = (dataSource) => {
    activeDataSource = dataSource;
    if (latestRow)
        latestRow.dataSource = dataSource;
};
exports.setModule1OiDataSource = setModule1OiDataSource;
const toIstTimestamp = (date) => {
    const ist = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
    return `${ist.toISOString().slice(0, 19)}+05:30`;
};
const sumValues = (map) => Array.from(map.values()).reduce((sum, value) => sum + value, 0);
const avg = (values) => values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
const getCallSignal = (row) => {
    const threshold = 500;
    if (row.c_buy > threshold && row.f_buy > 0 && row.p_sell < 0)
        return "STRONG_BULL";
    if (row.c_buy > 0 && row.p_sell < 0)
        return "MILD_BULL";
    if (row.c_sell < -threshold && row.f_sell < 0 && row.p_buy > 0)
        return "STRONG_BEAR";
    if (row.c_sell < 0 && row.p_buy > 0)
        return "MILD_BEAR";
    if ((row.c_buy > 0 && row.f_sell < 0) || (row.c_sell < 0 && row.f_buy > 0))
        return "DIVERGENCE";
    return "NEUTRAL";
};
const createOrUpdateLatestRow = (timestamp) => {
    const secondBucket = timestamp.toISOString().slice(0, 19);
    const isNewRow = latestSecondBucket !== secondBucket;
    const previous = isNewRow ? rows[rows.length - 1] || null : rows[rows.length - 2] || null;
    const previousFuturesOi = isNewRow
        ? futuresOiRows[futuresOiRows.length - 1] || 0
        : futuresOiRows[futuresOiRows.length - 2] || 0;
    if (isNewRow) {
        latestSecondBucket = secondBucket;
        latestRow = null;
    }
    const cTl = Math.round(sumValues(ceOiBySymbol));
    const pTl = Math.round(sumValues(peOiBySymbol));
    const fOi = Math.round(latestFuturesOi);
    const cDelta = previous ? cTl - previous.c_tl : cTl;
    const pDelta = previous ? pTl - previous.p_tl : pTl;
    const fDelta = previousFuturesOi ? fOi - previousFuturesOi : fOi;
    const rowsForSeries = isNewRow ? rows : rows.slice(0, -1);
    const cSeries = [...rowsForSeries.map((row) => row.c_tl), cTl];
    const pSeries = [...rowsForSeries.map((row) => row.p_tl), pTl];
    const baseRow = {
        timestamp: toIstTimestamp(timestamp),
        dataSource: activeDataSource,
        tin: latestRow?.tin ?? (previous ? previous.tin + 1 : 18),
        c_tl: cTl,
        c_mn: Math.round(avg(cSeries)),
        c_hig: Math.max(...cSeries),
        c_low: Math.min(...cSeries),
        c_buy: Math.max(cDelta, 0),
        c_sell: Math.min(cDelta, 0),
        f_buy: Math.max(fDelta, 0),
        f_sell: Math.min(fDelta, 0),
        p_tl: pTl,
        p_mn: Math.round(avg(pSeries)),
        p_hig: Math.max(...pSeries),
        p_low: Math.min(...pSeries),
        p_buy: Math.max(pDelta, 0),
        p_sell: Math.min(pDelta, 0),
        callSignal: "NEUTRAL",
        putSignal: "NEUTRAL",
    };
    baseRow.callSignal = getCallSignal(baseRow);
    baseRow.putSignal = PUT_INVERSE[baseRow.callSignal];
    if (isNewRow || rows.length === 0) {
        rows.push(baseRow);
        futuresOiRows.push(fOi);
        if (rows.length > 240) {
            rows.shift();
            futuresOiRows.shift();
        }
    }
    else {
        rows[rows.length - 1] = baseRow;
        futuresOiRows[futuresOiRows.length - 1] = fOi;
    }
    latestRow = baseRow;
};
// MARKET DATA API is the intended real source for option-chain OI and futures OI.
// For now this consumes existing backend live/simulator ticks only; no Interactive Data API,
// frontend secrets, order placement, order modification, or cancellation is involved.
const ingestModule1OiTick = (tick) => {
    if (tick.oi === undefined || Number.isNaN(tick.oi))
        return;
    if (tick.symbol.endsWith("CE") || /C\d+$/.test(tick.symbol)) {
        ceOiBySymbol.set(tick.symbol, tick.oi);
    }
    else if (tick.symbol.endsWith("PE") || /P\d+$/.test(tick.symbol)) {
        peOiBySymbol.set(tick.symbol, tick.oi);
    }
    else if (tick.symbol.endsWith("-FUT") || tick.symbol.includes("FUT")) {
        latestFuturesOi = tick.oi;
    }
    else {
        return;
    }
    createOrUpdateLatestRow(tick.timestamp || new Date());
};
exports.ingestModule1OiTick = ingestModule1OiTick;
const getLatestModule1OiMetrics = () => {
    if (latestRow)
        return latestRow;
    createOrUpdateLatestRow(new Date());
    return latestRow;
};
exports.getLatestModule1OiMetrics = getLatestModule1OiMetrics;
/**
 * Warm up the in-memory CE/PE/Futures maps using last cached values in Redis
 */
const initModule1OiService = async () => {
    try {
        const keys = await redis_1.default.keys("oi:*");
        for (const key of keys) {
            const val = await redis_1.default.get(key);
            if (val) {
                const symbol = key.replace("oi:", "");
                const oi = parseInt(val);
                if (!isNaN(oi)) {
                    if (symbol.endsWith("CE") || /C\d+$/.test(symbol)) {
                        ceOiBySymbol.set(symbol, oi);
                    }
                    else if (symbol.endsWith("PE") || /P\d+$/.test(symbol)) {
                        peOiBySymbol.set(symbol, oi);
                    }
                    else if (symbol.endsWith("-FUT") || symbol.includes("FUT")) {
                        latestFuturesOi = oi;
                    }
                }
            }
        }
        console.log(`[Module1OiService] Loaded ${ceOiBySymbol.size} CE and ${peOiBySymbol.size} PE options from Redis cache on start.`);
        createOrUpdateLatestRow(new Date());
    }
    catch (err) {
        console.warn("[Module1OiService] Redis warmup warning:", err);
    }
};
exports.initModule1OiService = initModule1OiService;
