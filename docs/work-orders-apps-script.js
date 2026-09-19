/**
 * PBS CMMS work-order mirror for Google Sheets.
 *
 * 1. Create a Google Sheet and open Extensions > Apps Script.
 * 2. Paste this file into Code.gs.
 * 3. In Project Settings > Script properties add CMMS_SHARED_TOKEN.
 * 4. Deploy as a Web app, execute as yourself, and grant access to the CMMS server.
 * 5. Copy the /exec URL and the same token into CMMS Developer Mode > Settings.
 */

const WORK_ORDER_HEADERS = [
  "WorkOrderID", "DateSubmitted", "Date", "Shift", "Type", "Section", "Area",
  "Machine Name", "MachineID", "IssueCategory", "ReportedBy", "Department", "Priority",
  "IssueDescription", "PhotoIssue", "Downtime Actual", "Total Downtime", "Status",
  "MaintenanceBy", "MaintenanceNotes", "PhotoFix", "DateAcknowledge", "AcknowledgeTime",
  "DateRepair", "RepairTime", "FinishTime", "VerifyTime", "Change Spare Part", "Part Name",
  "Quantity", "Part Number", "DateResolved", "Date Finish", "DateClosed", "Remarks",
  "ReturnPhoto", "UpdatedAt"
];

const TIMESTAMP_HEADERS = [
  "DateSubmitted", "DateAcknowledge", "DateRepair", "DateResolved", "DateClosed", "UpdatedAt"
];
const DATE_HEADERS = ["Date", "Date Finish"];
const DURATION_HEADERS = [
  "Downtime Actual", "Total Downtime", "AcknowledgeTime", "RepairTime", "FinishTime", "VerifyTime"
];
const PHOTO_HEADERS = {
  PhotoIssue: "View issue photo",
  PhotoFix: "View completion photo",
  ReturnPhoto: "View return photo"
};
const DISPLAY_TIME_ZONE = "Asia/Kuala_Lumpur";
const COLUMN_WIDTHS = {
  WorkOrderID: 165,
  DateSubmitted: 145,
  Date: 100,
  Shift: 55,
  Type: 95,
  Section: 115,
  Area: 110,
  "Machine Name": 145,
  MachineID: 120,
  IssueCategory: 135,
  ReportedBy: 120,
  Department: 120,
  Priority: 85,
  IssueDescription: 280,
  PhotoIssue: 130,
  "Downtime Actual": 115,
  "Total Downtime": 115,
  Status: 95,
  MaintenanceBy: 140,
  MaintenanceNotes: 280,
  PhotoFix: 145,
  DateAcknowledge: 145,
  AcknowledgeTime: 120,
  DateRepair: 145,
  RepairTime: 105,
  FinishTime: 105,
  VerifyTime: 100,
  "Change Spare Part": 125,
  "Part Name": 190,
  Quantity: 90,
  "Part Number": 135,
  DateResolved: 145,
  "Date Finish": 100,
  DateClosed: 145,
  Remarks: 220,
  ReturnPhoto: 130,
  UpdatedAt: 145
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("PBS CMMS")
    .addItem("Format existing work orders", "formatExistingWorkOrders")
    .addToUi();
}

function formatExistingWorkOrders() {
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  const spreadsheet = spreadsheetId ? SpreadsheetApp.openById(spreadsheetId) : SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getActiveSheet();
  ensureHeaders(sheet);
  const rowCount = Math.max(0, sheet.getLastRow() - 1);
  if (!rowCount) return;

  const range = sheet.getRange(2, 1, rowCount, WORK_ORDER_HEADERS.length);
  const rows = range.getValues();
  const notes = range.getNotes();
  const records = rows.map((cells, rowIndex) => {
    const record = WORK_ORDER_HEADERS.reduce((result, header, columnIndex) => {
      const savedPhotoUrl = PHOTO_HEADERS[header] ? String(notes[rowIndex][columnIndex] || "").split("\n")[0] : "";
      result[header] = savedPhotoUrl || cells[columnIndex];
      return result;
    }, {});
    return calculateReadableDurations(record);
  });

  range.setValues(records.map((record) => WORK_ORDER_HEADERS.map((header) => normalizeCellValue(header, record[header]))));
  records.forEach((record, index) => formatWorkOrderSheet(sheet, index + 2, record));
  spreadsheet.toast(rowCount + " work orders formatted.", "PBS CMMS", 5);
}

