/**
 * Combined 2026 Work Order Monitoring
 *
 * Reads the legacy AppSheet and PBS CMMS WorkOrders tabs, combines production
 * metrics, keeps Office reporting separate, and writes independent pending
 * work-order tables for each source.
 *
 * Install this script in the Google Sheet that should contain the report tabs.
 */

const CONFIG = {
  // Leave empty so all generated report tabs appear in the spreadsheet where
  // this monitoring script is installed (for example, 2026 Work Order Monitoring).
  // The two source WorkOrders databases remain read-only.
  OUTPUT_SPREADSHEET_URL: "",
  HEADER_ROW: 1,

  SOURCES: [
    {
      key: "APPSHEET",
      label: "AppSheet",
      spreadsheetUrl: "https://docs.google.com/spreadsheets/d/1_fNWH9AZeWv-nVXqYfPw0mi5SMkFoAJp_kkJAXUjR_g/edit?gid=0#gid=0",
      sheetName: "WorkOrders",
      dateOrder: "MDY"
    },
    {
      key: "CMMS",
      label: "CMMS",
      spreadsheetUrl: "https://docs.google.com/spreadsheets/d/18Kt-u_nNnke-7Vcjlry3mQC3tMWxGBD2IMxxQoZxtJU/edit?gid=0#gid=0",
      sheetName: "WorkOrders",
      dateOrder: "DMY"
    }
  ],

  PRODUCTION_SECTIONS: ["Roll Making", "Conversion"],
  OFFICE_TYPE_VALUES: ["Office"],
  OFFICE_SECTION_VALUES: ["Office"],

  TYPE_ORDER: ["Maintenance", "Kaizen", "Project", "Office"],
  BLANK_TYPE_LABEL: "Maintenance",

  CLOSED_STATUS_VALUES: ["closed", "complete", "completed", "done"],
  CANCELLED_STATUS_VALUES: ["cancelled", "canceled", "deleted"],
  DATE_COLUMN_PRIORITY: ["Date", "DateSubmitted"],
  CREATE_EMPTY_TABS: true,

  THEME: {
    NAVY: "#244a6d",
    BLUE: "#3b78a5",
    BLUE_DARK: "#2a5e86",
    SKY_SOFT: "#e8f2fa",
    SKY_PALE: "#f6fafd",
    TEAL: "#2d8b82",
    TEAL_SOFT: "#e7f4f2",
    GOLD: "#b98832",
    GOLD_SOFT: "#fbf2de",
    PLUM: "#735987",
    PLUM_SOFT: "#f0ebf4",
    CORAL: "#b65a66",
    CORAL_SOFT: "#f9eaec",
    INK: "#24313d",
    MUTED: "#6b7785",
    LINE: "#dce5ec",
    WHITE: "#ffffff"
  },

  DETAIL_COLUMNS: [
    "Source",
    "WorkOrderID",
    "DateSubmitted",
    "Date",
    "Shift",
    "Type",
    "Section",
    "Area",
    "Machine Name",
    "IssueCategory",
    "ReportedBy",
    "Department",
    "Priority",
    "IssueDescription",
    "Downtime Actual",
    "Total Downtime",
    "Status",
    "MaintenanceBy",
    "MaintenanceNotes",
    "DateResolved",
    "Date Finish",
    "DateClosed",
    "Remarks",
    "Change Spare Part",
    "Part Name",
    "Quantity",
    "Part Number"
  ],

  PENDING_COLUMNS: [
    "WorkOrderID",
    "DateSubmitted",
    "Date",
    "Section",
    "Area",
    "Machine Name",
    "IssueCategory",
    "ReportedBy",
    "Priority",
    "IssueDescription",
    "Status",
    "MaintenanceBy",
    "Age Days"
  ]
};


/************** MENU **************/

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Combined Maintenance Report")
    .addItem("Generate current month", "generateCurrentMonthReport")
    .addItem("Generate selected month", "generateSelectedMonthReport")
    .addItem("Generate this year Jan-current month", "generateThisYearReport")
    .addItem("Generate all months with data", "generateAllMonthsReport")
    .addSeparator()
    .addItem("Rebuild current year summary only", "rebuildCurrentYearSummaryOnly")
    .addSeparator()
    .addItem("Install daily auto update", "installDailyAutoUpdate")
    .addItem("Remove daily auto update", "removeDailyAutoUpdate")
    .addToUi();
}


/************** MAIN FUNCTIONS **************/

function generateCurrentMonthReport() {
  const data = readDatabases_();
  const now = new Date();
  buildMonthlyReports_(data, now.getFullYear(), now.getMonth() + 1);
  buildYearSummary_(data, now.getFullYear());
  notify_(`Generated combined ${monthName_(now.getMonth() + 1)} ${now.getFullYear()} report.`);
}

