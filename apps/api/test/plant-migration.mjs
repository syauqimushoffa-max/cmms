import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve("tmp", `plant-legacy-${Date.now()}`);
mkdirSync(root, { recursive: true });
process.env.CMMS_DATA_DIR = root;
process.env.CMMS_UPLOADS_DIR = path.join(root, "uploads");
const legacy = new DatabaseSync(path.join(root, "cmms.sqlite"));
// migrate() deliberately retains the pre-plant schema for existing installs.
const source = readFileSync(new URL("../src/db.ts", import.meta.url), "utf8");
const schema = source.match(/export function migrate\(\) \{\s*db.exec\(`([\s\S]*?)`\);/)[1];
legacy.exec(schema);
legacy.exec(`
  INSERT INTO users (id, username, name, role, department, title) VALUES
    ('legacy-admin', 'legacy-admin', 'Admin', 'admin', 'Management', 'Admin'),
    ('legacy-tech', 'legacy-tech', 'Tech', 'technician', 'Maintenance', 'Tech');
  INSERT INTO sections (id, name, active, createdAt, updatedAt) VALUES ('legacy-section', 'Conversion', 1, '2026-01-01', '2026-01-01');
  INSERT INTO spare_parts (itemNo, currentStock, createdAt, updatedAt) VALUES ('LEGACY-001', 9, '2026-01-01', '2026-01-01');
  INSERT INTO stock_movements (id, itemNo, actorId, type, quantity, beforeStock, afterStock, source, syncStatus, createdAt)
    VALUES ('legacy-movement', 'LEGACY-001', 'legacy-tech', 'issue', 1, 10, 9, 'test', 'disabled', '2026-01-01');
  INSERT INTO work_orders (id, number, type, title, description, assetName, location, priority, status, requesterId, workDate, shiftGroup, machineName, reportedByName, reportedByDepartment, issueDescription, createdAt, updatedAt)
    VALUES ('legacy-wo', 'WO-LEGACY-001', 'maintenance', 'Legacy repair', 'Preserve this history', 'Machine', 'Conversion', 'medium', 'open', 'legacy-tech', '2026-01-01', 'A', 'Machine', 'Tech', 'Production', 'Preserve this history', '2026-01-01', '2026-01-01');
`);
legacy.close();
const m = await import("../dist/db.js");
const { plantContext } = await import("../dist/plant-context.js");
m.migrate();
assert.equal(m.getUser("legacy-admin").plantAccess, "both");
assert.equal(m.getUser("legacy-tech").plantAccess, "port-klang");
assert.equal(m.getWorkOrderDetail("legacy-wo").plantId, "port-klang");
assert.equal(m.getWorkOrderDetail("legacy-wo").number, "WO-LEGACY-001");
assert.equal(m.listSpareInventory().parts[0].currentStock, 9);
assert.equal(m.listSparePartMovements("LEGACY-001").length, 1);
assert.deepEqual(plantContext.run({ plant: "sendayan" }, () => m.listWorkOrders()), []);
assert.deepEqual(plantContext.run({ plant: "sendayan" }, () => m.listSpareInventory().parts), []);
m.migrate();
assert.equal(m.listSparePartMovements("LEGACY-001").length, 1);
assert.equal(m.db.prepare("PRAGMA foreign_key_check").all().length, 0);
m.db.close();
console.log("PASS: legacy records, identifiers, stock and history preserved in Port Klang; memberships backfilled; repeat migration and foreign keys verified.");
