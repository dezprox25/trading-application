import ExcelJS from "exceljs";

export const exportModule2ToExcel = async (session: any, sortedTimestamps: string[]) => {
  if (!session || !session.strikes) {
    console.warn("No active session data to export.");
    return;
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Dezprox Trading App";
  workbook.created = new Date();

  const rawSelected: string[] = session.selectedStrikes || [];
  const rawKeys: string[] = Object.keys(session.strikes || {});
  const selectedStrikes: string[] = Array.from(new Set([...rawSelected, ...rawKeys]));

  const ceStrikes = selectedStrikes.filter((s) => s.endsWith("CE"));
  const peStrikes = selectedStrikes.filter((s) => s.endsWith("PE"));

  const buildSheet = (sheetName: string, strikeKeys: string[], headerColor: string) => {
    const sheet = workbook.addWorksheet(sheetName);

    // Columns definition: S.No., Strike, Trend Badge, % Change, Day High, Day Low, then Minute Timestamps
    const baseHeaders = ["S.No.", "Strike", "Trend Badge", "% Change", "Day High", "Day Low"];
    const allHeaders = [...baseHeaders, ...sortedTimestamps];

    // Add Header Row
    const headerRow = sheet.addRow(allHeaders);
    headerRow.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFF" } };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: headerColor },
    };
    headerRow.alignment = { vertical: "middle", horizontal: "center" };
    headerRow.height = 24;

    // Set Column Widths
    sheet.getColumn(1).width = 8;  // S.No.
    sheet.getColumn(2).width = 14; // Strike
    sheet.getColumn(3).width = 14; // Trend Badge
    sheet.getColumn(4).width = 12; // % Change
    sheet.getColumn(5).width = 12; // Day High
    sheet.getColumn(6).width = 12; // Day Low

    sortedTimestamps.forEach((_, idx) => {
      sheet.getColumn(7 + idx).width = 10;
    });

    // High column Min & Max across strikeKeys in this sheet
    const highValues: number[] = [];
    strikeKeys.forEach((key) => {
      const s = session.strikes[key];
      if (s && typeof s.dayHigh === "number" && !isNaN(s.dayHigh) && s.dayHigh > 0) {
        highValues.push(s.dayHigh);
      }
    });
    const highMax = highValues.length > 0 ? Math.max(...highValues) : null;
    const highMin = highValues.length > 0 ? Math.min(...highValues) : null;

    // Low column Min & Max across strikeKeys in this sheet
    const lowValues: number[] = [];
    strikeKeys.forEach((key) => {
      const s = session.strikes[key];
      if (s && typeof s.dayLow === "number" && !isNaN(s.dayLow) && s.dayLow > 0) {
        lowValues.push(s.dayLow);
      }
    });
    const lowMax = lowValues.length > 0 ? Math.max(...lowValues) : null;
    const lowMin = lowValues.length > 0 ? Math.min(...lowValues) : null;

    // Populate Rows
    strikeKeys.forEach((strikeKey, index) => {
      const strikeData = session.strikes[strikeKey];
      if (!strikeData) return;

      // Row-wise Min & Max for timestamp LTP cells in this row
      const rowLtps: number[] = [];
      sortedTimestamps.forEach((ts) => {
        const cell = (strikeData.grid || []).find((c: any) => c.timestamp === ts);
        if (cell && typeof cell.ltp === "number" && !isNaN(cell.ltp) && cell.ltp > 0) {
          rowLtps.push(cell.ltp);
        }
      });
      const rowMax = rowLtps.length > 0 ? Math.max(...rowLtps) : null;
      const rowMin = rowLtps.length > 0 ? Math.min(...rowLtps) : null;
      const hasDistinctRowMinMax = rowMax !== null && rowMin !== null && rowMax !== rowMin;

      const rowValues: (string | number)[] = [
        index + 1, // S.No. starting from 1
        strikeKey,
        strikeData.trendBadge || "FLAT",
        typeof strikeData.pctChange === "number" ? `${strikeData.pctChange > 0 ? "+" : ""}${strikeData.pctChange.toFixed(2)}%` : "0.00%",
        typeof strikeData.dayHigh === "number" ? Math.round(strikeData.dayHigh) : 0,
        typeof strikeData.dayLow === "number" ? Math.round(strikeData.dayLow) : 0,
      ];

      // Add Minute Ticks
      sortedTimestamps.forEach((ts) => {
        const cell = (strikeData.grid || []).find((c: any) => c.timestamp === ts);
        rowValues.push(cell && typeof cell.ltp === "number" ? cell.ltp : "");
      });

      const row = sheet.addRow(rowValues);
      row.height = 22;
      row.alignment = { vertical: "middle", horizontal: "center" };
      row.font = { name: "Arial", size: 10 };

      // Apply cell styling & borders
      row.eachCell((cell, colNumber) => {
        cell.border = {
          top: { style: "thin", color: { argb: "E2E8F0" } },
          bottom: { style: "thin", color: { argb: "E2E8F0" } },
          left: { style: "thin", color: { argb: "E2E8F0" } },
          right: { style: "thin", color: { argb: "E2E8F0" } },
        };

        // Col 5: Day High cell
        if (colNumber === 5) {
          const isHighHighest = highMax !== null && highMin !== null && highMax !== highMin && strikeData.dayHigh === highMax;
          const isHighLowest  = highMax !== null && highMin !== null && highMax !== highMin && strikeData.dayHigh === highMin;
          if (isHighHighest) {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "1E3A8A" } }; // Dark Blue
            cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFF" } };
          } else if (isHighLowest) {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "111827" } }; // Black
            cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFF" } };
          }
        }

        // Col 6: Day Low cell
        if (colNumber === 6) {
          const isLowHighest = lowMax !== null && lowMin !== null && lowMax !== lowMin && strikeData.dayLow === lowMax;
          const isLowLowest  = lowMax !== null && lowMin !== null && lowMax !== lowMin && strikeData.dayLow === lowMin;
          if (isLowHighest) {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "1E3A8A" } }; // Dark Blue
            cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFF" } };
          } else if (isLowLowest) {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "111827" } }; // Black
            cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFF" } };
          }
        }

        // Col 7+: Minute Timestamp cells
        if (colNumber >= 7) {
          const tsIdx = colNumber - 7;
          const ts = sortedTimestamps[tsIdx];
          const gridCell = (strikeData.grid || []).find((c: any) => c.timestamp === ts);
          if (gridCell && typeof gridCell.ltp === "number" && !isNaN(gridCell.ltp) && gridCell.ltp > 0) {
            const isHighest = hasDistinctRowMinMax && gridCell.ltp === rowMax;
            const isLowest  = hasDistinctRowMinMax && gridCell.ltp === rowMin;
            if (isHighest) {
              cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "BFDBFE" } }; // Light Blue
              cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "1E3A8A" } };
            } else if (isLowest) {
              cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "111827" } }; // Black
              cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFF" } };
            }
          }
        }
      });
    });
  };

  // Build CE Sheet (Green header: 047857)
  if (ceStrikes.length > 0) {
    buildSheet("CE Strikes", ceStrikes, "047857");
  }

  // Build PE Sheet (Red header: E53935)
  if (peStrikes.length > 0) {
    buildSheet("PE Strikes", peStrikes, "E53935");
  }

  // Fallback if no specific CE/PE filter matched
  if (ceStrikes.length === 0 && peStrikes.length === 0 && selectedStrikes.length > 0) {
    buildSheet("Strikes", selectedStrikes, "1E293B");
  }

  // Download XLSX
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const filename = `Module2_StrikeTracker_${session.indexSymbol || "Session"}_${session.expiryDate || ""}.xlsx`;

  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.URL.revokeObjectURL(url);
};