function generateSelectedMonthReport() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt(
    "Generate selected month",
    "Enter month as MM/YYYY. Example: 09/2026",
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() !== ui.Button.OK) return;

  const parsed = parseMonthYear_(response.getResponseText());
  if (!parsed) {
    ui.alert("Invalid month. Please use MM/YYYY, for example 09/2026.");
    return;
  }

  const data = readDatabases_();
  buildMonthlyReports_(data, parsed.year, parsed.month);
  buildYearSummary_(data, parsed.year);
  notify_(`Generated combined ${monthName_(parsed.month)} ${parsed.year} report.`);
}

function generateThisYearReport() {
  const data = readDatabases_();
  const now = new Date();
  const year = now.getFullYear();

  for (let month = 1; month <= now.getMonth() + 1; month++) {
    buildMonthlyReports_(data, year, month);
  }

  buildYearSummary_(data, year);
  notify_(`Generated combined January-${monthName_(now.getMonth() + 1)} ${year} reports.`);
}

function generateAllMonthsReport() {
  const data = readDatabases_();
  const monthKeys = getMonthKeysFromRecords_(data.records);

  if (monthKeys.length === 0) {
    SpreadsheetApp.getUi().alert("No valid work-order dates found in either database.");
    return;
  }

  monthKeys.forEach(key => {
    const parts = key.split("-");
    buildMonthlyReports_(data, Number(parts[0]), Number(parts[1]));
  });

  [...new Set(monthKeys.map(key => Number(key.split("-")[0])))]
    .forEach(year => buildYearSummary_(data, year));

  notify_("Generated all combined monthly reports found in both databases.");
}

function rebuildCurrentYearSummaryOnly() {
  const data = readDatabases_();
  const year = new Date().getFullYear();
  buildYearSummary_(data, year);
  notify_(`Rebuilt the combined ${year} Summary.`);
}


/************** AUTO UPDATE **************/

function installDailyAutoUpdate() {
  removeDailyAutoUpdate();
  ScriptApp.newTrigger("generateThisYearReport")
    .timeBased()
    .everyDays(1)
    .atHour(7)
    .create();
  notify_("Daily combined update installed for approximately 7 AM.");
}

function removeDailyAutoUpdate() {
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === "generateThisYearReport") {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  notify_("Daily combined update removed.");
}


/************** DATABASE READ AND NORMALIZATION **************/

function readDatabases_() {
  const allRecords = [];
  const allHeaders = [];
  const sources = [];

  CONFIG.SOURCES.forEach(sourceConfig => {
    const source = readSource_(sourceConfig);
    sources.push(source);

    source.headers.forEach(header => {
      if (header && !allHeaders.includes(header)) allHeaders.push(header);
    });

    source.records.forEach(record => allRecords.push(record));
  });

  return {
    sources,
    headers: allHeaders,
    records: deduplicateRecords_(allRecords)
  };
}

function readSource_(sourceConfig) {
  const spreadsheet = SpreadsheetApp.openByUrl(sourceConfig.spreadsheetUrl);
  const sheet = spreadsheet.getSheetByName(sourceConfig.sheetName);

  if (!sheet) {
    throw new Error(`${sourceConfig.label} tab "${sourceConfig.sheetName}" was not found.`);
  }

  const values = sheet.getDataRange().getValues();
  if (values.length < CONFIG.HEADER_ROW) {
    throw new Error(`${sourceConfig.label} has no header row.`);
  }

  const headers = trimHeaders_(values[CONFIG.HEADER_ROW - 1]);
  validateHeaders_(headers, sourceConfig.label);
  const records = [];

  for (let r = CONFIG.HEADER_ROW; r < values.length; r++) {
    const row = values[r].slice(0, headers.length);
    if (row.every(cell => isBlank_(cell))) continue;

    const record = {};
    headers.forEach((header, column) => {
      record[header] = row[column];
    });

    record.__sourceKey = sourceConfig.key;
    record.__sourceLabel = sourceConfig.label;
    record.__dateOrder = sourceConfig.dateOrder;
    record.__rowNumber = r + 1;
    record.__date = getMainDate_(record);
    record.__monthKey = record.__date ? getMonthKey_(record.__date) : "";
    record.__section = cleanText_(record.Section) || "No Section";
    record.__type = normalizeType_(record.Type);
    record.__status = cleanText_(record.Status) || "No Status";
    record.__isClosed = isClosedStatus_(record.__status);
    record.__isCancelled = isCancelledStatus_(record.__status);
    record.__isPending = !record.__isClosed && !record.__isCancelled;
    record.__isOffice = isOfficeRecord_(record);
    record.__isProduction = !record.__isOffice && isProductionSection_(record.__section);

    records.push(record);
  }

  return { config: sourceConfig, spreadsheet, sheet, headers, records };
}

function validateHeaders_(headers, sourceLabel) {
  const missing = ["WorkOrderID", "Section", "Status"]
    .filter(header => !headers.includes(header));
  const hasDate = CONFIG.DATE_COLUMN_PRIORITY.some(column => headers.includes(column));
  if (!hasDate) missing.push(`One of: ${CONFIG.DATE_COLUMN_PRIORITY.join(", ")}`);
  if (missing.length) {
    throw new Error(`${sourceLabel} is missing required column(s): ${missing.join(", ")}`);
  }
}

