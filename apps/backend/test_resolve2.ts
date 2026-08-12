import * as dotenv from "dotenv";
dotenv.config();

import { loginToAetram } from "./src/services/aetramMarketDataService";
import { getMarketDataToken } from "./src/services/marketDataSessionService";
import axios from "axios";

async function test() {
  await loginToAetram();
  const token = getMarketDataToken();
  const baseUrl = process.env.AETRAM_MARKETDATA_API_BASE_URL;

  console.log("\n--- PHASE 2: DEBUG LOGGING & PHASE 3: ACTUAL AETRAM SEARCH RESPONSE ---");

  async function trySearch(q: string) {
    const searchUrl = `${baseUrl}/search/instruments?searchString=${encodeURIComponent(q)}`;
    const response = await axios.get(searchUrl, {
      headers: { "Content-Type": "application/json", "authorization": token },
      timeout: 10000
    });
    
    console.log(`\n[MODULE2][INSTRUMENT] AETRAM search request:`);
    console.log(`[MODULE2][INSTRUMENT] Search URL: ${searchUrl}`);
    console.log(`[MODULE2][INSTRUMENT] Search String: '${q}'`);
    
    if (response.data.type === 'success') {
      const results = response.data.result || [];
      console.log(`[MODULE2][INSTRUMENT] Search result count: ${results.length}`);
      if (results.length > 0) {
        // Log the first result exactly as returned by Aetram
        console.log(`[MODULE2][INSTRUMENT] First result RAW (showing full structure):`, JSON.stringify(results[0], null, 2));
      }
    } else {
      console.log(`[MODULE2][INSTRUMENT] Search failed/empty:`, response.data.description);
    }
  }

  console.log(`[MODULE2][INSTRUMENT] Fetching entire NIFTY universe...`);
  const searchUrl = `${baseUrl}/search/instruments?searchString=NIFTY`;
  const response = await axios.get(searchUrl, {
    headers: { "Content-Type": "application/json", "authorization": token },
    timeout: 10000
  });

  const results = response.data.result || [];
  console.log(`[MODULE2][INSTRUMENT] Total results: ${results.length}`);

  const uniqueExpiries = new Set<string>();
  const uniqueOptionTypes = new Set<string>();
  const uniqueStrikes = new Set<number>();
  const ceExpiries = new Set<string>();

  for (const inst of results) {
    const expiry = inst.ContractExpiration || inst.contractExpiration || inst.ExpiryDate || inst.expiryDate || inst.Expiry || inst.expiry || "";
    const expiryDateObj = new Date(expiry);
    const instExpiryYmd = isNaN(expiryDateObj.getTime()) ? "" : expiryDateObj.toISOString().slice(0, 10);
    if (instExpiryYmd) uniqueExpiries.add(instExpiryYmd);

    const optType = String(inst.OptionType || inst.optionType || inst.Type || inst.type || "");
    if (optType) uniqueOptionTypes.add(optType);

    if (optType === "3" && instExpiryYmd) {
      ceExpiries.add(instExpiryYmd);
    }

    const instStrike = Math.round(Number(inst.StrikePrice !== undefined ? inst.StrikePrice : inst.strikePrice !== undefined ? inst.strikePrice : inst.Strike !== undefined ? inst.Strike : inst.strike !== undefined ? inst.strike : 0));
    if (instStrike > 0) uniqueStrikes.add(instStrike);
  }

  console.log(`[MODULE2][INSTRUMENT] Unique OptionTypes:`, Array.from(uniqueOptionTypes));
  console.log(`[MODULE2][INSTRUMENT] Unique Expiries (first 10):`, Array.from(uniqueExpiries).sort().slice(0, 10));
  console.log(`[MODULE2][INSTRUMENT] CE Expiries (first 10):`, Array.from(ceExpiries).sort().slice(0, 10));
  console.log(`[MODULE2][INSTRUMENT] Unique Strikes (sample):`, Array.from(uniqueStrikes).sort((a,b)=>a-b).slice(0, 10));

  console.log("\n[MODULE2][INSTRUMENT] Testing getAetramExpiryDates for NIFTY50:");
  const { getAetramExpiryDates, resolveOptionStrikeToken } = require("./src/services/aetramMarketDataService");
  const expiries = await getAetramExpiryDates("NIFTY50");
  console.log(`[MODULE2][INSTRUMENT] Expiries returned:`, expiries);

  if (expiries && expiries.length > 0) {
    console.log(`\n[MODULE2][INSTRUMENT] Testing resolveOptionStrikeToken for NIFTY with first expiry (${expiries[0]}):`);
    
    // Find the first valid option from our earlier sample that has OptionType=3 and Name=NIFTY
    const validNifty = results.find((i: any) => i.Name === "NIFTY" && String(i.OptionType || i.optionType) === "3");
    if (validNifty) {
      const strike = `NIFTY${validNifty.StrikePrice}CE`;
      const exp = validNifty.ContractExpiration.slice(0, 10);
      console.log(`[MODULE2][INSTRUMENT] Using known valid NIFTY option: ${strike} for ${exp}`);
      const res = await resolveOptionStrikeToken(strike, "NIFTY50", exp);
      console.log(`[MODULE2][INSTRUMENT] Resolver result for ${strike}:`, res);
    }
  }
  
  process.exit(0);
}

test();