function doPost(event) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
    const request = JSON.parse((event.postData && event.postData.contents) || "{}");
    const expectedToken = PropertiesService.getScriptProperties().getProperty("CMMS_SHARED_TOKEN");
    if (!expectedToken || request.token !== expectedToken) return jsonResponse({ ok: false, error: "Unauthorized" });

    const spreadsheetId = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
    const spreadsheet = spreadsheetId ? SpreadsheetApp.openById(spreadsheetId) : SpreadsheetApp.getActiveSpreadsheet();
    const sheetName = String(request.sheetName || "WorkOrders");
    const sheet = spreadsheet.getSheetByName(sheetName) || spreadsheet.insertSheet(sheetName);
    ensureHeaders(sheet);

    if (request.action === "deleteWorkOrder") {
      const workOrderId = String(request.WorkOrderID || "").trim();
      if (!workOrderId) return jsonResponse({ ok: false, error: "WorkOrderID is required" });
      const match = findWorkOrderCell(sheet, workOrderId);
      if (match) sheet.deleteRow(match.getRow());
      return jsonResponse({ ok: true, deleted: Boolean(match), workOrderId: workOrderId });
    }
    if (request.action !== "upsertWorkOrder" || !request.Data) return jsonResponse({ ok: false, error: "Unsupported action" });

    const workOrderId = String(request.Data.WorkOrderID || "").trim();
    if (!workOrderId) return jsonResponse({ ok: false, error: "WorkOrderID is required" });
    const values = WORK_ORDER_HEADERS.map((header) => normalizeCellValue(header, request.Data[header]));
    const lastRow = sheet.getLastRow();
    let targetRow = lastRow + 1;
    const match = findWorkOrderCell(sheet, workOrderId);
    if (match) targetRow = match.getRow();
    sheet.getRange(targetRow, 1, 1, WORK_ORDER_HEADERS.length).setValues([values]);
    formatWorkOrderSheet(sheet, targetRow, request.Data);
    return jsonResponse({ ok: true, row: targetRow, workOrderId: workOrderId });
  } catch (error) {
    return jsonResponse({ ok: false, error: String(error && error.message ? error.message : error) });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function findWorkOrderCell(sheet, workOrderId) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return null;
  return sheet.getRange(2, 1, lastRow - 1, 1).createTextFinder(workOrderId).matchEntireCell(true).findNext();
}

function ensureHeaders(sheet) {
  sheet.getParent().setSpreadsheetTimeZone(DISPLAY_TIME_ZONE);
  const current = sheet.getLastColumn() ? sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), WORK_ORDER_HEADERS.length)).getValues()[0] : [];
  const differs = WORK_ORDER_HEADERS.some((header, index) => current[index] !== header);
  if (sheet.getLastRow() === 0 || differs) {
    sheet.getRange(1, 1, 1, WORK_ORDER_HEADERS.length).setValues([WORK_ORDER_HEADERS]);
  }
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(1);
  sheet.getRange(1, 1, 1, WORK_ORDER_HEADERS.length)
    .setFontWeight("bold")
    .setBackground("#7f111b")
    .setFontColor("#ffffff")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setWrap(true);
  sheet.setRowHeight(1, 42);
  WORK_ORDER_HEADERS.forEach((header, index) => sheet.setColumnWidth(index + 1, COLUMN_WIDTHS[header] || 110));
  sheet.hideColumns(headerColumn("MachineID"));
  sheet.hideColumns(headerColumn("UpdatedAt"));
  setHeaderNotes(sheet);
}

function normalizeCellValue(header, value) {
  if (value == null || value === "") return "";
  if (TIMESTAMP_HEADERS.indexOf(header) >= 0) {
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? String(value) : parsed;
  }
  if (DATE_HEADERS.indexOf(header) >= 0) {
    const text = String(value);
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(text + "T12:00:00") : new Date(text);
    return isNaN(parsed.getTime()) ? text : parsed;
  }
  if (DURATION_HEADERS.indexOf(header) >= 0) {
    const number = Number(value);
    return isFinite(number) ? number : "";
  }
  return value;
}