function deduplicateRecords_(records) {
  const byKey = {};

  records.forEach(record => {
    const id = cleanText_(record.WorkOrderID);
    const key = `${record.__sourceKey}:${id || record.__rowNumber}`;
    const existing = byKey[key];

    if (!existing) {
      byKey[key] = record;
      return;
    }

    const existingUpdated = parseDate_(existing.UpdatedAt, existing.__dateOrder) || existing.__date;
    const nextUpdated = parseDate_(record.UpdatedAt, record.__dateOrder) || record.__date;
    if (!existingUpdated || (nextUpdated && nextUpdated.getTime() >= existingUpdated.getTime())) {
      byKey[key] = record;
    }
  });

  return Object.keys(byKey).map(key => byKey[key]);
}


/************** MONTHLY REPORTS **************/

function buildMonthlyReports_(data, year, month) {
  const outputSS = getOutputSpreadsheet_();
  const monthRecords = data.records.filter(record =>
    record.__date &&
    record.__date.getFullYear() === year &&
    record.__date.getMonth() + 1 === month
  );

  const productionRecords = monthRecords.filter(record => record.__isProduction);
  const officeRecords = monthRecords.filter(record => record.__isOffice);
  const monthName = monthName_(month);

  CONFIG.PRODUCTION_SECTIONS.forEach(section => {
    const records = productionRecords.filter(record => sameText_(record.__section, section));
    if (!CONFIG.CREATE_EMPTY_TABS && records.length === 0) return;

    writeMonthlySheet_({
      outputSS,
      sheetName: `${monthName} ${section}`,
      title: `${monthName} ${year} - ${section} Combined Production Report`,
      records,
      groupTitle: "Area",
      groupGetter: record => cleanText_(record.Area) || "No Area"
    });
  });

  if (CONFIG.CREATE_EMPTY_TABS || productionRecords.length) {
    writeMonthlySheet_({
      outputSS,
      sheetName: `${monthName} Production`,
      title: `${monthName} ${year} - Combined Production Work Orders`,
      records: productionRecords,
      groupTitle: "Section",
      groupGetter: record => record.__section
    });
  }

  if (CONFIG.CREATE_EMPTY_TABS || officeRecords.length) {
    writeMonthlySheet_({
      outputSS,
      sheetName: `${monthName} Office`,
      title: `${monthName} ${year} - Office Work Orders (Separate)`,
      records: officeRecords,
      groupTitle: "Area",
      groupGetter: record => cleanText_(record.Area) || "Office"
    });
  }
}

function writeMonthlySheet_(options) {
  const records = sortRecords_(options.records);
  const detailColumns = CONFIG.DETAIL_COLUMNS.slice();
  const maxCols = Math.max(9, detailColumns.length);
  const sheet = getOrCreateSheet_(options.outputSS, sanitizeSheetName_(options.sheetName), maxCols);
  resetSheet_(sheet, maxCols, records.length + 100);

  let row = 1;
  writeTitle_(sheet, row, maxCols, options.title);
  row += 1;
  writeGeneratedLine_(sheet, row, maxCols, records);
  row += 3;

  row = writeSummaryCards_(
    sheet,
    row,
    records,
    options.title.toLowerCase().includes("office") ? "Office KPI" : "Combined Production KPI"
  );
  row = writeSourceSummary_(sheet, row, records);
  row = writeStatusSummary_(sheet, row, records);
  row = writeTypeSummary_(sheet, row, records);
  row = writeGroupSummary_(sheet, row, records, options.groupTitle, options.groupGetter);
  row = writePrioritySummary_(sheet, row, records);
  row += 1;
  row = writeDetailByType_(sheet, row, records, detailColumns, maxCols);

  applyFinalSheetFormatting_(sheet, detailColumns, maxCols);
}


/************** YEAR SUMMARY **************/

