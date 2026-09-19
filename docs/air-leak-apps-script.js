/**
 * PBS CMMS -> AppSheet Air Leak return sync.
 *
 * Script properties:
 *   CMMS_SHARED_TOKEN  Strong token also entered in CMMS Settings.
 *   SPREADSHEET_ID     Optional when this is a standalone script.
 *
 * Deploy as a Web app that executes as the owner. CMMS calls the /exec URL.
 */

const AIR_LEAK_ID_HEADER = "Air Leak ID";
const CMMS_HEADERS = [
  "CMMS Work Order ID",
  "CMMS Work Order No",
  "CMMS Status",
  "CMMS Updated At",
  "Integration Status",
  "Integration Error"
];
const RETURN_HEADERS = ["Status", "Close Date", "Picture Proof", "Close By"];

function doPost(event) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
    const request = JSON.parse((event.postData && event.postData.contents) || "{}");
    const expectedToken = PropertiesService.getScriptProperties().getProperty("CMMS_SHARED_TOKEN");
    if (!expectedToken || request.token !== expectedToken) return jsonResponse({ ok: false, error: "Unauthorized" });
    if (request.action !== "updateAirLeak" || !request.Data) return jsonResponse({ ok: false, error: "Unsupported action" });

    const spreadsheetId = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
    const spreadsheet = spreadsheetId ? SpreadsheetApp.openById(spreadsheetId) : SpreadsheetApp.getActiveSpreadsheet();
    const sheetName = String(request.sheetName || "Main");
    const sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) return jsonResponse({ ok: false, error: "Sheet tab not found: " + sheetName });

    ensureIntegrationHeaders(sheet);
    const airLeakId = String(request.Data[AIR_LEAK_ID_HEADER] || "").trim();
    if (!airLeakId) return jsonResponse({ ok: false, error: "Air Leak ID is required" });
    const row = findAirLeakRow(sheet, airLeakId);
    if (!row) return jsonResponse({ ok: false, error: "Air Leak ID not found: " + airLeakId });

    CMMS_HEADERS.concat(RETURN_HEADERS).forEach(function(header) {
      if (!Object.prototype.hasOwnProperty.call(request.Data, header)) return;
      let value = request.Data[header];
      if (header === "Close Date" && value) {
        const parsed = new Date(String(value) + "T12:00:00");
        value = isNaN(parsed.getTime()) ? value : parsed;
      } else if (header === "CMMS Updated At" && value) {
        const parsed = new Date(value);
        value = isNaN(parsed.getTime()) ? value : parsed;
      }
      sheet.getRange(row, headerColumn(sheet, header)).setValue(value == null ? "" : value);
    });
    sheet.getRange(row, headerColumn(sheet, "Close Date")).setNumberFormat("dd/mm/yyyy");
    sheet.getRange(row, headerColumn(sheet, "CMMS Updated At")).setNumberFormat("dd/mm/yyyy hh:mm");
    return jsonResponse({ ok: true, airLeakId: airLeakId, row: row });
  } catch (error) {
    return jsonResponse({ ok: false, error: String(error && error.message ? error.message : error) });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function ensureIntegrationHeaders(sheet) {
  const headers = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getDisplayValues()[0];
  if (headers.indexOf(AIR_LEAK_ID_HEADER) < 0) throw new Error("Air Leak ID header not found");
  CMMS_HEADERS.concat(RETURN_HEADERS).forEach(function(header) {
    if (headers.indexOf(header) >= 0) return;
    headers.push(header);
    sheet.getRange(1, headers.length).setValue(header);
  });
}

function findAirLeakRow(sheet, airLeakId) {
  const column = headerColumn(sheet, AIR_LEAK_ID_HEADER);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const match = sheet.getRange(2, column, lastRow - 1, 1)
    .createTextFinder(airLeakId)
    .matchEntireCell(true)
    .findNext();
  return match ? match.getRow() : null;
}

function headerColumn(sheet, header) {
  const headers = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getDisplayValues()[0];
  const index = headers.indexOf(header);
  if (index < 0) throw new Error("Header not found: " + header);
  return index + 1;
}

function jsonResponse(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
