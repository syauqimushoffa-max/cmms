/*
 * PBS CMMS spare-parts Google Apps Script bridge.
 *
 * Setup:
 * 1. Open the spare-parts Google Sheet.
 * 2. Extensions -> Apps Script.
 * 3. Paste this file.
 * 4. Set Script property SPARE_SYNC_TOKEN to the same value used by the CMMS API.
 * 5. Deploy -> New deployment -> Web app -> Execute as you -> Who has access: Anyone with the link.
 */

const TOKEN_PROPERTY = "SPARE_SYNC_TOKEN";

function doPost(event) {
  try {
    const body = JSON.parse(event.postData && event.postData.contents ? event.postData.contents : "{}");
    assertToken_(body.token);

    const sheetNames = body.sheetNames || {};
    const action = String(body.action || "");

    if (action === "ping") {
      return json_({ ok: true, message: "PBS CMMS spare sync ready." });
    }

    if (action === "pullMasterData") {
      return json_({
        ok: true,
        masterRows: readSheetObjects_(sheetNames.master || "Masterlist"),
        supplierRows: readSheetObjects_(sheetNames.supplier || "Supplier")
      });
    }

    if (action === "pushMovement") {
      const movement = body.movement || {};
      appendMovement_(sheetNames.movement || "Movement Log", movement);
      updateStock_(sheetNames.master || "Masterlist", movement.itemNo, movement.afterStock);
      return json_({ ok: true, movementId: movement.id });
    }

    if (action === "pushStockSnapshot") {
      const snapshot = Array.isArray(body.parts) ? body.parts : [];
      snapshot.forEach((part) => updateStock_(sheetNames.master || "Masterlist", part.itemNo, part.currentStock));
      return json_({ ok: true, updated: snapshot.length });
    }

    throw new Error("Unknown action: " + action);
  } catch (error) {
    return json_({ ok: false, error: error.message || String(error) });
  }
}

function assertToken_(token) {
  const expected = PropertiesService.getScriptProperties().getProperty(TOKEN_PROPERTY);
  if (!expected || token !== expected) {
    throw new Error("Invalid sync token.");
  }
}

function readSheetObjects_(sheetName) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(sheetName);
  if (!sheet) {
    return [];
  }

  const values = sheet.getDataRange().getValues();
  if (values.length < 2) {
    return [];
  }

  const headers = values[0].map((header, index) => {
    const clean = String(header || "").trim();
    if (!clean && String(sheetName).toUpperCase() === "MASTERLIST" && index === 2) {
      return "ITEM NAME";
    }

    return clean || `Column ${index + 1}`;
  });
  return values.slice(1).filter((row) => row.some((cell) => String(cell || "").trim())).map((row) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = row[index];
    });
    return record;
  });
}

function appendMovement_(sheetName, movement) {
  const sheet = getOrCreateSheet_(sheetName);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      "MOVEMENT ID",
      "CREATED AT",
      "ITEM NO.",
      "TYPE",
      "QUANTITY",
      "BEFORE STOCK",
      "AFTER STOCK",
      "WORK ORDER",
      "ACTOR",
      "NOTE",
      "SOURCE"
    ]);
  }

  const movementId = String(movement.id || "");
  if (movementId && movementAlreadyLogged_(sheet, movementId)) {
    return;
  }

  sheet.appendRow([
    movementId,
    movement.createdAt || new Date(),
    movement.itemNo || "",
    movement.type || "",
    movement.quantity || 0,
    movement.beforeStock || 0,
    movement.afterStock || 0,
    movement.workOrderNumber || movement.workOrderId || "",
    movement.actorName || movement.actorId || "",
    movement.note || "",
    movement.source || ""
  ]);
}

function movementAlreadyLogged_(sheet, movementId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return false;
  }

  const values = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  return values.some((row) => String(row[0]) === movementId);
}

function updateStock_(sheetName, itemNo, nextStock) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(sheetName);
  if (!sheet || !itemNo) {
    return;
  }

  const values = sheet.getDataRange().getValues();
  if (values.length < 2) {
    return;
  }

  const headers = values[0].map((header) => normalizeHeader_(header));
  const itemNoIndex = headers.indexOf("ITEMNO");
  const stockIndex = ensureCurrentStockColumn_(sheet, headers);
  if (itemNoIndex < 0 || stockIndex < 0) {
    throw new Error("Masterlist must contain ITEM NO.");
  }

  for (let rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
    if (String(values[rowIndex][itemNoIndex]).trim().toLowerCase() === String(itemNo).trim().toLowerCase()) {
      sheet.getRange(rowIndex + 1, stockIndex + 1).setValue(nextStock);
      return;
    }
  }

  throw new Error("ITEM NO. not found in masterlist: " + itemNo);
}

function ensureCurrentStockColumn_(sheet, headers) {
  const existingIndex = firstHeaderIndex_(headers, ["CURRENTSTOCK", "STOCK"]);
  if (existingIndex >= 0) {
    return existingIndex;
  }

  const openingIndex = headers.indexOf("OPENING");
  const insertAfter = openingIndex >= 0 ? openingIndex + 1 : headers.length;
  sheet.insertColumnAfter(insertAfter);
  const currentStockColumn = insertAfter + 1;
  sheet.getRange(1, currentStockColumn).setValue("CURRENT STOCK");

  const lastRow = sheet.getLastRow();
  if (lastRow > 1 && openingIndex >= 0) {
    const openingValues = sheet.getRange(2, openingIndex + 1, lastRow - 1, 1).getValues();
    sheet.getRange(2, currentStockColumn, lastRow - 1, 1).setValues(openingValues);
  }

  return currentStockColumn - 1;
}

function firstHeaderIndex_(headers, candidates) {
  for (const candidate of candidates) {
    const index = headers.indexOf(candidate);
    if (index >= 0) {
      return index;
    }
  }

  return -1;
}

function normalizeHeader_(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function getOrCreateSheet_(sheetName) {
  return SpreadsheetApp.getActive().getSheetByName(sheetName) || SpreadsheetApp.getActive().insertSheet(sheetName);
}

function json_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