function buildYearSummary_(data, year) {
  const outputSS = getOutputSpreadsheet_();
  const sheet = getOrCreateSheet_(outputSS, sanitizeSheetName_(`${year} Summary`), 20);
  resetSheet_(sheet, 20, 260);

  let row = 1;
  writeTitle_(sheet, row, 20, `${year} Combined Work Order Summary`);
  row += 1;
  writeGeneratedLine_(sheet, row, 20, data.records);
  row += 3;

  const yearRecords = data.records.filter(record =>
    record.__date && record.__date.getFullYear() === year
  );
  const productionRecords = yearRecords.filter(record => record.__isProduction);
  const officeRecords = yearRecords.filter(record => record.__isOffice);

  row = writeSummaryCards_(sheet, row, productionRecords, "Combined Production KPI");

  const productionHeaders = [
    "Month", "Total WO", "Closed", "Pending", "Cancelled", "Close %",
    "Maintenance", "Kaizen", "Project", "AppSheet", "CMMS"
  ];

  CONFIG.PRODUCTION_SECTIONS.forEach(section => {
    productionHeaders.push(`${section} Total`, `${section} Closed`, `${section} Close %`);
  });

  const productionRows = [];
  for (let month = 1; month <= 12; month++) {
    const records = productionRecords.filter(record => record.__date.getMonth() + 1 === month);
    const metrics = computeMetrics_(records);
    const rowData = [
      monthName_(month), metrics.total, metrics.closed, metrics.pending,
      metrics.cancelled, metrics.closePct,
      metrics.typeCounts.Maintenance || 0,
      metrics.typeCounts.Kaizen || 0,
      metrics.typeCounts.Project || 0,
      metrics.sourceCounts.AppSheet || 0,
      metrics.sourceCounts.CMMS || 0
    ];

    CONFIG.PRODUCTION_SECTIONS.forEach(section => {
      const sectionMetrics = computeMetrics_(records.filter(record => sameText_(record.__section, section)));
      rowData.push(sectionMetrics.total, sectionMetrics.closed, sectionMetrics.closePct);
    });
    productionRows.push(rowData);
  }

  row = writeTable_(sheet, row, "Monthly Combined Production Summary", productionHeaders, productionRows);
  row += 1;

  row = writeSummaryCards_(sheet, row, officeRecords, "Office KPI (Separate)");
  const officeRows = [];
  for (let month = 1; month <= 12; month++) {
    const records = officeRecords.filter(record => record.__date.getMonth() + 1 === month);
    const metrics = computeMetrics_(records);
    officeRows.push([
      monthName_(month), metrics.total, metrics.closed, metrics.pending,
      metrics.cancelled, metrics.closePct,
      metrics.sourceCounts.AppSheet || 0,
      metrics.sourceCounts.CMMS || 0
    ]);
  }

  row = writeTable_(
    sheet,
    row,
    "Monthly Office Summary (Excluded from Production KPI)",
    ["Month", "Total WO", "Closed", "Pending", "Cancelled", "Close %", "AppSheet", "CMMS"],
    officeRows
  );
  row += 1;

  const detailRows = [];
  for (let month = 1; month <= 12; month++) {
    const monthRecords = productionRecords.filter(record => record.__date.getMonth() + 1 === month);
    CONFIG.PRODUCTION_SECTIONS.forEach(section => {
      const sectionRecords = monthRecords.filter(record => sameText_(record.__section, section));
      getTypeLabels_(sectionRecords).forEach(type => {
        const metrics = computeMetrics_(sectionRecords.filter(record => sameText_(record.__type, type)));
        if (!metrics.total) return;
        detailRows.push([
          monthName_(month), section, type, metrics.total,
          metrics.closed, metrics.pending, metrics.cancelled, metrics.closePct
        ]);
      });
    });
  }

  row = writeTable_(
    sheet,
    row,
    "Combined Production Summary by Section and Type",
    ["Month", "Section", "Type", "Total WO", "Closed", "Pending", "Cancelled", "Close %"],
    detailRows
  );
  row += 1;

  row = writePendingTable_(
    sheet,
    row,
    "AppSheet Pending Work Orders",
    yearRecords.filter(record => record.__sourceKey === "APPSHEET" && record.__isPending)
  );
  row += 1;

  row = writePendingTable_(
    sheet,
    row,
    "CMMS Pending Work Orders",
    yearRecords.filter(record => record.__sourceKey === "CMMS" && record.__isPending)
  );

  sheet.setFrozenRows(1);
  sheet.setHiddenGridlines(true);
  sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 1), 20)
    .setFontFamily("Arial")
    .setVerticalAlignment("top")
    .setWrap(true);
  sheet.autoResizeColumns(1, Math.min(20, sheet.getLastColumn()));
}


/************** SUMMARY BLOCKS **************/

