import { describe, it, expect, afterAll } from "vitest";
import * as XLSX from "xlsx";
import * as fs from "fs";
import type { DashboardRow } from "../../calc";
import { buildModule1Workbook, exportModule1Excel, istDateStr } from "./excelExport";

const bar = (o: number, h: number, l: number, c: number, t: number) => ({ t, o, h, l, c });

function mkRow(t: number, i: number): DashboardRow {
  return {
    t,
    call: bar(10 + i, 12 + i, 9 + i, 11 + i, t),
    put: bar(8 + i, 9 + i, 7 + i, 8.5 + i, t),
    future: bar(22000 + i, 22050 + i, 21950 + i, 22010 + i, t),
    spot: bar(22000 + i, 22050 + i, 21950 + i, 22010 + i, t),
    callMMA: 10.5 + i, callTMA: 9.5 + i,
    putMMA: 8.25 + i, putTMA: 7.25 + i,
    futureMMA: 22015 + i, futureTMA: 21990 + i,
    spotMMA: 22015 + i, spotTMA: 21990 + i,
    ranking: 10.5 + i, rankingWinner: i % 2 === 0 ? "call" : "put",
    smc: "Neutral", fib: "50%",
    rsi: 55 + i, ema: 22000 + i, vwap: 22005 + i,
    ema200: 21990 + i, emaScore: 1, vwapScore: 1, totalScore: 2, rating: "Strong CALL", signal: "BUY CALL",
    oiMatrix: null,
  };
}

describe("exportModule1Excel", () => {
  const outFile = "excelExport.verify.output.xlsx";
  afterAll(() => { try { fs.unlinkSync(outFile); } catch { /* noop */ } });

  it("writes a workbook whose rows/columns/order match the visible table", () => {
    const base = new Date(`${istDateStr()}T04:00:00.000Z`).getTime(); // ~09:30 IST
    const rows: DashboardRow[] = [mkRow(base, 0), mkRow(base + 300000, 1), mkRow(base + 600000, 2)];

    const built = buildModule1Workbook({
      rows, hiddenCols: [], colOrder: [],
      type: "Call+Put", instrument: "NIFTY", timeframe: "5m",
    });
    expect(built).not.toBeNull();
    expect(built!.filename).toBe(`Module1_NIFTY_5Min_${istDateStr()}.xlsx`);

    XLSX.writeFile(built!.wb, outFile);
    expect(fs.existsSync(outFile)).toBe(true);

    const wb = XLSX.readFile(outFile);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1 }) as string[][];

    // header rows + 3 data rows
    expect(aoa.length).toBe(5);
    expect(aoa[1][0]).toBe("Time");
    // chronological order preserved — oldest first, newest last (time-only display)
    expect(aoa[2][0]).toBe("09:30");
    expect(aoa[4][0]).toBe("09:40");
    // ranking column carries the +/- prefix like the live table
    const rankingColIdx = aoa[1].indexOf("Ranking");
    expect(aoa[3][rankingColIdx]).toMatch(/^\+/);
  });

  it("no-ops when there are no rows", () => {
    const ok = exportModule1Excel({
      rows: [], hiddenCols: [], colOrder: [],
      type: "Call+Put", instrument: "NIFTY", timeframe: "5m",
    });
    expect(ok).toBe(false);
  });
});
