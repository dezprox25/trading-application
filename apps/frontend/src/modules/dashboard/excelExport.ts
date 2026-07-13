// Excel export for the Module 1 worksheet — shared by the manual "Download
// Excel" button and the automatic end-of-day export. Reuses the exact same
// column set/order and cell-value formatting as the live table (Worksheet.tsx)
// so the exported file always matches what's on screen.

import * as XLSX from "xlsx";
import type { DashboardRow } from "../../calc";
import {
  getVisibleColumns, getCellValue, rankingDisplayValue, GROUP_LABELS,
} from "./Worksheet";

// YYYY-MM-DD in IST — used both for the filename's trading date and for the
// once-per-day dedupe key so a day boundary is always the same regardless of
// the viewer's local timezone.
export function istDateStr(ts: number = Date.now()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(ts));
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function timeframeLabel(tf: string): string {
  if (tf === "custom") return "Custom";
  const m = /^(\d+)(m|h)$/.exec(tf);
  if (!m) return tf;
  return `${m[1]}${m[2] === "h" ? "Hour" : "Min"}`;
}

export interface ExportParams {
  rows: DashboardRow[];
  hiddenCols: string[];
  colOrder: string[];
  type: "Call" | "Put" | "Call+Put";
  instrument: string;
  timeframe: string;
}

// Pure sheet-building logic — no I/O, easy to unit test. Row/column content
// is pulled through the same getCellValue/rankingDisplayValue helpers the
// live table uses, so the exported values are an exact text match of what's
// currently displayed. Returns null when there's nothing to export.
export function buildModule1Workbook(params: ExportParams): { wb: XLSX.WorkBook; filename: string } | null {
  const { rows, hiddenCols, colOrder, type, instrument, timeframe } = params;
  if (rows.length === 0) return null;

  const cols = getVisibleColumns(type, hiddenCols, colOrder);
  if (cols.length === 0) return null;

  const groupRow = cols.map(c => GROUP_LABELS[c.group]);
  const subRow   = cols.map(c => c.sub);

  const body = rows.map((row, i) =>
    cols.map(c => c.id === "ranking" ? rankingDisplayValue(row, rows[i - 1]) : getCellValue(row, c.id))
  );

  const ws = XLSX.utils.aoa_to_sheet([groupRow, subRow, ...body]);

  // Merge consecutive header cells that share the same group (mirrors the
  // grouped header row in the live table).
  const merges: XLSX.Range[] = [];
  let start = 0;
  for (let i = 1; i <= cols.length; i++) {
    if (i === cols.length || cols[i].group !== cols[start].group) {
      if (i - start > 1) merges.push({ s: { r: 0, c: start }, e: { r: 0, c: i - 1 } });
      start = i;
    }
  }
  ws["!merges"] = merges;
  ws["!cols"] = cols.map(c => ({ wch: Math.max(10, Math.round(c.defaultW / 7)) }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Module1");

  const symbol = (instrument || "NIFTY").toUpperCase();
  const tf     = timeframeLabel(timeframe);
  const date   = istDateStr(rows[0].t);
  const filename = `Module1_${symbol}_${tf}_${date}.xlsx`;

  return { wb, filename };
}

// Builds the workbook and triggers a browser download. Returns false (no-op)
// when there are no rows to export.
export function exportModule1Excel(params: ExportParams): boolean {
  const built = buildModule1Workbook(params);
  if (!built) return false;
  XLSX.writeFile(built.wb, built.filename);
  return true;
}