function writeSummaryCards_(sheet, row, records, title) {
  const officeStyle = title && title.toLowerCase().includes("office");
  const accent = officeStyle ? CONFIG.THEME.GOLD : CONFIG.THEME.TEAL;
  const softAccent = officeStyle ? CONFIG.THEME.GOLD_SOFT : CONFIG.THEME.TEAL_SOFT;

  if (title) {
    sheet.getRange(row, 1, 1, 10)
      .merge()
      .setValue(title)
      .setFontWeight("bold")
      .setBackground(softAccent)
      .setFontColor(CONFIG.THEME.NAVY);
    row += 1;
  }

  const metrics = computeMetrics_(records);
  const headers = [
    "Total WO", "Closed", "Pending", "Cancelled", "Close %",
    "Maintenance", "Kaizen", "Project", "High Priority", "Avg Close Days"
  ];
  const values = [
    metrics.total,
    metrics.closed,
    metrics.pending,
    metrics.cancelled,
    metrics.closePct,
    metrics.typeCounts.Maintenance || 0,
    metrics.typeCounts.Kaizen || 0,
    metrics.typeCounts.Project || 0,
    metrics.highPriority,
    metrics.avgCloseDays
  ];

  sheet.getRange(row, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight("bold")
    .setBackground(accent)
    .setFontColor(CONFIG.THEME.WHITE)
    .setHorizontalAlignment("center");
  sheet.getRange(row + 1, 1, 1, values.length)
    .setValues([values])
    .setFontWeight("bold")
    .setFontSize(12)
    .setBackground(softAccent)
    .setFontColor(CONFIG.THEME.INK)
    .setHorizontalAlignment("center");
  sheet.getRange(row + 1, 5).setNumberFormat("0.0%");
  sheet.getRange(row + 1, 10).setNumberFormat("0.0");
  return row + 4;
}

function writeSourceSummary_(sheet, row, records) {
  const rows = CONFIG.SOURCES.map(source => {
    const metrics = computeMetrics_(records.filter(record => record.__sourceKey === source.key));
    return [source.label, metrics.total, metrics.closed, metrics.pending, metrics.cancelled, metrics.closePct];
  });
  return writeTable_(sheet, row, "Source Summary", ["Source", "Total WO", "Closed", "Pending", "Cancelled", "Close %"], rows);
}

function writeStatusSummary_(sheet, row, records) {
  const counts = {};
  records.forEach(record => {
    counts[record.__status] = (counts[record.__status] || 0) + 1;
  });
  const divisor = records.length || 1;
  const rows = Object.keys(counts)
    .sort((a, b) => counts[b] - counts[a])
    .map(status => [status, counts[status], counts[status] / divisor]);
  return writeTable_(sheet, row, "Status Summary", ["Status", "Count", "Percent"], rows);
}

function writeTypeSummary_(sheet, row, records) {
  const grouped = summarizeRecordsBy_(records, record => record.__type);
  const rows = orderLabels_(Object.keys(grouped), CONFIG.TYPE_ORDER).map(label => {
    const metrics = computeMetrics_(grouped[label]);
    return [label, metrics.total, metrics.closed, metrics.pending, metrics.cancelled, metrics.closePct];
  });
  return writeTable_(sheet, row, "Type Summary", ["Type", "Total WO", "Closed", "Pending", "Cancelled", "Close %"], rows);
}

function writeGroupSummary_(sheet, row, records, groupTitle, getter) {
  const grouped = summarizeRecordsBy_(records, getter);
  const rows = Object.keys(grouped).sort().map(label => {
    const metrics = computeMetrics_(grouped[label]);
    return [label, metrics.total, metrics.closed, metrics.pending, metrics.cancelled, metrics.closePct];
  });
  return writeTable_(sheet, row, `${groupTitle} Summary`, [groupTitle, "Total WO", "Closed", "Pending", "Cancelled", "Close %"], rows);
}

function writePrioritySummary_(sheet, row, records) {
  const grouped = summarizeRecordsBy_(records, record => cleanText_(record.Priority) || "No Priority");
  const rows = Object.keys(grouped).sort().map(label => {
    const metrics = computeMetrics_(grouped[label]);
    return [label, metrics.total, metrics.closed, metrics.pending, metrics.cancelled, metrics.closePct];
  });
  return writeTable_(sheet, row, "Priority Summary", ["Priority", "Total WO", "Closed", "Pending", "Cancelled", "Close %"], rows);
}


/************** DETAIL AND PENDING TABLES **************/

function writeDetailByType_(sheet, row, records, detailColumns, maxCols) {
  sheet.getRange(row, 1, 1, maxCols)
    .merge().setValue("Combined Work Order List by Type")
    .setFontWeight("bold").setFontSize(13)
    .setBackground(CONFIG.THEME.NAVY)
    .setFontColor(CONFIG.THEME.WHITE);
  row += 2;

  if (!records.length) {
    sheet.getRange(row, 1).setValue("No work orders found.").setFontStyle("italic").setFontColor(CONFIG.THEME.MUTED);
    return row + 2;
  }

  getTypeLabels_(records).forEach(type => {
    const typeRecords = records.filter(record => sameText_(record.__type, type));
    if (!typeRecords.length) return;
    const typeStyle = getTypeStyle_(type);

    sheet.getRange(row, 1, 1, maxCols)
      .merge().setValue(`${type} (${typeRecords.length})`)
      .setFontWeight("bold")
      .setBackground(typeStyle.soft)
      .setFontColor(typeStyle.strong);
    row += 1;
    sheet.getRange(row, 1, 1, detailColumns.length)
      .setValues([detailColumns])
      .setFontWeight("bold")
      .setBackground(typeStyle.strong)
      .setFontColor(CONFIG.THEME.WHITE);
    row += 1;

    const startDataRow = row;
    const values = typeRecords.map(record =>
      detailColumns.map(column => displayRecordValue_(record, column))
    );
    const detailRange = sheet.getRange(row, 1, values.length, detailColumns.length);
    detailRange
      .setValues(values)
      .setBackgrounds(buildAlternatingBackgrounds_(values.length, detailColumns.length))
      .setFontColor(CONFIG.THEME.INK)
      .setVerticalAlignment("top");
    applyDateTimeFormatsForDetail_(sheet, startDataRow, values.length, detailColumns);
    row += values.length + 2;
  });

  return row;
}

function writePendingTable_(sheet, row, title, records) {
  const sorted = records.slice().sort((a, b) => {
    const priorityDifference = priorityRank_(b.Priority) - priorityRank_(a.Priority);
    if (priorityDifference) return priorityDifference;
    return (a.__date ? a.__date.getTime() : 0) - (b.__date ? b.__date.getTime() : 0);
  });

  const rows = sorted.map(record => CONFIG.PENDING_COLUMNS.map(column => {
    if (column === "Age Days") return ageDays_(record.__date);
    return displayRecordValue_(record, column);
  }));

  const nextRow = writeTable_(sheet, row, title, CONFIG.PENDING_COLUMNS, rows);
  if (rows.length) {
    const headerRow = row + 1;
    const dataStart = headerRow + 1;
    applyDateTimeFormatsForDetail_(sheet, dataStart, rows.length, CONFIG.PENDING_COLUMNS);
  }
  return nextRow;
}


/************** TABLE WRITER **************/

function writeTable_(sheet, row, title, headers, rows) {
  const tableStyle = getTableStyle_(title);
  sheet.getRange(row, 1, 1, headers.length)
    .merge()
    .setValue(title)
    .setFontWeight("bold")
    .setBackground(tableStyle.soft)
    .setFontColor(CONFIG.THEME.NAVY);
  row += 1;
  sheet.getRange(row, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight("bold")
    .setBackground(tableStyle.strong)
    .setFontColor(CONFIG.THEME.WHITE);
  row += 1;

  if (!rows.length) {
    sheet.getRange(row, 1).setValue("No data").setFontStyle("italic").setFontColor(CONFIG.THEME.MUTED);
    return row + 2;
  }

  const safeRows = rows.map(sourceRow =>
    headers.map((_, index) => sourceRow[index] === undefined ? "" : sourceRow[index])
  );
  const dataStartRow = row;
  sheet.getRange(row, 1, safeRows.length, headers.length)
    .setValues(safeRows)
    .setBackgrounds(buildAlternatingBackgrounds_(safeRows.length, headers.length))
    .setFontColor(CONFIG.THEME.INK);

  headers.forEach((header, index) => {
    if (String(header).includes("%") || String(header).toLowerCase() === "percent") {
      sheet.getRange(dataStartRow, index + 1, safeRows.length, 1).setNumberFormat("0.0%");
    }
  });
  return row + safeRows.length + 2;
}


/************** METRICS **************/

function computeMetrics_(records) {
  const total = records.length;
  const closed = records.filter(record => record.__isClosed).length;
  const pending = records.filter(record => record.__isPending).length;
  const cancelled = records.filter(record => record.__isCancelled).length;
  const typeCounts = {};
  const sourceCounts = {};
  const closeDurations = [];

  records.forEach(record => {
    typeCounts[record.__type] = (typeCounts[record.__type] || 0) + 1;
    sourceCounts[record.__sourceLabel] = (sourceCounts[record.__sourceLabel] || 0) + 1;

    const closedDate = parseDate_(record.DateClosed, record.__dateOrder);
    if (record.__date && closedDate) {
      const days = (closedDate.getTime() - record.__date.getTime()) / 86400000;
      if (!isNaN(days) && days >= 0) closeDurations.push(days);
    }
  });

  const highPriority = records.filter(record =>
    ["high", "critical"].includes(cleanText_(record.Priority).toLowerCase())
  ).length;

  return {
    total,
    closed,
    pending,
    cancelled,
    closePct: total ? closed / total : 0,
    typeCounts,
    sourceCounts,
    highPriority,
    avgCloseDays: closeDurations.length
      ? round1_(closeDurations.reduce((sum, value) => sum + value, 0) / closeDurations.length)
      : ""
  };
}

function summarizeRecordsBy_(records, getter) {
  const grouped = {};
  records.forEach(record => {
    const label = cleanText_(getter(record)) || "Blank";
    if (!grouped[label]) grouped[label] = [];
    grouped[label].push(record);
  });
  return grouped;
}


/************** CLASSIFICATION HELPERS **************/

function isOfficeRecord_(record) {
  return CONFIG.OFFICE_TYPE_VALUES.some(value => sameText_(record.__type, value)) ||
    CONFIG.OFFICE_SECTION_VALUES.some(value => sameText_(record.__section, value));
}

function isProductionSection_(section) {
  return CONFIG.PRODUCTION_SECTIONS.some(value => sameText_(section, value));
}

function isClosedStatus_(status) {
  return CONFIG.CLOSED_STATUS_VALUES.includes(cleanText_(status).toLowerCase());
}

function isCancelledStatus_(status) {
  return CONFIG.CANCELLED_STATUS_VALUES.includes(cleanText_(status).toLowerCase());
}

function normalizeType_(value) {
  const type = cleanText_(value);
  if (!type) return CONFIG.BLANK_TYPE_LABEL;
  return CONFIG.TYPE_ORDER.find(item => sameText_(item, type)) || type;
}

function priorityRank_(priority) {
  const value = cleanText_(priority).toLowerCase();
  return { critical: 4, high: 3, medium: 2, low: 1 }[value] || 0;
}


/************** DATE HELPERS **************/

function getMainDate_(record) {
  for (const column of CONFIG.DATE_COLUMN_PRIORITY) {
    const date = parseDate_(record[column], record.__dateOrder);
    if (date) return date;
  }
  return null;
}

function parseDate_(value, dateOrder) {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  if (typeof value === "number" && !isNaN(value)) {
    return new Date(Math.round((value - 25569) * 86400 * 1000));
  }

  const text = cleanText_(value);
  if (!text) return null;

  const match = text.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (match) {
    const first = Number(match[1]);
    const second = Number(match[2]);
    let year = Number(match[3]);
    if (year < 100) year += 2000;

    let day;
    let month;
    if (first > 12) {
      day = first;
      month = second;
    } else if (second > 12) {
      month = first;
      day = second;
    } else if (dateOrder === "DMY") {
      day = first;
      month = second;
    } else {
      month = first;
      day = second;
    }

    const date = new Date(
      year,
      month - 1,
      day,
      Number(match[4] || 0),
      Number(match[5] || 0),
      Number(match[6] || 0)
    );
    if (!isNaN(date.getTime())) return date;
  }

  const fallback = new Date(text);
  return isNaN(fallback.getTime()) ? null : fallback;
}

function ageDays_(date) {
  if (!date) return "";
  return Math.max(0, Math.floor((new Date().getTime() - date.getTime()) / 86400000));
}

function getMonthKey_(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthName_(month) {
  return Utilities.formatDate(new Date(2026, month - 1, 1), Session.getScriptTimeZone(), "MMMM");
}

function parseMonthYear_(text) {
  const match = cleanText_(text).match(/^(\d{1,2})[\/\-. ]+(\d{4})$/);
  if (!match) return null;
  const month = Number(match[1]);
  const year = Number(match[2]);
  return month >= 1 && month <= 12 ? { month, year } : null;
}


/************** GENERAL HELPERS **************/

function getOutputSpreadsheet_() {
  return CONFIG.OUTPUT_SPREADSHEET_URL
    ? SpreadsheetApp.openByUrl(CONFIG.OUTPUT_SPREADSHEET_URL)
    : SpreadsheetApp.getActiveSpreadsheet();
}

function getOrCreateSheet_(spreadsheet, sheetName, minCols) {
  let sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) sheet = spreadsheet.insertSheet(sheetName);
  if (sheet.getMaxColumns() < minCols) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), minCols - sheet.getMaxColumns());
  }
  return sheet;
}

