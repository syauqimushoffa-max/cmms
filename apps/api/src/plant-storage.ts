import type { DatabaseSync } from "node:sqlite";
import { canAccessPlant, writePlant } from "./plant-context.js";

// Scoped views apply the same plant predicate to lists, joins and aggregates.
// Base-table triggers independently protect writes, including guessed IDs.
export const plantTables = [
  "work_orders", "sections", "machines", "assets", "issue_categories",
  "work_order_activities", "work_order_attachments", "notifications",
  "spare_parts", "spare_suppliers", "stock_movements", "spare_sync_attempts",
  "work_order_sync_queue", "work_order_sync_deletions", "pm_checklist_templates",
  "pm_checklist_items", "pm_plans", "pm_schedules", "pm_results", "pm_result_photos",
  "external_work_orders", "air_leak_sync_queue"
];

export function migratePlants(db: DatabaseSync) {
  db.function("cmms_can_access", (plant: unknown) => Number(canAccessPlant(plant)));
  db.function("cmms_write_plant", () => writePlant());
  const columns = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
  const firstMigration = !columns.some((column) => column.name === "plantAccess");
  db.exec("PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE");
  try {
    if (firstMigration) {
      db.exec("ALTER TABLE users ADD COLUMN plantAccess TEXT NOT NULL DEFAULT 'port-klang' CHECK (plantAccess IN ('port-klang', 'sendayan', 'both'))");
      db.exec("UPDATE users SET plantAccess = 'both' WHERE role IN ('admin', 'developer')");
    }
    for (const table of plantTables) {
      const fields = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
      if (!fields.some((field) => field.name === "plantId")) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN plantId TEXT NOT NULL DEFAULT 'port-klang' CHECK (plantId IN ('port-klang', 'sendayan'))`);
      }
    }
    if (firstMigration) {
      // Preserve item numbers while allowing independent stock for the same part.
      for (const table of ["spare_parts", "stock_movements", "sections", "issue_categories"]) {
        const stored = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as { sql: string };
        let definition = stored.sql.replace(new RegExp(`CREATE TABLE ["\x60]?${table}["\x60]?`, "i"), `CREATE TABLE ${table}_plant_migration`);
        if (table === "spare_parts") {
          definition = definition.replace("itemNo TEXT PRIMARY KEY", "itemNo TEXT NOT NULL").replace(/\)\s*$/, ", PRIMARY KEY (plantId, itemNo))");
        } else if (table === "stock_movements") {
          definition = definition.replace("FOREIGN KEY (itemNo) REFERENCES spare_parts(itemNo)", "FOREIGN KEY (plantId, itemNo) REFERENCES spare_parts(plantId, itemNo)");
        } else {
          definition = definition.replace("name TEXT NOT NULL UNIQUE", "name TEXT NOT NULL").replace(/\)\s*$/, ", UNIQUE (plantId, name))");
        }
        const indexes = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL").all(table) as Array<{ sql: string }>;
        db.exec(`${definition}; INSERT INTO ${table}_plant_migration SELECT * FROM ${table}; DROP TABLE ${table}; ALTER TABLE ${table}_plant_migration RENAME TO ${table};`);
        indexes.forEach((index) => db.exec(index.sql));
      }
    }
    // Department-owned master data may legitimately reuse a display name. For
    // example, Production and SHE can both have a "Floor Carpet 1&2" section.
    // Older databases enforced uniqueness across the whole plant, so rebuild
    // these two small master tables once to scope names by department as well.
    for (const table of ["sections", "issue_categories"]) {
      const stored = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as { sql: string };
      if (/UNIQUE\s*\(\s*plantId\s*,\s*department\s*,\s*name\s*\)/i.test(stored.sql)) continue;
      let definition = stored.sql.replace(new RegExp(`CREATE TABLE ["\\x60]?${table}["\\x60]?`, "i"), `CREATE TABLE ${table}_department_migration`);
      definition = definition
        .replace("name TEXT NOT NULL UNIQUE", "name TEXT NOT NULL")
        .replace(/,\s*UNIQUE\s*\(\s*plantId\s*,\s*name\s*\)\s*\)$/i, ", UNIQUE (plantId, department, name))");
      if (!/UNIQUE\s*\(\s*plantId\s*,\s*department\s*,\s*name\s*\)/i.test(definition)) {
        definition = definition.replace(/\)\s*$/, ", UNIQUE (plantId, department, name))");
      }
      const indexes = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL").all(table) as Array<{ sql: string }>;
      // Existing installations already have a scoped view. SQLite validates
      // that view and relationship triggers during ALTER TABLE RENAME, so
      // remove them for the short table rebuild. The common setup below
      // recreates both immediately afterward.
      db.exec(`DROP VIEW IF EXISTS scoped_${table}`);
      const dependentTriggers = db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'trigger' AND name LIKE 'plant_link_%' AND sql LIKE ?
      `).all(`%FROM ${table} WHERE%`) as Array<{ name: string }>;
      dependentTriggers.forEach((trigger) => db.exec(`DROP TRIGGER IF EXISTS "${trigger.name.replaceAll('"', '""')}"`));
      db.exec(`${definition}; INSERT INTO ${table}_department_migration SELECT * FROM ${table}; DROP TABLE ${table}; ALTER TABLE ${table}_department_migration RENAME TO ${table};`);
      indexes.forEach((index) => db.exec(index.sql));
    }
    for (const table of plantTables) {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_${table}_plant ON ${table}(plantId);
        CREATE VIEW IF NOT EXISTS scoped_${table} AS SELECT * FROM ${table} WHERE cmms_can_access(plantId);
        CREATE TRIGGER IF NOT EXISTS plant_${table}_insert BEFORE INSERT ON ${table}
        WHEN NEW.plantId <> cmms_write_plant()
        BEGIN SELECT RAISE(ABORT, 'Plant access denied'); END;
        CREATE TRIGGER IF NOT EXISTS plant_${table}_update BEFORE UPDATE ON ${table}
        WHEN NOT cmms_can_access(OLD.plantId) OR NEW.plantId <> OLD.plantId
        BEGIN SELECT RAISE(ABORT, 'Plant access denied'); END;
        CREATE TRIGGER IF NOT EXISTS plant_${table}_delete BEFORE DELETE ON ${table}
        WHEN NOT cmms_can_access(OLD.plantId)
        BEGIN SELECT RAISE(ABORT, 'Plant access denied'); END;
      `);
    }
    const relations = [
      ["machines", "sectionId", "sections", "id"],
      ["work_orders", "sectionId", "sections", "id"],
      ["work_orders", "machineId", "machines", "id"],
      ["work_orders", "issueCategoryId", "issue_categories", "id"],
      ["work_order_activities", "workOrderId", "work_orders", "id"],
      ["work_order_attachments", "workOrderId", "work_orders", "id"],
      ["notifications", "workOrderId", "work_orders", "id"],
      ["stock_movements", "workOrderId", "work_orders", "id"],
      ["pm_checklist_items", "templateId", "pm_checklist_templates", "id"],
      ["pm_plans", "templateId", "pm_checklist_templates", "id"],
      ["pm_schedules", "planId", "pm_plans", "id"],
      ["pm_results", "scheduleId", "pm_schedules", "id"],
      ["pm_result_photos", "scheduleId", "pm_schedules", "id"]
    ];
    for (const [table, column, parent, key] of relations) {
      for (const operation of ["INSERT", "UPDATE"]) {
        db.exec(`CREATE TRIGGER IF NOT EXISTS plant_link_${table}_${column}_${operation} BEFORE ${operation} ON ${table}
          WHEN NEW.${column} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${parent} WHERE ${key} = NEW.${column} AND plantId = NEW.plantId)
          BEGIN SELECT RAISE(ABORT, 'Related record belongs to another plant'); END;`);
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
  if (db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Plant migration foreign key check failed.");
}
