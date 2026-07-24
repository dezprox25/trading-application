// Excel export for the Module 1 worksheet — shared by the manual "Download
// Excel" button and the automatic end-of-day export. Reuses the exact same
// column set/order, cell-value formatting, and cell-color presentation as the
// live table so the exported file always matches what's on screen.

import { Workbook } from "exceljs";
import type { DashboardRow, PivotMethod } from "../../calc";
import {
  getDashboardCellPresentation,
  getVisibleColumns,
  GROUP_COLORS,
  GROUP_LABELS,
} from "./tablePresentation";
import { buildLiveColorGrid } from "./cellColorRules";

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
  pivotMethod?: PivotMethod;
}

const EXCEL_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const HEADER_ROW_HEIGHT = 24;
const BODY_ROW_HEIGHT = 22;

function toExcelArgb(hex: string): string {
  return `FF${hex.replace("#", "").toUpperCase()}`;
}

function setSolidFill(cell: { fill: object }, hex: string): void {
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: toExcelArgb(hex) },
  };
}

function triggerBrowserDownload(buffer: ArrayBuffer, filename: string): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const blob = new Blob([buffer], { type: EXCEL_MIME });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 0);
}

// Pure workbook-building logic — no browser I/O, easy to unit test. Row and
// style content is pulled through the same shared presentation helpers the live
// table uses, so the export remains an exact visual/value match.
export function buildModule1Workbook(params: ExportParams): { wb: Workbook; filename: string } | null {
  const { rows, hiddenCols, colOrder, type, instrument, timeframe, pivotMethod = "client" } = params;
  if (rows.length === 0) return null;

  const cols = getVisibleColumns(type, hiddenCols, colOrder);
  if (cols.length === 0) return null;

  const liveColorGrid = buildLiveColorGrid(rows);
  const wb = new Workbook();
  const ws = wb.addWorksheet("Module1");

  ws.addRow(cols.map(c => GROUP_LABELS[c.group]));
  ws.addRow(cols.map(c => c.sub));
  ws.getRow(1).height = HEADER_ROW_HEIGHT;
  ws.getRow(2).height = HEADER_ROW_HEIGHT;

  cols.forEach((c, index) => {
    const groupColors = GROUP_COLORS[c.group];
    const groupCell = ws.getCell(1, index + 1);
    const subCell = ws.getCell(2, index + 1);

    groupCell.value = GROUP_LABELS[c.group];
    subCell.value = c.sub;

    setSolidFill(groupCell, groupColors.bg);
    groupCell.font = {
      name: "Calibri",
      bold: true,
      color: { argb: toExcelArgb(groupColors.text) },
    };
    groupCell.alignment = { horizontal: "center", vertical: "middle" };

    setSolidFill(subCell, groupColors.subBg);
    subCell.font = {
      name: "Calibri",
      bold: true,
      color: { argb: toExcelArgb(groupColors.text) },
    };
    subCell.alignment = { horizontal: "center", vertical: "middle" };

    ws.getColumn(index + 1).width = Math.max(10, Math.round(c.defaultW / 7));
  });

  let start = 0;
  for (let i = 1; i <= cols.length; i++) {
    if (i === cols.length || cols[i].group !== cols[start].group) {
      if (i - start > 1) ws.mergeCells(1, start + 1, 1, i);
      start = i;
    }
  }

  rows.forEach((row, rowIndex) => {
    const excelRow = ws.addRow(cols.map((c) => {
      const presentation = getDashboardCellPresentation({
        row,
        prevRow: rows[rowIndex - 1],
        colId: c.id,
        pivotMethod,
        colorClass: liveColorGrid[c.id]?.[rowIndex] ?? null,
      });
      return presentation.value;
    }));

    excelRow.height = BODY_ROW_HEIGHT;

    cols.forEach((c, colIndex) => {
      const presentation = getDashboardCellPresentation({
        row,
        prevRow: rows[rowIndex - 1],
        colId: c.id,
        pivotMethod,
        colorClass: liveColorGrid[c.id]?.[rowIndex] ?? null,
      });
      const cell = excelRow.getCell(colIndex + 1);

      setSolidFill(cell, presentation.bg);
      cell.font = {
        name: "Calibri",
        bold: presentation.fontWeight >= 600,
        color: { argb: toExcelArgb(presentation.textColor) },
      };
      cell.alignment = {
        horizontal: c.align ?? "center",
        vertical: "middle",
      };
    });
  });

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

  void built.wb.xlsx.writeBuffer()
    .then((buffer) => triggerBrowserDownload(buffer as ArrayBuffer, built.filename))
    .catch((error: unknown) => {
      console.error("[excelExport] Failed to generate Module 1 Excel file", error);
    });

  return true;
}