function resetSheet_(sheet, minCols, minRows) {
  if (sheet.getMaxColumns() < minCols) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), minCols - sheet.getMaxColumns());
  }
  if (sheet.getMaxRows() < minRows) {
    sheet.insertRowsAfter(sheet.getMaxRows(), minRows - sheet.getMaxRows());
  }
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).breakApart();
  sheet.clear();
}

function writeTitle_(sheet, row, maxCols, title) {
  sheet.getRange(row, 1, 1, maxCols)
    .merge().setValue(title)
    .setFontWeight("bold").setFontSize(16)
    .setBackground(CONFIG.THEME.NAVY)
    .setFontColor(CONFIG.THEME.WHITE)
    .setHorizontalAlignment("center");
}

function writeGeneratedLine_(sheet, row, maxCols, records) {
  const appSheetCount = records.filter(record => record.__sourceKey === "APPSHEET").length;
  const cmmsCount = records.filter(record => record.__sourceKey === "CMMS").length;
  sheet.getRange(row, 1, 1, maxCols)
    .merge()
    .setValue(`Generated: ${formatDateTime_(new Date())} | AppSheet: ${appSheetCount} | CMMS: ${cmmsCount}`)
    .setFontStyle("italic")
    .setBackground(CONFIG.THEME.SKY_PALE)
    .setFontColor(CONFIG.THEME.MUTED);
}