function calculateReadableDurations(record) {
  const calculated = Object.assign({}, record);
  calculated["Downtime Actual"] = durationOrCalculated(record["Downtime Actual"], record.DateRepair, record.DateResolved);
  calculated["Total Downtime"] = durationOrCalculated(record["Total Downtime"], record.DateSubmitted, record.DateResolved);
  calculated.AcknowledgeTime = durationOrCalculated(record.AcknowledgeTime, record.DateSubmitted, record.DateAcknowledge);
  calculated.RepairTime = durationOrCalculated(record.RepairTime, record.DateRepair, record.DateResolved);
  calculated.FinishTime = durationOrCalculated(record.FinishTime, record.DateSubmitted, record.DateResolved);
  calculated.VerifyTime = durationOrCalculated(record.VerifyTime, record.DateResolved, record.DateClosed);
  return calculated;
}

function durationOrCalculated(currentValue, startValue, endValue) {
  if (typeof currentValue === "number" && isFinite(currentValue)) return currentValue;
  const currentText = String(currentValue == null ? "" : currentValue).trim();
  if (/^-?\d+(\.\d+)?$/.test(currentText)) return Number(currentText);
  if (!startValue || !endValue) return "";
  const start = new Date(startValue);
  const end = new Date(endValue);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return "";
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
}

function formatWorkOrderSheet(sheet, row, data) {
  const rowRange = sheet.getRange(row, 1, 1, WORK_ORDER_HEADERS.length);
  rowRange
    .setBackground(row % 2 === 0 ? "#ffffff" : "#fff8f8")
    .setFontColor("#2f2224")
    .setVerticalAlignment("top")
    .setWrap(true);
  sheet.setRowHeight(row, 58);

  TIMESTAMP_HEADERS.forEach((header) => sheet.getRange(row, headerColumn(header)).setNumberFormat("dd/mm/yyyy hh:mm"));
  DATE_HEADERS.forEach((header) => sheet.getRange(row, headerColumn(header)).setNumberFormat("dd/mm/yyyy"));
  DURATION_HEADERS.forEach((header) => sheet.getRange(row, headerColumn(header)).setNumberFormat('0 "min"'));
  ["Shift", "Priority", "Status", "Change Spare Part", "Quantity"].forEach((header) => {
    sheet.getRange(row, headerColumn(header)).setHorizontalAlignment("center");
  });

  Object.keys(PHOTO_HEADERS).forEach((header) => {
    setPhotoLink(sheet.getRange(row, headerColumn(header)), data[header], PHOTO_HEADERS[header]);
  });
  styleStatusCell(sheet.getRange(row, headerColumn("Status")), String(data.Status || ""));
}

function setPhotoLink(cell, value, label) {
  const url = String(value || "").trim();
  if (!url) {
    cell.clearContent().clearNote();
    return;
  }
  if (/^https?:\/\//i.test(url)) {
    const richText = SpreadsheetApp.newRichTextValue().setText(label).setLinkUrl(url).build();
    cell.setRichTextValue(richText).setFontColor("#1155cc").setFontLine("underline").setNote(url);
    return;
  }
  cell.setValue("Photo saved").setFontColor("#7f111b").setNote(
    url + "\nSet APP_PUBLIC_URL on the CMMS server to make this a clickable link."
  );
}

function styleStatusCell(cell, status) {
  const style = {
    Open: ["#fff0f0", "#a31d2b"],
    Acknowledged: ["#fff7df", "#7a5700"],
    "In progress": ["#e9f3ff", "#175a9c"],
    "Pending material": ["#fff2dc", "#8a4d00"],
    Resolved: ["#e7f7ed", "#17673a"],
    Closed: ["#e8f2ec", "#235d3c"],
    Returned: ["#fdebec", "#9d2430"],
    Cancelled: ["#eeeeee", "#555555"]
  }[status] || ["#f4f1f1", "#4c4142"];
  cell.setBackground(style[0]).setFontColor(style[1]).setFontWeight("bold").setHorizontalAlignment("center");
}

function setHeaderNotes(sheet) {
  const notes = {
    "Downtime Actual": "Minutes from repair start until resolution.",
    "Total Downtime": "Minutes from submission until resolution.",
    AcknowledgeTime: "Minutes from submission until maintenance acknowledgement.",
    RepairTime: "Minutes from repair start until resolution.",
    FinishTime: "Minutes from submission until resolution.",
    VerifyTime: "Minutes from resolution until requester verification/closure.",
    MachineID: "Technical CMMS identifier; hidden by default.",
    UpdatedAt: "Technical sync timestamp; hidden by default."
  };
  Object.keys(notes).forEach((header) => sheet.getRange(1, headerColumn(header)).setNote(notes[header]));
}

function headerColumn(header) {
  return WORK_ORDER_HEADERS.indexOf(header) + 1;
}

function jsonResponse(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
