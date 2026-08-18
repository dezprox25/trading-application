import { Request, Response } from "express";
import { activeSessions } from "../services/trackerService";
import { getModule2DataSource, getModule2MissingInteractiveConfig } from "../services/module2InteractiveDataService";
import { getAetramExpiryDates, searchInstruments } from "../services/aetramMarketDataService";
import { SUPPORTED_INDICES } from "../services/instrumentValidation";

export const getModule2Status = (req: Request, res: Response) => {
  const isConfigured = !!(process.env.MOD2_API_KEY && process.env.MOD2_API_SECRET);
  const dataSource = getModule2DataSource();
  res.json({
    status: isConfigured ? "configured" : "missing_credentials",
    dataSource,
    missingRequirements: dataSource === "UNAVAILABLE" ? getModule2MissingInteractiveConfig() : [],
    activeSessionsCount: Object.keys(activeSessions).length,
  });
};

/**
 * GET /api/module2/indexes
 * Returns all API-supported index symbols dynamically
 */
export const getModule2Indexes = (req: Request, res: Response) => {
  const indexLabels: Record<string, string> = {
    NIFTY50: "NIFTY 50",
    BANKNIFTY: "BANK NIFTY",
    FINNIFTY: "FIN NIFTY",
    MIDCPNIFTY: "MIDCAP NIFTY",
    SENSEX: "SENSEX",
  };

  const indexes = SUPPORTED_INDICES.map((symbol) => ({
    symbol,
    label: indexLabels[symbol] || symbol,
  }));

  res.json({ indexes });
};

/**
 * GET /api/module2/expiries?symbol=NIFTY50
 * Returns available option expiries from Aetram market data API
 */
export const getModule2Expiries = async (req: Request, res: Response) => {
  const symbol = ((req.query.symbol as string) || "NIFTY50").trim().toUpperCase();
  try {
    const expiries = await getAetramExpiryDates(symbol);
    console.log(`[MODULE2][CONFIG] Expiries query for ${symbol}: returned ${expiries.length} dates`);
    res.json({ symbol, expiries });
  } catch (error: any) {
    console.error(`[MODULE2][CONFIG] Expiries error for ${symbol}:`, error?.message || error);
    res.json({ symbol, expiries: [] });
  }
};

const parseDateToYMD = (val: string | Date | number): string => {
  const d = new Date(val);
  if (isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

/**
 * GET /api/module2/option-chain?symbol=NIFTY50&expiry=2026-08-18
 * Returns available strikes and CE/PE contract availability directly from Aetram API
 */
export const getModule2OptionChain = async (req: Request, res: Response) => {
  const symbol = ((req.query.symbol as string) || "NIFTY50").trim().toUpperCase();
  const expiry = ((req.query.expiry as string) || "").trim();

  if (!expiry) {
    return res.json({ symbol, expiry: "", strikes: [] });
  }

  try {
    const searchName = symbol.replace(/50$/i, "").replace(/FIFTY$/i, "").toUpperCase();
    console.log(`[MODULE2][CONFIG] Option chain request: symbol=${symbol} searchName=${searchName} expiry=${expiry}`);
    
    const results = await searchInstruments(searchName);
    const targetYmd = parseDateToYMD(expiry);

    const strikeMap = new Map<number, { strikePrice: number; CE?: string; PE?: string }>();

    for (const inst of results) {
      const rawExpiry = inst.expiryDate || "";
      const instYmd = parseDateToYMD(rawExpiry);
      if (targetYmd && instYmd !== targetYmd) continue;

      const strike = inst.strikePrice !== undefined ? Math.round(Number(inst.strikePrice)) : 0;
      if (!strike) continue;

      const optType = String(inst.optionType || "").toUpperCase();
      const isCE = optType === "3" || optType.includes("CE") || optType.includes("CALL");
      const isPE = optType === "4" || optType.includes("PE") || optType.includes("PUT");

      if (!strikeMap.has(strike)) {
        strikeMap.set(strike, { strikePrice: strike });
      }
      const entry = strikeMap.get(strike)!;

      const indexPrefix = symbol.replace(/50$/i, "").toUpperCase();
      if (isCE) {
        entry.CE = `${indexPrefix}${strike}CE`;
      } else if (isPE) {
        entry.PE = `${indexPrefix}${strike}PE`;
      }
    }

    const strikes = Array.from(strikeMap.values()).sort((a, b) => a.strikePrice - b.strikePrice);
    
    let ceCount = 0;
    let peCount = 0;
    strikes.forEach((s) => {
      if (s.CE) ceCount++;
      if (s.PE) peCount++;
    });

    console.log(
      `[MODULE2][CONFIG] Contracts received: ${results.length} | Available strikes: ${strikes.length} | CE: ${ceCount} | PE: ${peCount}`
    );

    res.json({ symbol, expiry: targetYmd, strikes });
  } catch (err: any) {
    console.error(`[MODULE2][CONFIG] Option chain error:`, err?.message || err);
    res.status(500).json({ error: "Unable to load market data. Please try again." });
  }
};