function buildAlternatingBackgrounds_(rowCount, columnCount) {
  const backgrounds = [];
  for (let row = 0; row < rowCount; row++) {
    backgrounds.push(Array(columnCount).fill(row % 2 === 0 ? CONFIG.THEME.WHITE : CONFIG.THEME.SKY_PALE));
  }
  return backgrounds;
}

function getTypeStyle_(type) {
  const value = cleanText_(type).toLowerCase();
  if (value === "kaizen") return { strong: CONFIG.THEME.TEAL, soft: CONFIG.THEME.TEAL_SOFT };
  if (value === "project") return { strong: CONFIG.THEME.PLUM, soft: CONFIG.THEME.PLUM_SOFT };
  if (value === "office") return { strong: CONFIG.THEME.GOLD, soft: CONFIG.THEME.GOLD_SOFT };
  return { strong: CONFIG.THEME.BLUE, soft: CONFIG.THEME.SKY_SOFT };
}

function getTableStyle_(title) {
  const value = cleanText_(title).toLowerCase();
  if (value.includes("office")) return { strong: CONFIG.THEME.GOLD, soft: CONFIG.THEME.GOLD_SOFT };
  if (value.includes("appsheet pending")) return { strong: CONFIG.THEME.PLUM, soft: CONFIG.THEME.PLUM_SOFT };
  if (value.includes("cmms pending") || value.includes("source")) {
    return { strong: CONFIG.THEME.TEAL, soft: CONFIG.THEME.TEAL_SOFT };
  }
  if (value.includes("priority")) return { strong: CONFIG.THEME.CORAL, soft: CONFIG.THEME.CORAL_SOFT };
  if (value.includes("type")) return { strong: CONFIG.THEME.PLUM, soft: CONFIG.THEME.PLUM_SOFT };
  return { strong: CONFIG.THEME.BLUE, soft: CONFIG.THEME.SKY_SOFT };
}

function displayRecordValue_(record, column) {
  if (column === "Source") return record.__sourceLabel;
  const value = record[column];
  return value === null || value === undefined ? "" : value;
}

function getTypeLabels_(records) {
  return orderLabels_([...new Set(records.map(record => record.__type).filter(Boolean))], CONFIG.TYPE_ORDER);
}

function orderLabels_(labels, preferredOrder) {
  const ordered = [];
  preferredOrder.forEach(preferred => {
    const found = labels.find(label => sameText_(label, preferred));
    if (found && !ordered.includes(found)) ordered.push(found);
  });
  labels
    .filter(label => !ordered.some(existing => sameText_(existing, label)))
    .sort()
    .forEach(label => ordered.push(label));
  return ordered;
}

function sortRecords_(records) {
  return records.slice().sort((a, b) => {
    const dateDifference = (a.__date ? a.__date.getTime() : 0) - (b.__date ? b.__date.getTime() : 0);
    if (dateDifference) return dateDifference;
    const sourceDifference = cleanText_(a.__sourceLabel).localeCompare(cleanText_(b.__sourceLabel));
    if (sourceDifference) return sourceDifference;
    return cleanText_(a.WorkOrderID).localeCompare(cleanText_(b.WorkOrderID));
  });
}

function getMonthKeysFromRecords_(records) {
  return [...new Set(records.map(record => record.__monthKey).filter(Boolean))].sort();
}

function trimHeaders_(row) {
  const headers = row.map(header => cleanText_(header));
  let last = headers.length;
  while (last > 0 && !headers[last - 1]) last--;
  return headers.slice(0, last);
}

function cleanText_(value) {
  return value === null || value === undefined ? "" : String(value).replace(/\s+/g, " ").trim();
}

function isBlank_(value) {
  return value === null || value === undefined || (typeof value === "string" && !value.trim());
}

function sameText_(a, b) {
  return cleanText_(a).toLowerCase() === cleanText_(b).toLowerCase();
}

function round1_(value) {
  return Math.round(value * 10) / 10;
}

function sanitizeSheetName_(name) {
  return String(name).replace(/[\\\/\?\*\[\]\:]/g, "-").substring(0, 99);
}

function formatDateTime_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
}

function notify_(message) {
  try {
    getOutputSpreadsheet_().toast(message);
  } catch (error) {
    Logger.log(message);
  }
}


/************** FORMATTING **************/

function applyFinalSheetFormatting_(sheet, detailColumns, maxCols) {
  const lastRow = Math.max(sheet.getLastRow(), 1);
  sheet.setFrozenRows(1);
  sheet.setHiddenGridlines(true);
  sheet.getRange(1, 1, lastRow, maxCols)
    .setFontFamily("Arial")
    .setVerticalAlignment("top")
    .setWrap(true);
  sheet.autoResizeColumns(1, Math.min(maxCols, sheet.getLastColumn()));

  const widthMap = {
    Source: 95,
    WorkOrderID: 165,
    DateSubmitted: 145,
    Date: 95,
    Shift: 60,
    Type: 110,
    Section: 120,
    Area: 120,
    "Machine Name": 145,
    IssueCategory: 140,
    ReportedBy: 120,
    Department: 120,
    Priority: 90,
    IssueDescription: 340,
    Status: 105,
    MaintenanceBy: 150,
    MaintenanceNotes: 320,
    Remarks: 240
  };

  detailColumns.forEach((column, index) => {
    if (widthMap[column]) sheet.setColumnWidth(index + 1, widthMap[column]);
  });
}

function applyDateTimeFormatsForDetail_(sheet, startRow, numberOfRows, columns) {
  if (numberOfRows <= 0) return;
  columns.forEach((column, index) => {
    const name = String(column).toLowerCase();
    if (name === "date" || name === "date finish") {
      sheet.getRange(startRow, index + 1, numberOfRows, 1).setNumberFormat("dd/mm/yyyy");
    } else if (name.includes("date") || name.includes("closed") || name.includes("resolved")) {
      sheet.getRange(startRow, index + 1, numberOfRows, 1).setNumberFormat("dd/mm/yyyy hh:mm");
    }
  });
}
