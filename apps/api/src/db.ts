import { migratePlants } from "./plant-storage.js";
import { canAccessPlant, plantContext, plantSettingKey, userPlants, writePlant } from "./plant-context.js";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type {
  ActivityAction,
  AirLeakSyncResult,
  AirLeakSyncSettings,
  AppSheetAirLeakInput,
  AppSheetAirLeakResult,
  AssetCondition,
  AssetCriticality,
  AssetDashboardResponse,
  AssetLifecycleBand,
  AssetRecord,
  AuthSession,
  CreateUserInput,
  CreateWorkOrderInput,
  DashboardSummary,
  GuestTrackingLink,
  GuestWorkOrderTracking,
  IssueCategory,
  Machine,
  MachineImportResult,
  MachineImportRow,
  MasterData,
  NotificationRecord,
  AssignPmTemplateInput,
  PmChecklistItem,
  PmChecklistPhoto,
  PmChecklistResult,
  PmChecklistTemplate,
  PmDashboardResponse,
  PmPlan,
  PmScheduleDetail,
  PmScheduleItem,
  SavePmResultInput,
  SavePmTemplateInput,
  SubmitPmScheduleInput,
  TvWorkOrder,
  PublicRequesterWorkOrder,
  Section,
  SpareAdjustmentInput,
  SpareImportInput,
  SpareImportResult,
  SpareInventoryResponse,
  SpareIssueInput,
  SparePart,
  SparePartDetail,
  SpareQrLookupResult,
  SpareSyncSettings,
  SpareSupplier,
  SpareSyncResult,
  StockMovement,
  StockMovementDetail,
  StockMovementType,
  StockSyncStatus,
  UpdateSpareSyncSettingsInput,
  UpdateAssetInput,
  UpdateAirLeakSyncSettingsInput,
  UpdateDowntimeReasonInput,
  UpdatePmPlanInput,
  UpdateUserInput,
  UpdateWorkOrderInput,
  UpdateWorkOrderStatusInput,
  User,
  UserRole,
  WorkOrder,
  WorkOrderActivity,
  WorkOrderAttachment,
  WorkOrderDetail,
  WorkOrderDepartment,
  WorkOrderStatus,
  WorkOrderSyncResult,
  WorkOrderSyncSettings,
  UpdateWorkOrderSyncSettingsInput,
  WorkOrderType
} from "@pbs-cmms/shared";
import { longProductionDowntimeMinutes, technicianCanAccessWorkOrder, workOrderDepartmentForUser, workOrderStatusLabels } from "@pbs-cmms/shared";
import { productionAssets2026 } from "./production-assets-2026.js";
import { emitNotificationCreated } from "./notification-events.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.CMMS_DATA_DIR || path.resolve(__dirname, "../data");
export const uploadsRoot = process.env.CMMS_UPLOADS_DIR || path.resolve(__dirname, "../uploads");

if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

if (!existsSync(uploadsRoot)) {
  mkdirSync(uploadsRoot, { recursive: true });
}

export const db = new DatabaseSync(path.join(dataDir, "cmms.sqlite"));
// Existing databases already contain triggers referencing these functions.
// Register them before any legacy migrations prepare UPDATE statements.
db.function("cmms_can_access", (plant: unknown) => Number(canAccessPlant(plant)));
db.function("cmms_write_plant", () => writePlant());

function now() {
  return new Date().toISOString();
}

function row<T>(value: unknown): T {
  return value as T;
}

function rows<T>(value: unknown[]): T[] {
  return value as T[];
}

function boolNumber(value: boolean) {
  return value ? 1 : 0;
}

const userSelectColumns = "id, username, name, role, department, title, avatarUrl, plantAccess";
const publicRequesterId = "u-requester-public";
const defaultSectionIds = {
  conversion: "section-conversion",
  rollMaking: "section-roll-making"
};
const otherIssueCategoryId = "issue-category-other";

function createPasswordRecord(password: string) {
  const passwordSalt = randomBytes(16).toString("hex");
  const passwordHash = scryptSync(password, passwordSalt, 64).toString("hex");
  return { passwordHash, passwordSalt };
}

function verifyPassword(password: string, passwordSalt: string, passwordHash: string) {
  const expected = Buffer.from(passwordHash, "hex");
  const actual = Buffer.from(scryptSync(password, passwordSalt, 64));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function migrate() {
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      department TEXT NOT NULL,
      title TEXT NOT NULL,
      avatarUrl TEXT,
      passwordHash TEXT,
      passwordSalt TEXT,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      tokenHash TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      expiresAt TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS work_orders (
      id TEXT PRIMARY KEY,
      number TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      assetName TEXT NOT NULL,
      location TEXT NOT NULL,
      priority TEXT NOT NULL,
      status TEXT NOT NULL,
      requesterId TEXT NOT NULL,
      assignedToId TEXT,
      supportingTechnicianIds TEXT NOT NULL DEFAULT '[]',
      dueDate TEXT,
      completionNote TEXT,
      maintenanceActualMinutes INTEGER,
      productionDowntimeReason TEXT,
      workDate TEXT NOT NULL,
      shiftGroup TEXT NOT NULL,
      sectionId TEXT,
      machineId TEXT,
      area TEXT NOT NULL DEFAULT '',
      machineName TEXT NOT NULL,
      reportedByName TEXT NOT NULL,
      reportedByDepartment TEXT NOT NULL,
      responsibleDepartment TEXT NOT NULL DEFAULT 'Production',
      issueCategoryId TEXT,
      issueCategoryName TEXT NOT NULL DEFAULT '',
      issueDescription TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (requesterId) REFERENCES users(id),
      FOREIGN KEY (assignedToId) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS sections (
      id TEXT PRIMARY KEY,
      department TEXT NOT NULL DEFAULT 'Production',
      name TEXT NOT NULL UNIQUE,
      active INTEGER NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS machines (
      id TEXT PRIMARY KEY,
      department TEXT NOT NULL DEFAULT 'Production',
      sectionId TEXT NOT NULL,
      area TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      active INTEGER NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (sectionId) REFERENCES sections(id)
    );

    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      assetNo INTEGER NOT NULL UNIQUE,
      name TEXT NOT NULL,
      serialNo TEXT NOT NULL DEFAULT '',
      yearText TEXT NOT NULL DEFAULT '',
      installDateText TEXT NOT NULL DEFAULT '',
      warranty TEXT NOT NULL DEFAULT '',
      manufacturer TEXT NOT NULL DEFAULT '',
      supplier TEXT NOT NULL DEFAULT '',
      contactPerson TEXT NOT NULL DEFAULT '',
      telephone TEXT NOT NULL DEFAULT '',
      fax TEXT NOT NULL DEFAULT '',
      condition TEXT NOT NULL DEFAULT 'operational',
      criticality TEXT NOT NULL DEFAULT 'medium',
      location TEXT NOT NULL DEFAULT 'Production',
      notes TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS issue_categories (
      id TEXT PRIMARY KEY,
      department TEXT NOT NULL DEFAULT 'Production',
      name TEXT NOT NULL UNIQUE,
      active INTEGER NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS work_order_activities (
      id TEXT PRIMARY KEY,
      workOrderId TEXT NOT NULL,
      actorId TEXT NOT NULL,
      action TEXT NOT NULL,
      status TEXT,
      message TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (workOrderId) REFERENCES work_orders(id) ON DELETE CASCADE,
      FOREIGN KEY (actorId) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS work_order_attachments (
      id TEXT PRIMARY KEY,
      workOrderId TEXT NOT NULL,
      uploadedBy TEXT NOT NULL,
      filename TEXT NOT NULL,
      originalName TEXT NOT NULL,
      mimeType TEXT NOT NULL,
      size INTEGER NOT NULL,
      url TEXT NOT NULL,
      kind TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (workOrderId) REFERENCES work_orders(id) ON DELETE CASCADE,
      FOREIGN KEY (uploadedBy) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      workOrderId TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      readAt TEXT,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id),
      FOREIGN KEY (workOrderId) REFERENCES work_orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      expirationTime INTEGER,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
      ON push_subscriptions(userId);

    CREATE TABLE IF NOT EXISTS spare_parts (
      itemNo TEXT PRIMARY KEY,
      no TEXT,
      category TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      uom TEXT NOT NULL DEFAULT '',
      price REAL NOT NULL DEFAULT 0,
      partRank TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      stockRank TEXT NOT NULL DEFAULT '',
      minStock REAL NOT NULL DEFAULT 0,
      maxStock REAL NOT NULL DEFAULT 0,
      searchName TEXT NOT NULL DEFAULT '',
      openingStock REAL NOT NULL DEFAULT 0,
      currentStock REAL NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT '',
      supplier TEXT NOT NULL DEFAULT '',
      supplier1 TEXT NOT NULL DEFAULT '',
      supplier2 TEXT NOT NULL DEFAULT '',
      supplier3 TEXT NOT NULL DEFAULT '',
      leadTime TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS spare_suppliers (
      id TEXT PRIMARY KEY,
      no TEXT,
      category TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      supplier TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      pic TEXT NOT NULL DEFAULT '',
      contactNo TEXT NOT NULL DEFAULT '',
      faxNo TEXT NOT NULL DEFAULT '',
      autoDial TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stock_movements (
      id TEXT PRIMARY KEY,
      itemNo TEXT NOT NULL,
      workOrderId TEXT,
      actorId TEXT NOT NULL,
      type TEXT NOT NULL,
      quantity REAL NOT NULL,
      beforeStock REAL NOT NULL,
      afterStock REAL NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL,
      syncStatus TEXT NOT NULL,
      syncError TEXT,
      syncedAt TEXT,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (itemNo) REFERENCES spare_parts(itemNo),
      FOREIGN KEY (workOrderId) REFERENCES work_orders(id),
      FOREIGN KEY (actorId) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS spare_sync_attempts (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS spare_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS work_order_sync_queue (
      workOrderId TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      lastError TEXT,
      queuedAt TEXT NOT NULL,
      syncedAt TEXT,
      webhookPending INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (workOrderId) REFERENCES work_orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS work_order_sync_deletions (
      workOrderNumber TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      lastError TEXT,
      queuedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS work_order_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS external_work_orders (
      plantId TEXT NOT NULL DEFAULT 'port-klang' CHECK (plantId IN ('port-klang', 'sendayan')),
      source TEXT NOT NULL,
      externalId TEXT NOT NULL,
      workOrderId TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      PRIMARY KEY (plantId, source, externalId),
      UNIQUE (workOrderId),
      FOREIGN KEY (workOrderId) REFERENCES work_orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS air_leak_sync_queue (
      workOrderId TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      lastError TEXT,
      queuedAt TEXT NOT NULL,
      syncedAt TEXT,
      FOREIGN KEY (workOrderId) REFERENCES work_orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS work_order_counters (
      counterKey TEXT PRIMARY KEY,
      value INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pm_checklist_templates (
      id TEXT PRIMARY KEY,
      machineName TEXT NOT NULL,
      title TEXT NOT NULL,
      documentNumber TEXT NOT NULL DEFAULT '',
      revisionNumber TEXT NOT NULL DEFAULT '',
      effectiveDate TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1,
      active INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pm_checklist_items (
      id TEXT PRIMARY KEY,
      templateId TEXT NOT NULL,
      sortOrder INTEGER NOT NULL,
      groupName TEXT NOT NULL,
      description TEXT NOT NULL,
      specification TEXT NOT NULL,
      inspectionMethod TEXT NOT NULL,
      frequency TEXT NOT NULL,
      dataType TEXT NOT NULL,
      maintenanceType TEXT NOT NULL,
      required INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (templateId) REFERENCES pm_checklist_templates(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS pm_plans (
      id TEXT PRIMARY KEY,
      mainMachine TEXT NOT NULL,
      machineName TEXT NOT NULL,
      frequencyLabel TEXT NOT NULL,
      frequencyMonths INTEGER NOT NULL DEFAULT 1,
      occurrencesPerMonth INTEGER NOT NULL DEFAULT 1,
      technicianId TEXT NOT NULL,
      technicianName TEXT NOT NULL,
      templateId TEXT,
      startMonth INTEGER NOT NULL DEFAULT 1,
      weekOfMonth INTEGER NOT NULL DEFAULT 1,
      secondaryWeek INTEGER,
      active INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (technicianId) REFERENCES users(id),
      FOREIGN KEY (templateId) REFERENCES pm_checklist_templates(id)
    );

    CREATE TABLE IF NOT EXISTS pm_schedules (
      id TEXT PRIMARY KEY,
      planId TEXT NOT NULL,
      scheduledDate TEXT NOT NULL,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      weekOfMonth INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'scheduled',
      startedAt TEXT,
      submittedAt TEXT,
      verifiedAt TEXT,
      verifiedById TEXT,
      remarks TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      UNIQUE(planId, year, month, weekOfMonth),
      FOREIGN KEY (planId) REFERENCES pm_plans(id) ON DELETE CASCADE,
      FOREIGN KEY (verifiedById) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS pm_results (
      id TEXT PRIMARY KEY,
      scheduleId TEXT NOT NULL,
      itemId TEXT NOT NULL,
      resultCode TEXT,
      readingValue TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      completedAt TEXT,
      updatedById TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      UNIQUE(scheduleId, itemId),
      FOREIGN KEY (scheduleId) REFERENCES pm_schedules(id) ON DELETE CASCADE,
      FOREIGN KEY (itemId) REFERENCES pm_checklist_items(id),
      FOREIGN KEY (updatedById) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS pm_result_photos (
      id TEXT PRIMARY KEY,
      scheduleId TEXT NOT NULL,
      itemId TEXT NOT NULL,
      uploadedBy TEXT NOT NULL,
      originalName TEXT NOT NULL,
      mimeType TEXT NOT NULL,
      size INTEGER NOT NULL,
      data BLOB NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (scheduleId) REFERENCES pm_schedules(id) ON DELETE CASCADE,
      FOREIGN KEY (uploadedBy) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_work_orders_status ON work_orders(status);
    CREATE INDEX IF NOT EXISTS idx_work_orders_requester ON work_orders(requesterId);
    CREATE INDEX IF NOT EXISTS idx_work_orders_assigned ON work_orders(assignedToId);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(userId, readAt);
    CREATE INDEX IF NOT EXISTS idx_machines_section ON machines(sectionId);
    CREATE INDEX IF NOT EXISTS idx_assets_condition ON assets(condition, assetNo);
    CREATE INDEX IF NOT EXISTS idx_assets_name ON assets(name);
    CREATE INDEX IF NOT EXISTS idx_spare_parts_category ON spare_parts(category);
    CREATE INDEX IF NOT EXISTS idx_spare_parts_search ON spare_parts(searchName);
    CREATE INDEX IF NOT EXISTS idx_stock_movements_item ON stock_movements(itemNo, createdAt);
    CREATE INDEX IF NOT EXISTS idx_stock_movements_sync ON stock_movements(syncStatus, createdAt);
    CREATE INDEX IF NOT EXISTS idx_pm_items_template ON pm_checklist_items(templateId, sortOrder);
    CREATE INDEX IF NOT EXISTS idx_pm_plans_technician ON pm_plans(technicianId, active);
    CREATE INDEX IF NOT EXISTS idx_pm_schedules_date ON pm_schedules(scheduledDate, status);
    CREATE INDEX IF NOT EXISTS idx_pm_results_schedule ON pm_results(scheduleId);
    CREATE INDEX IF NOT EXISTS idx_pm_photos_result ON pm_result_photos(scheduleId, itemId, createdAt);
    CREATE INDEX IF NOT EXISTS idx_work_order_sync_status ON work_order_sync_queue(status, queuedAt);
    CREATE INDEX IF NOT EXISTS idx_work_order_sync_deletions_status ON work_order_sync_deletions(status, queuedAt);
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(userId, expiresAt);
    CREATE INDEX IF NOT EXISTS idx_air_leak_sync_status ON air_leak_sync_queue(status, queuedAt);
  `);

  const userColumns = rows<{ name: string }>(db.prepare("PRAGMA table_info(users)").all());
  if (!userColumns.some((column) => column.name === "username")) {
    db.exec("ALTER TABLE users ADD COLUMN username TEXT");
  }
  if (!userColumns.some((column) => column.name === "avatarUrl")) {
    db.exec("ALTER TABLE users ADD COLUMN avatarUrl TEXT");
  }
  if (!userColumns.some((column) => column.name === "passwordHash")) {
    db.exec("ALTER TABLE users ADD COLUMN passwordHash TEXT");
  }
  if (!userColumns.some((column) => column.name === "passwordSalt")) {
    db.exec("ALTER TABLE users ADD COLUMN passwordSalt TEXT");
  }
  if (!userColumns.some((column) => column.name === "active")) {
    db.exec("ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1");
  }

  const workOrderColumns = rows<{ name: string }>(db.prepare("PRAGMA table_info(work_orders)").all());
  addWorkOrderColumnIfMissing(workOrderColumns, "workDate", "TEXT");
  addWorkOrderColumnIfMissing(workOrderColumns, "shiftGroup", "TEXT");
  addWorkOrderColumnIfMissing(workOrderColumns, "sectionId", "TEXT");
  addWorkOrderColumnIfMissing(workOrderColumns, "machineId", "TEXT");
  addWorkOrderColumnIfMissing(workOrderColumns, "area", "TEXT NOT NULL DEFAULT ''");
  addWorkOrderColumnIfMissing(workOrderColumns, "machineName", "TEXT");
  addWorkOrderColumnIfMissing(workOrderColumns, "reportedByName", "TEXT");
  addWorkOrderColumnIfMissing(workOrderColumns, "reportedByDepartment", "TEXT");
  addWorkOrderColumnIfMissing(workOrderColumns, "responsibleDepartment", "TEXT NOT NULL DEFAULT 'Production'");
  addWorkOrderColumnIfMissing(workOrderColumns, "issueCategoryId", "TEXT");
  addWorkOrderColumnIfMissing(workOrderColumns, "issueCategoryName", "TEXT NOT NULL DEFAULT ''");
  addWorkOrderColumnIfMissing(workOrderColumns, "issueDescription", "TEXT");
  addWorkOrderColumnIfMissing(workOrderColumns, "maintenanceActualMinutes", "INTEGER");
  addWorkOrderColumnIfMissing(workOrderColumns, "productionDowntimeReason", "TEXT");
  addWorkOrderColumnIfMissing(workOrderColumns, "supportingTechnicianIds", "TEXT NOT NULL DEFAULT '[]'");

  db.prepare("UPDATE work_orders SET workDate = COALESCE(workDate, substr(createdAt, 1, 10)) WHERE workDate IS NULL").run();
  db.prepare("UPDATE work_orders SET shiftGroup = COALESCE(shiftGroup, 'A') WHERE shiftGroup IS NULL").run();
  db.prepare("UPDATE work_orders SET machineName = COALESCE(machineName, assetName, 'Others') WHERE machineName IS NULL").run();
  db.prepare("UPDATE work_orders SET reportedByName = COALESCE(reportedByName, 'Requester') WHERE reportedByName IS NULL").run();
  db.prepare("UPDATE work_orders SET reportedByDepartment = COALESCE(reportedByDepartment, 'Production') WHERE reportedByDepartment IS NULL").run();
  db.prepare(`
    UPDATE work_orders SET responsibleDepartment = CASE
      WHEN lower(trim(reportedByDepartment)) IN ('logistic', 'logistics') THEN 'Logistic'
      WHEN lower(trim(reportedByDepartment)) = 'production' THEN 'Production'
      WHEN lower(trim(reportedByDepartment)) IN ('she', 'safety', 'safety, health and environment', 'safety health and environment') THEN 'SHE'
      WHEN lower(trim(reportedByDepartment)) IN ('dtu', 'digital transformation unit') THEN 'DTU'
      WHEN lower(trim(reportedByDepartment)) IN ('r&d', 'research and development') THEN 'R&D'
      WHEN lower(trim(reportedByDepartment)) IN ('account', 'accounts', 'finance') THEN 'Account'
      WHEN lower(trim(reportedByDepartment)) = 'management' THEN 'Management'
      WHEN lower(trim(reportedByDepartment)) = 'business development' THEN 'Business Development'
      ELSE COALESCE(NULLIF(responsibleDepartment, ''), 'Production')
    END
    WHERE responsibleDepartment IS NULL OR responsibleDepartment = ''
  `).run();
  db.prepare("UPDATE work_orders SET responsibleDepartment = 'Logistic' WHERE responsibleDepartment = 'Logistics'").run();
  db.prepare("UPDATE work_orders SET shiftGroup = 'N/A' WHERE responsibleDepartment <> 'Production'").run();
  db.prepare("UPDATE work_orders SET issueDescription = COALESCE(issueDescription, description, title) WHERE issueDescription IS NULL").run();
  db.prepare(`UPDATE work_orders SET issueCategoryName = COALESCE(
    NULLIF(issueCategoryName, ''),
    (SELECT name FROM issue_categories WHERE issue_categories.id = work_orders.issueCategoryId),
    'Other'
  ) WHERE issueCategoryName IS NULL OR issueCategoryName = ''`).run();
  db.prepare("UPDATE work_orders SET area = COALESCE(NULLIF(area, ''), location, '') WHERE area IS NULL OR area = ''").run();
  db.prepare("UPDATE work_orders SET type = 'maintenance' WHERE type = 'standard_maintenance'").run();

  const machineColumns = rows<{ name: string }>(db.prepare("PRAGMA table_info(machines)").all());
  if (!machineColumns.some((column) => column.name === "area")) {
    db.exec("ALTER TABLE machines ADD COLUMN area TEXT NOT NULL DEFAULT ''");
  }
  if (!machineColumns.some((column) => column.name === "department")) {
    db.exec("ALTER TABLE machines ADD COLUMN department TEXT NOT NULL DEFAULT 'Production'");
  }
  const sectionColumns = rows<{ name: string }>(db.prepare("PRAGMA table_info(sections)").all());
  if (!sectionColumns.some((column) => column.name === "department")) {
    db.exec("ALTER TABLE sections ADD COLUMN department TEXT NOT NULL DEFAULT 'Production'");
  }
  const issueCategoryColumns = rows<{ name: string }>(db.prepare("PRAGMA table_info(issue_categories)").all());
  if (!issueCategoryColumns.some((column) => column.name === "department")) {
    db.exec("ALTER TABLE issue_categories ADD COLUMN department TEXT NOT NULL DEFAULT 'Production'");
  }
  const workOrderSyncColumns = rows<{ name: string }>(db.prepare("PRAGMA table_info(work_order_sync_queue)").all());
  if (!workOrderSyncColumns.some((column) => column.name === "webhookPending")) {
    db.exec("ALTER TABLE work_order_sync_queue ADD COLUMN webhookPending INTEGER NOT NULL DEFAULT 0");
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_work_orders_work_date ON work_orders(workDate);
    CREATE INDEX IF NOT EXISTS idx_work_orders_section ON work_orders(sectionId);
    CREATE INDEX IF NOT EXISTS idx_work_orders_machine ON work_orders(machineId, machineName);
    CREATE INDEX IF NOT EXISTS idx_sections_department ON sections(department, active, name);
    CREATE INDEX IF NOT EXISTS idx_machines_department ON machines(department, active, name);
    CREATE INDEX IF NOT EXISTS idx_issue_categories_department ON issue_categories(department, active, name);
  `);
  migratePlants(db);
}

function addWorkOrderColumnIfMissing(columns: Array<{ name: string }>, name: string, definition: string) {
  if (!columns.some((column) => column.name === name)) {
    db.exec(`ALTER TABLE work_orders ADD COLUMN ${name} ${definition}`);
  }
}

export function seed() {
  let passwordOverrides: Record<string, string> = {};
  if (process.env.USER_PASSWORDS_JSON) {
    try {
      passwordOverrides = JSON.parse(process.env.USER_PASSWORDS_JSON) as Record<string, string>;
    } catch {
      throw new Error("USER_PASSWORDS_JSON must be a valid JSON object keyed by username.");
    }
    if (Object.values(passwordOverrides).some((password) => typeof password !== "string" || password.length < 12)) {
      throw new Error("Every USER_PASSWORDS_JSON password must contain at least 12 characters.");
    }
  }
  const users: Array<Omit<User, "plantAccess"> & { password: string }> = [
    { id: "u-requester-1", username: "nurul", name: "Nurul Aina", role: "requester", department: "Production", title: "Production Executive", avatarUrl: null, password: "requester123" },
    { id: "u-requester-2", username: "raj", name: "Raj Kumar", role: "requester", department: "Quality", title: "QA Engineer", avatarUrl: null, password: "requester123" },
    { id: publicRequesterId, username: "public-requester", name: "Requester Kiosk", role: "requester", department: "Shop Floor", title: "Public Requester", avatarUrl: null, password: "requester123" },
    { id: "u-tech-1", username: "hafiz", name: "Hafiz Rahman", role: "technician", department: "Maintenance", title: "Maintenance Technician", avatarUrl: null, password: "tech123" },
    { id: "u-tech-2", username: "kumar", name: "Kumar Velu", role: "technician", department: "Maintenance", title: "Senior Technician", avatarUrl: null, password: "tech123" },
    { id: "u-tech-fauzan", username: "fauzan", name: "Fauzan", role: "technician", department: "Maintenance", title: "Maintenance Technician", avatarUrl: null, password: "tech123" },
    { id: "u-tech-selvem", username: "selvem", name: "Selvem", role: "technician", department: "Maintenance", title: "Maintenance Technician", avatarUrl: null, password: "tech123" },
    { id: "u-tech-mustak", username: "mustak", name: "Mustak", role: "technician", department: "Maintenance", title: "Maintenance Technician", avatarUrl: null, password: "tech123" },
    { id: "u-tech-daryl", username: "daryl", name: "Daryl", role: "technician", department: "Maintenance", title: "Maintenance Technician", avatarUrl: null, password: "tech123" },
    { id: "u-tech-hazwan", username: "hazwan", name: "Hazwan", role: "technician", department: "Maintenance", title: "Maintenance Technician", avatarUrl: null, password: "tech123" },
    { id: "u-tech-ammar", username: "ammar", name: "Ammar", role: "technician", department: "Maintenance", title: "Maintenance Technician", avatarUrl: null, password: "tech123" },
    { id: "u-exec-1", username: "azlan", name: "Azlan Musa", role: "executive", department: "Maintenance", title: "Maintenance Executive", avatarUrl: null, password: "exec123" },
    { id: "u-admin-1", username: process.env.ADMIN_USERNAME?.trim() || "admin", name: "System Admin", role: "admin", department: "IT", title: "Administrator", avatarUrl: null, password: process.env.ADMIN_PASSWORD || "admin123" }
  ];
  if (process.env.DEVELOPER_PASSWORD) {
    users.push({
      id: "u-developer-1",
      username: process.env.DEVELOPER_USERNAME?.trim() || "developer",
      name: process.env.DEVELOPER_NAME?.trim() || "CMMS Developer",
      role: "developer",
      department: "Digital Transformation Unit",
      title: "System Developer",
      avatarUrl: null,
      password: process.env.DEVELOPER_PASSWORD
    });
  }
  users.forEach((user) => {
    const override = passwordOverrides[user.username];
    if (typeof override === "string" && override.length >= 12) user.password = override;
  });
  const userCount = row<{ count: number }>(db.prepare("SELECT COUNT(*) as count FROM users").get()).count;
  if (userCount === 0) {
    const insertUser = db.prepare("INSERT INTO users (id, username, name, role, department, title, avatarUrl, passwordHash, passwordSalt, plantAccess) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");

    for (const user of users) {
      const passwordRecord = createPasswordRecord(user.password);
      insertUser.run(user.id, user.username, user.name, user.role, user.department, user.title, user.avatarUrl, passwordRecord.passwordHash, passwordRecord.passwordSalt, ["admin", "developer"].includes(user.role) ? "both" : "port-klang");
    }
  } else {
    for (const user of users) {
      const existing = row<{ username: string | null; passwordHash: string | null; passwordSalt: string | null } | undefined>(
        db.prepare("SELECT username, passwordHash, passwordSalt FROM users WHERE id = ?").get(user.id)
      );
      if (!existing) {
        const passwordRecord = createPasswordRecord(user.password);
        db.prepare("INSERT INTO users (id, username, name, role, department, title, avatarUrl, passwordHash, passwordSalt, plantAccess) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .run(user.id, user.username, user.name, user.role, user.department, user.title, user.avatarUrl, passwordRecord.passwordHash, passwordRecord.passwordSalt, ["admin", "developer"].includes(user.role) ? "both" : "port-klang");
        continue;
      }

      const managedPassword = (user.id === "u-admin-1" && Boolean(process.env.ADMIN_PASSWORD)) || user.id === "u-developer-1" || Boolean(passwordOverrides[user.username]);
      if (managedPassword) {
        const passwordRecord = createPasswordRecord(user.password);
        db.prepare(`
          UPDATE users SET username = ?, name = ?, role = ?, department = ?, title = ?,
            passwordHash = ?, passwordSalt = ? WHERE id = ?
        `).run(user.username, user.name, user.role, user.department, user.title, passwordRecord.passwordHash, passwordRecord.passwordSalt, user.id);
        continue;
      }

      const passwordRecord = !existing.passwordHash || !existing.passwordSalt ? createPasswordRecord(user.password) : null;
      db.prepare(`
        UPDATE users
        SET username = COALESCE(username, ?),
            passwordHash = COALESCE(passwordHash, ?),
            passwordSalt = COALESCE(passwordSalt, ?)
        WHERE id = ?
      `).run(user.username, passwordRecord?.passwordHash || existing.passwordHash, passwordRecord?.passwordSalt || existing.passwordSalt, user.id);
    }
  }

  seedMasterData();
  seedProductionAssets();
  seedPmData();

  db.prepare(`
    INSERT OR IGNORE INTO work_order_sync_queue (plantId, workOrderId, status, attempts, lastError, queuedAt, syncedAt)
    SELECT plantId, id, 'pending', 0, NULL, updatedAt, NULL FROM scoped_work_orders
  `).run();
}

function seedMasterData() {
  const timestamp = now();
  const insertSection = db.prepare("INSERT OR IGNORE INTO sections (plantId, id, department, name, active, createdAt, updatedAt) VALUES (cmms_write_plant(), ?, 'Production', ?, ?, ?, ?)");
  insertSection.run(defaultSectionIds.conversion, "Conversion", 1, timestamp, timestamp);
  insertSection.run(defaultSectionIds.rollMaking, "Roll Making", 1, timestamp, timestamp);

  const productionMachines: Array<[string, string, string]> = [
    ["Conversion", "Waterjet", "WJ 7A"], ["Conversion", "Waterjet", "WJ 1"],
    ["Conversion", "Waterjet", "WJ 2A"], ["Conversion", "Waterjet", "WJ 2B"],
    ["Conversion", "Waterjet", "WJ 3A"], ["Conversion", "Waterjet", "WJ 3B"],
    ["Conversion", "Waterjet", "WJ 4A"], ["Conversion", "Waterjet", "WJ 4B"],
    ["Conversion", "Forming", "F4"], ["Conversion", "Waterjet", "WJ 7B"],
    ["Conversion", "Forming", "F5"], ["Conversion", "Forming", "F6"],
    ["Conversion", "Forming", "F7"], ["Conversion", "Oven", "OVEN 4"],
    ["Conversion", "Oven", "OVEN 5"], ["Conversion", "Oven", "MINI OVEN 1"],
    ["Conversion", "Oven", "MINI OVEN 2"], ["Conversion", "Forming", "MINI OVEN 3"],
    ["Conversion", "Forming", "MINI F1"], ["Conversion", "Forming", "MINI F2"],
    ["Conversion", "Forming", "MINI F3"], ["Conversion", "Forming", "MINI F4"],
    ["Conversion", "Forming", "MINI F5"], ["Conversion", "Forming", "MINI F6"],
    ["Conversion", "Hotmelt", "HOTMELT NORDSON"], ["Conversion", "Hotmelt", "HOTMELT NDC"],
    ["Conversion", "Hotmelt", "HOTMELT DYNATEC"], ["Conversion", "Autoglue", "GLUE TANK"],
    ["Conversion", "Autoglue", "PRESS JIGS"], ["Conversion", "Others", "OTHERS"],
    ["Conversion", "Pump", "PUMP 30HP"], ["Conversion", "Pump", "PUMP 50HP(SL-IV)"],
    ["Conversion", "Pump", "PUMP 60HP"], ["Conversion", "Pump", "PUMP 100HP"],
    ["Conversion", "Pump", "PUMP 50HP(JETLINE)"], ["Conversion", "Forming", "MINI F7"],
    ["Conversion", "FLOOR CARPET", "WATERJET"], ["Conversion", "FLOOR CARPET", "AUTO GLUE (2)"],
    ["Conversion", "MF", "MINI OVEN 4"], ["Roll Making", "General", "4 MTR"],
    ["Roll Making", "General", "2 MTR"], ["Roll Making", "General", "PE 1"],
    ["Roll Making", "General", "PE 2"], ["Roll Making", "General", "DILLO"],
    ["Roll Making", "General", "LATEX"], ["Roll Making", "General", "HOT ROLLER"],
    ["Roll Making", "General", "MINI PRESS CUT"], ["Roll Making", "General", "PE MIXER"],
    ["Roll Making", "General", "HOT PRESS"], ["Conversion", "LM", "PRESS CUT"]
  ];
  const insertMachine = db.prepare("INSERT OR IGNORE INTO machines (plantId, id, department, sectionId, area, name, active, createdAt, updatedAt) VALUES (cmms_write_plant(), ?, 'Production', ?, ?, ?, 1, ?, ?)");
  const findMachine = db.prepare("SELECT id FROM scoped_machines WHERE sectionId = ? AND lower(name) = lower(?) ORDER BY createdAt, id");
  const activateMachine = db.prepare("UPDATE machines SET area = ?, active = 1, updatedAt = ? WHERE id = ?");
  const deactivateMachine = db.prepare("UPDATE machines SET active = 0, updatedAt = ? WHERE id = ?");
  productionMachines.forEach(([sectionName, area, machineName], index) => {
    const sectionId = sectionName === "Roll Making" ? defaultSectionIds.rollMaking : defaultSectionIds.conversion;
    const matches = rows<{ id: string }>(findMachine.all(sectionId, machineName));
    if (matches.length === 0) {
      insertMachine.run(`machine-production-${String(index + 1).padStart(3, "0")}`, sectionId, area, machineName, timestamp, timestamp);
      return;
    }
    activateMachine.run(area, timestamp, matches[0].id);
    matches.slice(1).forEach((duplicate) => deactivateMachine.run(timestamp, duplicate.id));
  });
  db.prepare("UPDATE machines SET active = 0, updatedAt = ? WHERE id IN ('machine-conversion-1', 'machine-conversion-2', 'machine-roll-making-1')")
    .run(timestamp);

  const productionIssueCategories = [
    "JOINT / FITTING", "HOSE ABB", "COIL", "ON / OFF", "VACUUM", "VALVE", "FILTER", "HEATER",
    "NOT PRESSING", "PRESS SLOW", "CHILLER", "HOSE FMG", "SENSOR / LIMIT SWITCH", "WINCH CABLE / MOTOR",
    "BUTTON", "NOT PRESS", "HYDRAULIC PUMP NG", "SCISSOR JACK NG", "BOLSTER ISSUE", "PLC", "CLAMP DAMAGE",
    "STOPPER", "PUMP ABB", "LEAKING", "ABSORBER ABB", "COOLING TIMER NG", "FILTER NOZZLE", "HEATER DAMAGE",
    "TRIP", "AUTO SYSTEM NG", "HOSE FORMING", "COBOT", "MOLD DAMAGE", "HOTMELT GLUE", "OIL LEAKING",
    "EMERGENCY BUTTON", "JETLINE 50 HP"
  ];
  const insertIssueCategory = db.prepare("INSERT OR IGNORE INTO issue_categories (plantId, id, department, name, active, createdAt, updatedAt) VALUES (cmms_write_plant(), ?, 'Production', ?, 1, ?, ?)");
  const findIssueCategory = db.prepare("SELECT id FROM scoped_issue_categories WHERE lower(name) = lower(?) LIMIT 1");
  const activateIssueCategory = db.prepare("UPDATE issue_categories SET active = 1, updatedAt = ? WHERE id = ?");
  productionIssueCategories.forEach((name, index) => {
    const existing = row<{ id: string } | undefined>(findIssueCategory.get(name));
    if (existing) {
      activateIssueCategory.run(timestamp, existing.id);
    } else {
      insertIssueCategory.run(`issue-category-production-${String(index + 1).padStart(3, "0")}`, name, timestamp, timestamp);
    }
  });
  insertIssueCategory.run(otherIssueCategoryId, "Other", timestamp, timestamp);
  db.prepare("INSERT OR IGNORE INTO issue_categories (plantId, id, department, name, active, createdAt, updatedAt) VALUES (cmms_write_plant(), 'issue-category-she-air-leak', 'SHE', 'Air Leak', 1, ?, ?)")
    .run(timestamp, timestamp);
  db.prepare("UPDATE OR IGNORE issue_categories SET name = 'Other', active = 1, updatedAt = ? WHERE id = ?")
    .run(timestamp, otherIssueCategoryId);
  const duplicateCategoryAliases = [
    "ASORBER ABB", "HYDARULIC PUMP NG", "JOINT/FITTING", "ON OFF", "OTHERS", "SENSOR/LIMIT SWITCH",
    "VACCUM", "WINCH CABLE/MOTOR"
  ];
  const deactivateIssueCategory = db.prepare("UPDATE issue_categories SET active = 0, updatedAt = ? WHERE lower(name) = lower(?)");
  duplicateCategoryAliases.forEach((alias) => deactivateIssueCategory.run(timestamp, alias));
  db.prepare("UPDATE issue_categories SET active = 1, updatedAt = ? WHERE lower(name) = lower('Other')")
    .run(timestamp);
}

function seedProductionAssets() {
  const timestamp = now();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO assets (plantId,
      id, assetNo, name, serialNo, yearText, installDateText, warranty, manufacturer,
      supplier, contactPerson, telephone, fax, condition, criticality, location, notes,
      source, createdAt, updatedAt
    ) VALUES (cmms_write_plant(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const asset of productionAssets2026) {
    const [assetNo, name, serialNo, yearText, installDateText, warranty, manufacturer, supplier, contactPerson, telephone, fax] = asset;
    const condition: AssetCondition = warranty.toLowerCase().includes("obs") ? "obsolete" : "operational";
    const criticality: AssetCriticality = /robot|pump|compressor|air comp|carding|forming|oven|breaker|dilo|dryer|coating/i.test(name)
      ? "high"
      : "medium";
    const notes = assetNo === 46 ? "Source note: sent to SDYN on 22/5/2025." : "";
    insert.run(
      `asset-${String(assetNo).padStart(3, "0")}`,
      assetNo,
      name,
      serialNo,
      yearText,
      installDateText,
      warranty,
      manufacturer,
      supplier,
      contactPerson,
      telephone,
      fax,
      condition,
      criticality,
      "Production",
      notes,
      "FR-MT-008 / Production Machine Register 2026",
      timestamp,
      timestamp
    );
  }

  // Correct untouched seed rows where the source uses the warranty column as a disposition flag.
  db.prepare(`
    UPDATE assets
    SET condition = 'obsolete'
    WHERE lower(warranty) LIKE '%obs%'
      AND condition = 'operational'
      AND updatedAt = createdAt
  `).run();
}

type SeedPmChecklistItem = [
  string,
  string,
  string,
  string,
  string,
  PmChecklistItem["dataType"],
  PmChecklistItem["maintenanceType"]
];

function seedPmChecklistTemplate(input: {
  id: string;
  machineName: string;
  title?: string;
  documentNumber?: string;
  revisionNumber?: string;
  effectiveDate?: string;
  itemIdPrefix: string;
  items: SeedPmChecklistItem[];
}, timestamp: string) {
  const inserted = db.prepare(`
    INSERT OR IGNORE INTO pm_checklist_templates (plantId,
      id, machineName, title, documentNumber, revisionNumber, effectiveDate, version, active, createdAt, updatedAt
    ) VALUES (cmms_write_plant(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.id,
    input.machineName,
    input.title || "Preventive & Predictive Maintenance Checklist",
    input.documentNumber || "FR-MT-002",
    input.revisionNumber || "5",
    input.effectiveDate || "2025-02-03",
    1,
    1,
    timestamp,
    timestamp
  );

  // Seed only once so later user edits (including deleted items) remain authoritative.
  if (inserted.changes === 0) return;

  const insertItem = db.prepare(`
    INSERT INTO pm_checklist_items (plantId,
      id, templateId, sortOrder, groupName, description, specification, inspectionMethod,
      frequency, dataType, maintenanceType, required
    ) VALUES (cmms_write_plant(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);
  input.items.forEach((item, index) => {
    insertItem.run(`${input.itemIdPrefix}-${index + 1}`, input.id, index + 1, ...item);
  });
}

function seedPmData() {
  const timestamp = now();
  const templateId = "pm-template-forming-6";

  const checklistItems: SeedPmChecklistItem[] = [
    ["Pump & Motor", "Ensure the hydraulic pump and motor are functioning properly.", "Hydraulic pump and motor are functioning properly.", "Visual / Testing", "Monthly", "marking", "preventive"],
    ["Pump & Motor", "Check and ensure oil level is maintained accordingly.", "Oil level should be at high level.", "Visual", "Monthly", "marking", "preventive"],
    ["Pump & Motor", "Check for any oil leakages.", "No leakages.", "Visual", "Monthly", "marking", "predictive"],
    ["Piston Rod", "Inspect and ensure smooth travel of the piston rod.", "Smooth and unrestricted movement of the piston rod.", "Visual", "Monthly", "marking", "preventive"],
    ["Control System", "Check the control circuit and limit switch, including the solenoid valve.", "All fully functional.", "Visual", "Monthly", "marking", "preventive"],
    ["Control System", "Ensure the photo sensor, safety sensor, and pitch roller are functioning properly.", "All fully functional.", "Visual", "Monthly", "marking", "preventive"],
    ["Control System", "Verify air pressure gauge readings.", "5 - 6 Bar", "Visual", "Monthly", "value", "predictive"],
    ["Conveyor Chain", "Check the conveyor chain drive motor and gearbox oil level.", "Good condition.", "Visual", "Monthly", "marking", "preventive"],
    ["Conveyor Chain", "Ensure the grease pump is functioning properly.", "Good condition.", "Visual", "Monthly", "marking", "preventive"],
    ["Conveyor Chain", "Inspect all carpet clamps and springs for damage or broken parts.", "Carpet clamps and springs are intact and functional.", "Visual", "Monthly", "marking", "preventive"],
    ["Conveyor Chain", "Inspect oven mounting and FWD/REV spur gear for proper function.", "Good condition.", "Visual", "Monthly", "marking", "preventive"],
    ["Oven Heater & Thermocouple", "Inspect the heaters for loose connections and ensure they are secured to the frame.", "Heater elements and connections are secure and functional.", "Visual", "Monthly", "marking", "preventive"],
    ["Oven Heater & Thermocouple", "Inspect the control panel for loose connections or damaged wires.", "No loose connections, damaged wires or faulty indicators.", "Visual", "Monthly", "marking", "preventive"],
    ["Oven Heater & Thermocouple", "Inspect heater wire, ceramic insulator and thermocouple wiring arrangement.", "No loose connection and in good condition.", "Visual", "Monthly", "marking", "preventive"],
    ["Lubrication & Safety", "Apply greasing at the bushing and ensure the mould frame is secured to the cylinder lock nut.", "Greased and mould is secure.", "Testing", "Monthly", "marking", "preventive"],
    ["Lubrication & Safety", "Check safety bar and ensure it is functioning properly.", "All fully functional.", "Testing", "Monthly", "marking", "preventive"],
    ["Chiller", "Inspect the high/low-pressure gauge to ensure it is within range.", "Within the green range.", "Visual", "Monthly", "marking", "predictive"],
    ["Chiller", "Check the control panel indicator light functionality.", "No faulty error and fully functional.", "Visual", "Monthly", "marking", "preventive"],
    ["Chiller", "Inspect the copper pipe condition for leaks or damages.", "No gas leaks or broken pipes.", "Visual / Testing", "Monthly", "marking", "predictive"],
    ["Chiller", "Clean condenser coils to ensure efficient heat exchange.", "In good condition and cleaned.", "Visual", "Monthly", "marking", "preventive"],
    ["Chiller", "Compare the set temperature with the actual temperature of the chiller.", "Actual temperature should align with the set point.", "Visual / Testing", "Monthly", "marking", "preventive"],
    ["Bolster", "Check the Bolster L-Bracket screw marking.", "Screw is aligned with the marking.", "Visual", "Monthly", "marking", "preventive"]
  ];
  seedPmChecklistTemplate({
    id: templateId,
    machineName: "Hydraulic Forming 6",
    itemIdPrefix: "pm-forming-6-item",
    items: checklistItems
  }, timestamp);

  const importedTemplates: Array<{
    id: string;
    machineName: string;
    itemIdPrefix: string;
    items: SeedPmChecklistItem[];
  }> = [
    {
      id: "pm-template-forming-7",
      machineName: "Hydraulic Forming 7",
      itemIdPrefix: "pm-forming-7-item",
      items: [
        ["Power Pack", "Ensure the hydraulic pump and motor are functioning properly.", "Hydraulic pump and motor are functioning properly.", "Visual / Testing", "Monthly", "marking", "preventive"],
        ["Power Pack", "Check and ensure oil level is maintained accordingly.", "Oil level should be at high level.", "Visual", "Monthly", "marking", "preventive"],
        ["Power Pack", "Check for any oil leakages.", "No leakages.", "Visual", "Monthly", "marking", "predictive"],
        ["Piston Rod", "Inspect and ensure smooth travel of the piston rod.", "Smooth and unrestricted movement of the piston rod.", "Visual", "Monthly", "marking", "preventive"],
        ["Control System", "Check the control circuit and limit switch, including the solenoid valve.", "All fully functional.", "Visual", "Monthly", "marking", "preventive"],
        ["Control System", "Ensure the photo sensor, safety sensor, and pitch roller are functioning properly.", "All fully functional.", "Visual", "Monthly", "marking", "preventive"],
        ["Control System", "Verify air pressure gauge readings.", "5 - 6 Bar", "Visual", "Monthly", "value", "predictive"],
        ["Conveyor Chain", "Check the conveyor chain drive motor and gearbox oil level.", "Good condition.", "Visual", "Monthly", "marking", "preventive"],
        ["Conveyor Chain", "Ensure the grease pump is functioning properly.", "Good condition.", "Visual", "Monthly", "marking", "preventive"],
        ["Conveyor Chain", "Inspect all carpet clamps and springs for damage or broken parts.", "Carpet clamps and springs are intact and functional.", "Visual", "Monthly", "marking", "preventive"],
        ["Conveyor Chain", "Inspect oven mounting and FWD/REV spur gear for proper function.", "Good condition.", "Visual", "Monthly", "marking", "preventive"],
        ["Oven Heater", "Inspect the heaters for loose connections and ensure they are secured to the frame.", "Heater elements and connections are secure and functional.", "Visual", "Monthly", "marking", "preventive"],
        ["Oven Heater", "Inspect the control panel for loose connections or damaged wires.", "No loose connections, damaged wires or faulty indicators.", "Visual", "Monthly", "marking", "preventive"],
        ["Oven Heater", "Inspect the wiring system for loose connections, neatness, and proper arrangement.", "No loose connections and in good condition.", "Visual", "Monthly", "marking", "preventive"],
        ["Lubrication & Safety", "Apply greasing at the bushing and ensure the mould frame is secured to the cylinder lock nut.", "Greased and mould is secure.", "Testing", "Monthly", "marking", "preventive"],
        ["Chiller", "Inspect the high/low-pressure gauge to ensure it is within range.", "Within the green range.", "Visual", "Monthly", "marking", "predictive"],
        ["Chiller", "Check the control panel indicator light functionality.", "No faulty error and fully functional.", "Visual", "Monthly", "marking", "preventive"],
        ["Chiller", "Inspect the copper pipe condition for leaks or damages.", "No gas leaks or broken pipes.", "Visual / Testing", "Monthly", "marking", "predictive"],
        ["Chiller", "Clean condenser coils to ensure efficient heat exchange.", "In good condition and cleaned.", "Visual", "Monthly", "marking", "preventive"],
        ["Chiller", "Compare the set temperature with the actual temperature of the chiller.", "Actual temperature should align with the set point.", "Visual / Testing", "Monthly", "marking", "preventive"]
      ]
    },
    {
      id: "pm-template-carding-4m",
      machineName: "4 Meter Carding",
      itemIdPrefix: "pm-carding-4m-item",
      items: [
        ["Intake Roller", "Inspect metallic carding wire for cuts or damage.", "Free from cuts, bends, or damaged wire.", "Visual", "Twice per month", "marking", "preventive"],
        ["Intake Roller", "Check metal detector functionality.", "Fully functional and responsive.", "Functional test", "Twice per month", "marking", "preventive"],
        ["Intake Roller", "Check the main drive motor gearbox, bearing, and V-belt condition.", "No abnormal wear, vibration, or leakage.", "Visual / Listening", "Twice per month", "marking", "preventive"],
        ["Main Drive", "Inspect gearbox and motor conditions.", "No overheating, abnormal noise, or oil leak.", "Visual / IR thermometer (<65°C)", "Twice per month", "marking", "preventive"],
        ["Main Drive", "Check pulley and belt for wear, tears, or cuts.", "Correct belt tension with no cracks or wear.", "Visual / Belt tension gauge", "Twice per month", "marking", "preventive"],
        ["Roller Stripper, Doffer, Worker, Big Drum & Intake Drum", "Inspect metallic carding wire for cuts or damage.", "Free from cuts or damage.", "Visual", "Twice per month", "marking", "preventive"],
        ["Roller Stripper, Doffer, Worker, Big Drum & Intake Drum", "Check all roller settings and sprocket alignment.", "Within machine standards.", "Visual / Refer to setting standard", "Twice per month", "marking", "preventive"],
        ["Roller Stripper, Doffer, Worker, Big Drum & Intake Drum", "Ensure all roller bearings are lubricated and greased.", "Lubricated with smooth rotation.", "Visual / Sound", "Twice per month", "marking", "preventive"],
        ["Roller Stripper, Doffer, Worker, Big Drum & Intake Drum", "Check roller gap settings.", "Follow approved setting.", "Visual", "Twice per month", "marking", "preventive"],
        ["Roller Stripper, Doffer, Worker, Big Drum & Intake Drum", "Check chain tension.", "In good condition.", "Visual / Feel", "Twice per month", "marking", "preventive"],
        ["Roller Stripper, Doffer, Worker, Big Drum & Intake Drum", "Inspect wire condition.", "In good condition.", "Visual", "Twice per month", "marking", "preventive"],
        ["Roller Stripper, Doffer, Worker, Big Drum & Intake Drum", "Check roller-bearing temperature using an IR thermometer.", "35°C - 45°C", "Testing / IR thermometer", "Twice per month", "value", "predictive"],
        ["Abnormal Sound", "Observe for rubbing, knocking, or frictional sounds.", "No abnormal sound.", "Testing / Hearing", "Twice per month", "marking", "predictive"],
        ["Vacuum", "Inspect PVC pipes and hose connections for leaks or damage.", "No leaks or damage.", "Visual", "Twice per month", "marking", "preventive"],
        ["Vacuum", "Ensure the vacuum nozzle is functional and intact.", "In good condition.", "Visual / Feel test", "Twice per month", "marking", "preventive"],
        ["Centralized Auto Grease Pump", "Check grease level.", "Grease at optimum level.", "Visual", "Twice per month", "marking", "preventive"],
        ["Centralized Auto Grease Pump", "Check distributor condition and grease movement.", "In good condition and fully functional.", "Visual", "Twice per month", "marking", "preventive"],
        ["Centralized Auto Grease Pump", "Check the control-panel alarm.", "In good condition with no alarm.", "Visual", "Twice per month", "marking", "preventive"],
        ["Centralized Auto Grease Pump", "Check the control-panel timer.", "1 pump/hour.", "Visual", "Twice per month", "marking", "preventive"]
      ]
    },
    {
      id: "pm-template-waterjet-abb2-60hp",
      machineName: "Waterjet ABB2 & Intensifier Pump 60HP",
      itemIdPrefix: "pm-waterjet-abb2-item",
      items: [
        ["Control Panel", "Inspect cooling-fan and ventilation operation.", "Cooling fan functional with unobstructed airflow.", "Visual / Functional", "Every 2 months", "marking", "predictive"],
        ["Control Panel", "Inspect cable condition and terminal tightness.", "No loose connections or overheating.", "Visual", "Every 2 months", "marking", "predictive"],
        ["Teach Pendant", "Check teach-pendant functionality and physical condition.", "In good condition and fully functional.", "Visual", "Every 2 months", "marking", "predictive"],
        ["Nozzle & Hose", "Check the actuator for leaks.", "No leaks.", "Sound", "Every 2 months", "marking", "predictive"],
        ["Nozzle & Hose", "Check solenoid-valve condition.", "In good condition and fully functional.", "Visual / Testing", "Every 2 months", "marking", "preventive"],
        ["Nozzle & Hose", "Check hose and fitting condition.", "In good condition with no leaks.", "Visual / Sound", "Every 2 months", "marking", "preventive"],
        ["Filter", "Inspect the water filter for dirt particles or damage.", "Free from dirt particles and damage.", "Visual", "Every 2 months", "marking", "preventive"],
        ["High Pressure Piping", "Check the high-pressure pipe connector for leaks.", "No leaks.", "Visual", "Every 2 months", "marking", "preventive"],
        ["Shuttle", "Check shuttle condition for smooth movement.", "In good condition with no jerking movement.", "Visual", "Every 2 months", "marking", "preventive"],
        ["Shuttle", "Check the shuttle stopper and stopper lock nut.", "In good condition and functional.", "Check and test", "Every 2 months", "marking", "preventive"],
        ["Shuttle", "Check greasing on the rail and linear bearing.", "Lubricated with grease.", "Visual", "Every 2 months", "marking", "preventive"],
        ["Intensifier Pump 60HP", "Check the pump for abnormal noise.", "No abnormal sound.", "Visual / Sound", "Every 2 months", "marking", "predictive"],
        ["Intensifier Pump 60HP", "Check the pump for oil leaks.", "No oil leakages.", "Visual", "Every 2 months", "marking", "predictive"],
        ["Intensifier Pump 60HP", "Check the intensifier for water leaks.", "No leakages.", "Visual", "Every 2 months", "marking", "predictive"],
        ["Intensifier Pump 60HP", "Check the oil and water filters.", "Free from dirt particles.", "Visual", "Every 2 months", "marking", "preventive"],
        ["Intensifier Pump 60HP", "Check oil level above the minimum level.", "Oil at optimum level.", "Indicator", "Every 2 months", "marking", "preventive"],
        ["Intensifier Pump 60HP", "Check outgoing high-pressure water.", "40k - 50k psi", "Visual / Testing", "Every 2 months", "value", "predictive"],
        ["Intensifier Pump 60HP", "Check valve condition if pressure is abnormal.", "In good condition with no damage.", "Visual", "Every 2 months", "marking", "predictive"],
        ["Chiller", "Inspect the high/low-pressure gauge to ensure it is within range.", "Within the green range.", "Visual", "Every 2 months", "marking", "predictive"],
        ["Chiller", "Check the control-panel indicator light functionality.", "No faulty error and fully functional.", "Visual", "Every 2 months", "marking", "preventive"],
        ["Chiller", "Inspect the copper-pipe condition for leaks or damage.", "No gas leaks or broken pipes.", "Visual / Testing", "Every 2 months", "marking", "predictive"],
        ["Chiller", "Clean condenser coils to ensure efficient heat exchange.", "In good condition and cleaned.", "Visual", "Every 2 months", "marking", "preventive"],
        ["Chiller", "Compare the chiller set temperature with the actual temperature.", "Actual temperature should align with the set point.", "Visual / Testing", "Every 2 months", "marking", "predictive"]
      ]
    }
  ];
  importedTemplates.forEach((template) => {
    seedPmChecklistTemplate(template, timestamp);
  });

  const technicianIds: Record<string, string> = {
    Fauzan: "u-tech-fauzan",
    Selvem: "u-tech-selvem",
    Mustak: "u-tech-mustak",
    Daryl: "u-tech-daryl",
    Hazwan: "u-tech-hazwan",
    Ammar: "u-tech-ammar"
  };
  type SeedPlan = [string, string, string, number, number, string, number, number, number?];
  const plans: SeedPlan[] = [
    ["4 Meter NP", "Bale Opener 1,2", "Every 2 months", 2, 1, "Fauzan", 1, 1],
    ["4 Meter NP", "Pre/Main Breaker", "Every 2 months", 2, 1, "Fauzan", 1, 2],
    ["4 Meter NP", "Mix/Tower Hopper", "Every 2 months", 2, 1, "Fauzan", 1, 1],
    ["4 Meter NP", "Carding", "Twice per month", 1, 2, "Fauzan", 1, 1, 3],
    ["4 Meter NP", "Weave Layer", "Monthly", 1, 1, "Fauzan", 1, 3],
    ["4 Meter NP", "Pre/Reverse/Final", "Monthly", 1, 1, "Fauzan", 1, 1],
    ["Latex", "Latex Dryer and Hot Roller", "Every 2 months", 2, 1, "Selvem", 1, 1],
    ["2 Meter NP", "Bale Opener 1,2", "Every 3 months", 3, 1, "Fauzan", 1, 1],
    ["2 Meter NP", "Main Breaker", "Every 3 months", 3, 1, "Fauzan", 2, 1],
    ["2 Meter NP", "Vertical Breaker", "Every 3 months", 3, 1, "Fauzan", 2, 2],
    ["2 Meter NP", "Chutter", "Every 3 months", 3, 1, "Fauzan", 2, 3],
    ["2 Meter NP", "Carding", "Every 2 months", 2, 1, "Fauzan", 1, 2],
    ["2 Meter NP", "Weave Layer", "Every 2 months", 2, 1, "Fauzan", 1, 3],
    ["2 Meter NP", "Pre / Reverse / Final 1 / Final 2", "Every 2 months", 2, 1, "Fauzan", 1, 4],
    ["Patterning", "Dilo", "Every 2 months", 2, 1, "Mustak", 1, 2],
    ["PE", "PE 1", "Every 2 months", 2, 1, "Daryl", 1, 1],
    ["PE", "PE 2", "Every 2 months", 2, 1, "Daryl", 1, 2],
    ["Hot Press Roller", "Hot Press Roller", "Every 2 months", 2, 1, "Daryl", 1, 1],
    ["Forming", "Hydraulic Forming 4", "Every 6 months", 6, 1, "Selvem", 6, 3],
    ["Forming", "Hydraulic Forming 5", "Every 6 months", 6, 1, "Selvem", 6, 4],
    ["Forming", "Hydraulic Forming 6", "Monthly", 1, 1, "Selvem", 1, 2],
    ["Forming", "Hydraulic Forming 7", "Monthly", 1, 1, "Selvem", 1, 3],
    ["WaterJet", "Waterjet 2", "Every 2 months", 2, 1, "Hazwan", 1, 1],
    ["WaterJet", "Waterjet 3", "Every 2 months", 2, 1, "Hazwan", 1, 2],
    ["WaterJet", "Waterjet 4", "Every 2 months", 2, 1, "Hazwan", 1, 3],
    ["WaterJet", "Waterjet 7", "Every 2 months", 2, 1, "Hazwan", 1, 4],
    ["Intensifier Pump", "Intensifier Pump 30HP", "Every 2 months", 2, 1, "Hazwan", 1, 1],
    ["Intensifier Pump", "Intensifier Pump 60HP", "Every 2 months", 2, 1, "Hazwan", 1, 2],
    ["Intensifier Pump", "Intensifier Pump KMT 50HP (Old)", "Every 2 months", 2, 1, "Hazwan", 1, 3],
    ["Intensifier Pump", "Intensifier Pump KMT 50HP (New jetLine)", "Monthly", 1, 1, "Hazwan", 1, 1],
    ["Intensifier Pump", "Intensifier Pump KMT 50HP (ABB7)", "Monthly", 1, 1, "Hazwan", 1, 2],
    ["Mini Forming", "Mini Hydraulic Forming 1, 2, 3 & Oven 1", "Every 2 months", 2, 1, "Ammar", 1, 2],
    ["Mini Forming", "Mini Hydraulic Forming 4, 5, 6 & Oven 2", "Every 3 months", 3, 1, "Ammar", 1, 1],
    ["Mini Forming", "Mini Hydraulic Forming 7 & Oven 4", "Every 3 months", 3, 1, "Ammar", 2, 2],
    ["Press Cut Machine", "Press Cut Double Feeder", "Every 3 months", 3, 1, "Ammar", 1, 1],
    ["Air Compressor", "Kobelco (AG55A)-75HP", "Every 3 months", 3, 1, "Selvem", 1, 1],
    ["Air Compressor", "Kobelco (SG 1490A - 75)-100HP", "Every 3 months", 3, 1, "Selvem", 1, 2],
    ["Auto Hotmelt Glue", "Auto Hotmelt Glue (2D)(1)", "Every 3 months", 3, 1, "Ammar", 1, 1],
    ["Auto Hotmelt Glue", "Auto Hotmelt Glue (2D)(2)", "Every 3 months", 3, 1, "Ammar", 1, 2],
    ["Auto Hotmelt Glue", "Auto Hotmelt Glue (Cobolt)(1)", "Every 3 months", 3, 1, "Ammar", 1, 3],
    ["Auto Hotmelt Glue", "Auto Hotmelt Glue (Cobolt)(2)", "Every 3 months", 3, 1, "Ammar", 1, 4]
  ];
  const insertPlan = db.prepare(`
    INSERT OR IGNORE INTO pm_plans (plantId,
      id, mainMachine, machineName, frequencyLabel, frequencyMonths, occurrencesPerMonth,
      technicianId, technicianName, templateId, startMonth, weekOfMonth, secondaryWeek, active, createdAt, updatedAt
    ) VALUES (cmms_write_plant(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `);
  plans.forEach((plan, index) => {
    const [mainMachine, machineName, frequencyLabel, frequencyMonths, occurrencesPerMonth, technicianName, startMonth, weekOfMonth, secondaryWeek] = plan;
    const assignedTemplateId = machineName === "Hydraulic Forming 6"
      ? templateId
      : machineName === "Hydraulic Forming 7"
        ? "pm-template-forming-7"
        : mainMachine === "4 Meter NP" && machineName === "Carding"
          ? "pm-template-carding-4m"
          : machineName === "Waterjet 2"
            ? "pm-template-waterjet-abb2-60hp"
            : null;
    insertPlan.run(
      `pm-plan-${String(index + 1).padStart(2, "0")}`,
      mainMachine,
      machineName,
      frequencyLabel,
      frequencyMonths,
      occurrencesPerMonth,
      technicianIds[technicianName],
      technicianName,
      assignedTemplateId,
      startMonth,
      weekOfMonth,
      secondaryWeek ?? null,
      timestamp,
      timestamp
    );
  });

  // Connect newly imported controlled checklists to existing deployed plans without
  // replacing any template an administrator has already assigned.
  const connectImportedTemplate = db.prepare(`
    UPDATE pm_plans SET templateId = ?, updatedAt = ?
    WHERE mainMachine = ? AND machineName = ? AND templateId IS NULL
  `);
  connectImportedTemplate.run("pm-template-forming-7", timestamp, "Forming", "Hydraulic Forming 7");
  connectImportedTemplate.run("pm-template-carding-4m", timestamp, "4 Meter NP", "Carding");
  connectImportedTemplate.run("pm-template-waterjet-abb2-60hp", timestamp, "WaterJet", "Waterjet 2");

  const currentYear = new Date().getFullYear();
  generatePmSchedules(2026);
  if (currentYear !== 2026) {
    generatePmSchedules(currentYear);
  }
  generatePmSchedules(currentYear + 1);
}

function generatePmSchedules(year: number, planId?: string, fromDate?: string) {
  const timestamp = now();
  const plans = rows<{
    id: string;
    frequencyMonths: number;
    occurrencesPerMonth: number;
    startMonth: number;
    weekOfMonth: number;
    secondaryWeek: number | null;
  }>(db.prepare(`
    SELECT id, frequencyMonths, occurrencesPerMonth, startMonth, weekOfMonth, secondaryWeek
    FROM scoped_pm_plans
    WHERE active = 1${planId ? " AND id = ?" : ""}
  `).all(...(planId ? [planId] : [])));
  const insert = db.prepare(`
    INSERT OR IGNORE INTO pm_schedules (plantId,
      id, planId, scheduledDate, year, month, weekOfMonth, status, remarks, createdAt, updatedAt
    ) VALUES (cmms_write_plant(), ?, ?, ?, ?, ?, ?, 'scheduled', '', ?, ?)
  `);

  for (const plan of plans) {
    for (let month = plan.startMonth; month <= 12; month += plan.frequencyMonths) {
      const weeks = plan.occurrencesPerMonth > 1 ? [plan.weekOfMonth, plan.secondaryWeek || 3] : [plan.weekOfMonth];
      for (const week of weeks) {
        const day = Math.min(1 + (week - 1) * 7, new Date(Date.UTC(year, month, 0)).getUTCDate());
        const scheduledDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        if (fromDate && scheduledDate < fromDate) continue;
        insert.run(`pm-schedule-${year}-${plan.id}-${month}-${week}`, plan.id, scheduledDate, year, month, week, timestamp, timestamp);
      }
    }
  }
}

export function ensurePlantPmSchedules() {
  const year = new Date().getFullYear();
  generatePmSchedules(year);
  generatePmSchedules(year + 1);
}

export function listUsers(role?: string): User[] {
  if (role) {
    return rows<User>(db.prepare(`SELECT ${userSelectColumns} FROM users WHERE role = ? AND active = 1 AND (plantAccess = 'both' OR cmms_can_access(plantAccess)) ORDER BY name`).all(role));
  }

  return rows<User>(db.prepare(`SELECT ${userSelectColumns} FROM users WHERE active = 1 AND (plantAccess = 'both' OR cmms_can_access(plantAccess)) ORDER BY department, role, name`).all());
}

const userRoles: UserRole[] = ["requester", "technician", "executive", "admin", "developer"];

export function createUser(input: CreateUserInput): User {
  const actor = requireAdmin(input.actorId);
  const username = input.username.trim().toLowerCase();
  const name = input.name.trim();
  const department = input.department.trim();
  const title = input.title.trim();
  const password = input.password;

  if (!username || !name || !department || !title || !password) {
    throw new Error("Username, password, name, department, and title are required.");
  }
  if (!/^[a-z0-9._-]{3,50}$/i.test(username)) {
    throw new Error("Username must be 3-50 characters and use only letters, numbers, dots, underscores, or hyphens.");
  }
  if (password.length < 12) {
    throw new Error("Password must contain at least 12 characters.");
  }
  if (!userRoles.includes(input.role)) {
    throw new Error("Select a valid user role.");
  }
  if (input.role === "developer" && actor.role !== "developer") {
    throw new Error("Only a developer account can create another developer account.");
  }
  if (db.prepare("SELECT 1 FROM users WHERE lower(username) = lower(?)").get(username)) {
    throw new Error("That username already exists, including among previously removed accounts.");
  }

  const plantAccess = validatePlantAccess(input.plantAccess ?? (["admin", "developer"].includes(input.role) ? "both" : writePlant()), actor);
  const id = randomUUID();
  const passwordRecord = createPasswordRecord(password);
  db.prepare(`
    INSERT INTO users (id, username, name, role, department, title, avatarUrl, passwordHash, passwordSalt, active, plantAccess)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, 1, ?)
  `).run(id, username, name, input.role, department, title, passwordRecord.passwordHash, passwordRecord.passwordSalt, plantAccess);
  return getUser(id);
}

export function updateUser(id: string, input: UpdateUserInput): User {
  const actor = requireAdmin(input.actorId);
  const target = row<(User & { active: number }) | undefined>(
    db.prepare(`SELECT ${userSelectColumns}, active FROM users WHERE id = ?`).get(id)
  );
  if (target && actor.plantAccess !== "both" && target.plantAccess !== actor.plantAccess) throw new Error("You cannot manage users from another plant.");
  if (!target || !target.active) {
    throw new Error("User not found.");
  }

  const username = input.username.trim().toLowerCase();
  const name = input.name.trim();
  const department = input.department.trim();
  const title = input.title.trim();
  const password = input.password || "";
  if (!username || !name || !department || !title) {
    throw new Error("Username, name, department, and title are required.");
  }
  if (!/^[a-z0-9._-]{3,50}$/i.test(username)) {
    throw new Error("Username must be 3-50 characters and use only letters, numbers, dots, underscores, or hyphens.");
  }
  if (password && password.length < 12) {
    throw new Error("A new password must contain at least 12 characters.");
  }
  if (!userRoles.includes(input.role)) {
    throw new Error("Select a valid user role.");
  }
  if ((target.role === "developer" || input.role === "developer") && actor.role !== "developer") {
    throw new Error("Only a developer account can manage developer access.");
  }
  if (id === publicRequesterId && input.role !== "requester") {
    throw new Error("The requester kiosk must retain the requester role.");
  }
  if (db.prepare("SELECT 1 FROM users WHERE lower(username) = lower(?) AND id <> ?").get(username, id)) {
    throw new Error("That username already exists, including among previously removed accounts.");
  }
  if (["admin", "developer"].includes(target.role) && !["admin", "developer"].includes(input.role)) {
    const elevatedCount = row<{ count: number }>(
      db.prepare("SELECT COUNT(*) AS count FROM users WHERE active = 1 AND role IN ('admin', 'developer')").get()
    ).count;
    if (elevatedCount <= 1) {
      throw new Error("At least one active admin or developer account must remain.");
    }
  }

  const plantAccess = validatePlantAccess(input.plantAccess ?? target.plantAccess, actor);
  const revokeSessions = Boolean(password) || target.role !== input.role || target.plantAccess !== plantAccess;
  const passwordRecord = password ? createPasswordRecord(password) : null;
  db.exec("BEGIN");
  try {
    db.prepare(`
      UPDATE users
      SET username = ?, name = ?, role = ?, department = ?, title = ?, plantAccess = ?,
          passwordHash = COALESCE(?, passwordHash), passwordSalt = COALESCE(?, passwordSalt)
      WHERE id = ?
    `).run(username, name, input.role, department, title, plantAccess, passwordRecord?.passwordHash || null, passwordRecord?.passwordSalt || null, id);
    if (revokeSessions) {
      db.prepare("DELETE FROM auth_sessions WHERE userId = ?").run(id);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getUser(id);
}

export function deactivateUser(id: string, actorId: string): void {
  const actor = requireAdmin(actorId);
  const target = row<(User & { active: number }) | undefined>(
    db.prepare(`SELECT ${userSelectColumns}, active FROM users WHERE id = ?`).get(id)
  );
  if (target && actor.plantAccess !== "both" && target.plantAccess !== actor.plantAccess) throw new Error("You cannot manage users from another plant.");
  if (!target || !target.active) {
    throw new Error("User not found.");
  }
  if (id === publicRequesterId) {
    throw new Error("The requester kiosk account is required by the public request form and cannot be removed.");
  }
  if (id === actorId) {
    throw new Error("You cannot remove the account you are currently using.");
  }
  if (target.role === "developer" && actor.role !== "developer") {
    throw new Error("Only a developer account can remove another developer account.");
  }
  if (["admin", "developer"].includes(target.role)) {
    const elevatedCount = row<{ count: number }>(
      db.prepare("SELECT COUNT(*) AS count FROM users WHERE active = 1 AND role IN ('admin', 'developer')").get()
    ).count;
    if (elevatedCount <= 1) {
      throw new Error("At least one active admin or developer account must remain.");
    }
  }

  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM auth_sessions WHERE userId = ?").run(id);
    db.prepare("UPDATE users SET active = 0 WHERE id = ?").run(id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function getUser(id: string): User {
  const user = db.prepare(`SELECT ${userSelectColumns} FROM users WHERE id = ?`).get(id);
  if (!user) {
    throw new Error("User not found");
  }

  return row<User>(user);
}

export function loginUser(username: string, password: string): User {
  const authUser = row<(User & { passwordHash: string | null; passwordSalt: string | null }) | undefined>(
    db.prepare(`SELECT ${userSelectColumns}, passwordHash, passwordSalt FROM users WHERE lower(username) = lower(?) AND active = 1`).get(username.trim())
  );

  if (!authUser || !authUser.passwordHash || !authUser.passwordSalt || !verifyPassword(password, authUser.passwordSalt, authUser.passwordHash)) {
    throw new Error("Invalid username or password.");
  }
  if (authUser.role === "developer" && !process.env.DEVELOPER_PASSWORD) {
    throw new Error("Developer sign-in is disabled on this server.");
  }

  const { passwordHash: _passwordHash, passwordSalt: _passwordSalt, ...user } = authUser;
  return user;
}

function sessionTokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

const dayInMilliseconds = 24 * 60 * 60 * 1000;
const permanentAuthSessionExpiry = "9999-12-31T23:59:59.999Z";

export function authSessionMaxAgeMs() {
  // Browsers may cap persistent cookies, while the app's bearer token remains
  // valid until it is explicitly revoked on the server.
  return 400 * dayInMilliseconds;
}

export function createAuthSession(username: string, password: string): AuthSession {
  const user = loginUser(username, password);
  const token = randomBytes(32).toString("base64url");
  const createdAt = now();
  const expiresAt = permanentAuthSessionExpiry;
  db.prepare("DELETE FROM auth_sessions WHERE expiresAt <= ?").run(createdAt);
  db.prepare("INSERT INTO auth_sessions (tokenHash, userId, expiresAt, createdAt) VALUES (?, ?, ?, ?)")
    .run(sessionTokenHash(token), user.id, expiresAt, createdAt);
  return { user, token, expiresAt };
}

export function authenticateSession(token: string): User {
  const timestamp = now();
  const authenticated = row<(User & { sessionExpiresAt: string }) | undefined>(db.prepare(`
    SELECT u.id, u.username, u.name, u.role, u.department, u.title, u.avatarUrl, u.plantAccess,
      session.expiresAt AS sessionExpiresAt
    FROM auth_sessions session JOIN users u ON u.id = session.userId
    WHERE session.tokenHash = ? AND session.expiresAt > ? AND u.active = 1
  `).get(sessionTokenHash(token), timestamp));
  if (!authenticated) throw new Error("Session expired or invalid.");
  const { sessionExpiresAt, ...user } = authenticated;
  if (sessionExpiresAt !== permanentAuthSessionExpiry) {
    db.prepare("UPDATE auth_sessions SET expiresAt = ? WHERE tokenHash = ?")
      .run(permanentAuthSessionExpiry, sessionTokenHash(token));
  }
  return user;
}

export function revokeAuthSession(token: string) {
  if (!token) return;
  db.prepare("DELETE FROM auth_sessions WHERE tokenHash = ?").run(sessionTokenHash(token));
}

export function revokeUserSessions(id: string, actorId: string) {
  const actor = requireAdmin(actorId);
  const target = getUser(id);
  if (actor.plantAccess !== "both" && target.plantAccess !== actor.plantAccess) {
    throw new Error("You cannot end sessions for a user from another plant.");
  }
  if (target.role === "developer" && actor.role !== "developer") {
    throw new Error("Only a developer account can end another developer account's sessions.");
  }
  const result = db.prepare("DELETE FROM auth_sessions WHERE userId = ?").run(id);
  return Number(result.changes);
}

export function updateUserAvatar(id: string, avatarUrl: string): User {
  getUser(id);
  db.prepare("UPDATE users SET avatarUrl = ? WHERE id = ?").run(avatarUrl, id);
  return getUser(id);
}

export function listMaintenanceUsers(): User[] {
  return rows<User>(
    db.prepare(`SELECT ${userSelectColumns} FROM users WHERE role IN ('technician', 'executive') AND active = 1 ORDER BY role, name`).all()
  );
}

export function listExecutives(): User[] {
  return rows<User>(db.prepare(`SELECT ${userSelectColumns} FROM users WHERE role = 'executive' AND active = 1 ORDER BY name`).all());
}

function normalizeSection(section: Section & { active: number | boolean }): Section {
  return { ...section, active: Boolean(section.active) };
}

type RawSection = Omit<Section, "active"> & { active: number };
type RawMachine = Omit<Machine, "active"> & { active: number };

function normalizeMachine(machine: Machine & { active: number | boolean }): Machine {
  return { ...machine, active: Boolean(machine.active) };
}

function normalizeIssueCategory(issueCategory: IssueCategory & { active: number | boolean }): IssueCategory {
  return { ...issueCategory, active: Boolean(issueCategory.active) };
}

export function listMasterData(): MasterData {
  return {
    sections: rows<Section & { active: number }>(db.prepare("SELECT * FROM scoped_sections ORDER BY active DESC, name").all()).map(normalizeSection),
    machines: rows<Machine & { active: number }>(db.prepare("SELECT * FROM scoped_machines ORDER BY active DESC, name").all()).map(normalizeMachine),
    issueCategories: rows<IssueCategory & { active: number }>(db.prepare("SELECT * FROM scoped_issue_categories ORDER BY active DESC, name").all()).map(normalizeIssueCategory)
  };
}

type StoredAsset = Omit<
  AssetRecord,
  "ageYears" | "lifecycleBand" | "riskScore" | "warrantyState" | "dataCompleteness"
>;

function assetYear(value: string): number | null {
  const fullYear = value.match(/(?:19|20)\d{2}/)?.[0];
  if (fullYear) return Number(fullYear);

  const shortYear = value.match(/\d{2}/g)?.at(-1);
  if (!shortYear) return null;
  const year = Number(shortYear);
  return year <= 30 ? 2000 + year : 1900 + year;
}

function lifecycleBand(ageYears: number | null): AssetLifecycleBand {
  if (ageYears === null) return "unknown";
  if (ageYears <= 7) return "modern";
  if (ageYears <= 15) return "midlife";
  if (ageYears <= 24) return "aging";
  return "legacy";
}

function warrantyState(asset: StoredAsset, installYear: number | null): AssetRecord["warrantyState"] {
  const warranty = asset.warranty.toLowerCase();
  if (warranty.includes("obs") || warranty.includes("n/a")) return "not_applicable";
  if (!installYear) return "unknown";

  const years = warranty.match(/(\d+)\s*(?:yr|year)/)?.[1];
  const months = warranty.match(/(\d+)\s*month/)?.[1];
  if (!years && !months) return "unknown";
  const expiryYear = installYear + Number(years || 0);
  const currentYear = new Date().getFullYear();
  if (expiryYear < currentYear || (months && expiryYear <= currentYear)) return "expired";
  if (expiryYear === currentYear) return "expiring";
  return "active";
}

function normalizeAsset(asset: StoredAsset): AssetRecord {
  const manufacturedYear = assetYear(asset.yearText);
  const installYear = assetYear(asset.installDateText);
  const currentYear = new Date().getFullYear();
  const ageYears = manufacturedYear ? Math.max(0, currentYear - manufacturedYear) : null;
  const lifecycle = lifecycleBand(ageYears);
  const warranty = warrantyState(asset, installYear);
  const completenessFields = [
    asset.name,
    asset.yearText,
    asset.installDateText,
    asset.warranty,
    asset.serialNo,
    asset.manufacturer,
    asset.supplier,
    asset.contactPerson,
    asset.telephone
  ];
  const dataCompleteness = Math.round((completenessFields.filter(Boolean).length / completenessFields.length) * 100);

  let riskScore = ageYears === null ? 45 : ageYears >= 25 ? 76 : ageYears >= 20 ? 68 : ageYears >= 15 ? 55 : ageYears >= 10 ? 44 : 25;
  riskScore += asset.criticality === "critical" ? 20 : asset.criticality === "high" ? 10 : asset.criticality === "medium" ? 5 : 0;
  if (warranty === "expired") riskScore += 5;
  if (!asset.serialNo) riskScore += 3;
  if (asset.condition === "watch") riskScore = Math.max(riskScore, 75);
  if (["obsolete", "decommissioned"].includes(asset.condition)) riskScore = 100;

  return {
    ...asset,
    ageYears,
    lifecycleBand: lifecycle,
    warrantyState: warranty,
    dataCompleteness,
    riskScore: Math.min(100, riskScore)
  };
}

function getAsset(id: string): AssetRecord {
  const asset = db.prepare("SELECT * FROM scoped_assets WHERE id = ?").get(id);
  if (!asset) throw new Error("Asset not found.");
  return normalizeAsset(row<StoredAsset>(asset));
}

export function getAssetDashboard(): AssetDashboardResponse {
  const assets = rows<StoredAsset>(db.prepare("SELECT * FROM scoped_assets ORDER BY assetNo").all()).map(normalizeAsset);
  const totalKnownAge = assets.filter((asset) => asset.ageYears !== null);
  const manufacturers = [...assets.reduce((counts, asset) => {
    const name = asset.manufacturer.trim() || "Not recorded";
    counts.set(name, (counts.get(name) || 0) + 1);
    return counts;
  }, new Map<string, number>()).entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const expectedNumbers = Array.from({ length: Math.max(...assets.map((asset) => asset.assetNo)) }, (_, index) => index + 1);
  const existingNumbers = new Set(assets.map((asset) => asset.assetNo));

  return {
    summary: {
      totalAssets: assets.length,
      operational: assets.filter((asset) => asset.condition === "operational").length,
      watch: assets.filter((asset) => asset.condition === "watch").length,
      obsolete: assets.filter((asset) => asset.condition === "obsolete").length,
      decommissioned: assets.filter((asset) => asset.condition === "decommissioned").length,
      highRisk: assets.filter((asset) => asset.riskScore >= 75).length,
      legacy: assets.filter((asset) => asset.lifecycleBand === "legacy").length,
      averageAge: totalKnownAge.length
        ? Math.round(totalKnownAge.reduce((sum, asset) => sum + (asset.ageYears || 0), 0) / totalKnownAge.length)
        : 0,
      missingSerials: assets.filter((asset) => !asset.serialNo).length,
      expiredWarranties: assets.filter((asset) => asset.warrantyState === "expired").length,
      expiringWarranties: assets.filter((asset) => asset.warrantyState === "expiring").length,
      dataCompleteness: assets.length
        ? Math.round(assets.reduce((sum, asset) => sum + asset.dataCompleteness, 0) / assets.length)
        : 0
    },
    assets,
    manufacturers,
    sourceLabel: "FR-MT-008 - List of Production Machineries (confirmed 2026 register)",
    sourceRevision: 11,
    sourceUpdatedAt: "2025-11-20",
    missingAssetNumbers: expectedNumbers.filter((assetNo) => !existingNumbers.has(assetNo))
  };
}

export function updateAsset(id: string, input: UpdateAssetInput): AssetRecord {
  const actor = getUser(input.actorId);
  if (!["executive", "admin", "developer"].includes(actor.role)) {
    throw new Error("Executive, admin, or developer access is required to update an asset.");
  }
  if (!["operational", "watch", "obsolete", "decommissioned"].includes(input.condition)) {
    throw new Error("Select a valid asset condition.");
  }
  if (!["critical", "high", "medium", "low"].includes(input.criticality)) {
    throw new Error("Select a valid asset criticality.");
  }
  getAsset(id);
  db.prepare(`
    UPDATE assets
    SET condition = ?, criticality = ?, location = ?, notes = ?, updatedAt = ?
    WHERE id = ?
  `).run(input.condition, input.criticality, input.location?.trim() || "Production", input.notes?.trim() || "", now(), id);
  return getAsset(id);
}

function getSection(id: string): Section {
  const section = db.prepare("SELECT * FROM scoped_sections WHERE id = ?").get(id);
  if (!section) {
    throw new Error("Section not found");
  }

  return normalizeSection(row<Section & { active: number }>(section));
}

function getMachine(id: string): Machine {
  const machine = db.prepare("SELECT * FROM scoped_machines WHERE id = ?").get(id);
  if (!machine) {
    throw new Error("Machine not found");
  }

  return normalizeMachine(row<Machine & { active: number }>(machine));
}

function getIssueCategory(id: string): IssueCategory {
  const issueCategory = db.prepare("SELECT * FROM scoped_issue_categories WHERE id = ?").get(id);
  if (!issueCategory) {
    throw new Error("Issue category not found");
  }

  return normalizeIssueCategory(row<IssueCategory & { active: number }>(issueCategory));
}

function getOptionalSection(id: string | null): Section | null {
  if (!id) {
    return null;
  }

  const section = db.prepare("SELECT * FROM scoped_sections WHERE id = ?").get(id);
  return section ? normalizeSection(row<Section & { active: number }>(section)) : null;
}

function getOptionalMachine(id: string | null): Machine | null {
  if (!id) {
    return null;
  }

  const machine = db.prepare("SELECT * FROM scoped_machines WHERE id = ?").get(id);
  return machine ? normalizeMachine(row<Machine & { active: number }>(machine)) : null;
}

function getOptionalIssueCategory(id: string | null): IssueCategory | null {
  if (!id) {
    return null;
  }

  const issueCategory = db.prepare("SELECT * FROM scoped_issue_categories WHERE id = ?").get(id);
  return issueCategory ? normalizeIssueCategory(row<IssueCategory & { active: number }>(issueCategory)) : null;
}

function requireAdmin(actorId: string) {
  const actor = getUser(actorId);
  if (!["executive", "admin", "developer"].includes(actor.role)) {
    throw new Error("Executive, admin, or developer access is required.");
  }

  return actor;
}

function requireWorkOrderManager(actorId: string) {
  const actor = getUser(actorId);
  if (!["executive", "admin"].includes(actor.role)) {
    throw new Error("Executive or admin access is required to manage work orders.");
  }

  return actor;
}

function requireSpareActor(actorId: string) {
  const actor = getUser(actorId);
  if (actor.role === "requester") {
    throw new Error("Requester accounts cannot change spare-part stock.");
  }

  return actor;
}

function requireSpareManager(actorId: string) {
  const actor = getUser(actorId);
  if (!["executive", "admin", "developer"].includes(actor.role)) {
    throw new Error("Executive, admin, or developer access is required.");
  }

  return actor;
}

function requirePmActor(actorId: string) {
  const actor = getUser(actorId);
  if (actor.role === "requester") {
    throw new Error("Requester accounts cannot access preventive maintenance.");
  }
  return actor;
}

function requirePmManager(actorId: string) {
  const actor = requirePmActor(actorId);
  if (!["executive", "admin", "developer"].includes(actor.role)) {
    throw new Error("Executive, admin, or developer access is required.");
  }
  return actor;
}

type RawPmTemplate = Omit<PmChecklistTemplate, "active" | "items"> & { active: number };
type RawPmItem = Omit<PmChecklistItem, "required"> & { required: number };
type RawPmPlan = Omit<PmPlan, "active"> & { active: number };
type RawPmSchedule = Omit<PmScheduleItem, "overdue">;

function getPmTemplate(templateId: string): PmChecklistTemplate {
  const template = row<RawPmTemplate | undefined>(db.prepare(`
    SELECT t.*, COUNT(i.id) AS itemCount
    FROM scoped_pm_checklist_templates t
    LEFT JOIN scoped_pm_checklist_items i ON i.templateId = t.id
    WHERE t.id = ?
    GROUP BY t.id
  `).get(templateId));
  if (!template) {
    throw new Error("PM checklist template not found.");
  }
  const items = rows<RawPmItem>(
    db.prepare("SELECT * FROM scoped_pm_checklist_items WHERE templateId = ? ORDER BY sortOrder").all(templateId)
  ).map((item) => ({ ...item, required: Boolean(item.required) }));
  return { ...template, active: Boolean(template.active), items };
}

export function listPmTemplates(): PmChecklistTemplate[] {
  const templates = rows<RawPmTemplate>(db.prepare(`
    SELECT t.*, COUNT(i.id) AS itemCount
    FROM scoped_pm_checklist_templates t
    LEFT JOIN scoped_pm_checklist_items i ON i.templateId = t.id
    GROUP BY t.id
    ORDER BY t.active DESC, t.machineName
  `).all());
  return templates.map((template) => ({
    ...template,
    active: Boolean(template.active),
    items: rows<RawPmItem>(
      db.prepare("SELECT * FROM scoped_pm_checklist_items WHERE templateId = ? ORDER BY sortOrder").all(template.id)
    ).map((item) => ({ ...item, required: Boolean(item.required) }))
  }));
}

export function listPmPlans(): PmPlan[] {
  return rows<RawPmPlan>(db.prepare(`
    SELECT plantId, id, mainMachine, machineName, frequencyLabel, frequencyMonths, occurrencesPerMonth,
           technicianId, technicianName, templateId, startMonth, weekOfMonth, secondaryWeek, active
    FROM scoped_pm_plans
    ORDER BY mainMachine, machineName
  `).all()).map((plan) => ({ ...plan, active: Boolean(plan.active) }));
}

function pmScheduleSelect() {
  return `
    SELECT
      s.plantId, s.id, s.planId, s.scheduledDate, s.year, s.month, s.weekOfMonth, s.status,
      s.startedAt, s.submittedAt, s.verifiedAt, s.remarks,
      p.machineName, p.mainMachine, p.frequencyLabel, p.technicianId, p.technicianName,
      p.templateId, t.title AS templateTitle,
      COUNT(DISTINCT i.id) AS checklistItemCount,
      COUNT(DISTINCT CASE
        WHEN r.resultCode IS NOT NULL
          AND (i.dataType <> 'value' OR trim(COALESCE(r.readingValue, '')) <> '')
          AND EXISTS (
            SELECT 1 FROM scoped_pm_result_photos photo
            WHERE photo.scheduleId = s.id AND photo.itemId = i.id
          )
        THEN r.itemId
      END) AS completedItemCount,
      COUNT(DISTINCT CASE WHEN r.resultCode = 'fail' THEN r.itemId END) AS failedItemCount
    FROM scoped_pm_schedules s
    JOIN scoped_pm_plans p ON p.id = s.planId
    LEFT JOIN scoped_pm_checklist_templates t ON t.id = p.templateId
    LEFT JOIN scoped_pm_checklist_items i ON i.templateId = p.templateId
    LEFT JOIN scoped_pm_results r ON r.scheduleId = s.id AND r.itemId = i.id
  `;
}

function normalizePmSchedule(schedule: RawPmSchedule): PmScheduleItem {
  return {
    ...schedule,
    checklistItemCount: Number(schedule.checklistItemCount || 0),
    completedItemCount: Number(schedule.completedItemCount || 0),
    failedItemCount: Number(schedule.failedItemCount || 0),
    overdue: !["submitted", "verified"].includes(schedule.status) && schedule.scheduledDate < now().slice(0, 10)
  };
}

function listPmSchedules(actorId: string, year: number): PmScheduleItem[] {
  const actor = requirePmActor(actorId);
  const technicianFilter = actor.role === "technician" ? "AND p.technicianId = ?" : "";
  const parameters = actor.role === "technician" ? [year, actor.id] : [year];
  const scheduleRows = rows<RawPmSchedule>(db.prepare(`
    ${pmScheduleSelect()}
    WHERE s.year = ? ${technicianFilter}
    GROUP BY s.id
    ORDER BY s.scheduledDate, p.mainMachine, p.machineName
  `).all(...parameters));
  return scheduleRows.map(normalizePmSchedule);
}

export function getPmDashboard(actorId: string, year = new Date().getFullYear()): PmDashboardResponse {
  const schedules = listPmSchedules(actorId, year);
  const plans = listPmPlans();
  const templates = listPmTemplates();
  const today = now().slice(0, 10);
  const currentMonth = Number(today.slice(5, 7));
  const currentYear = Number(today.slice(0, 4));
  const date = new Date(`${today}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  const weekStart = new Date(date);
  weekStart.setUTCDate(date.getUTCDate() - day + 1);
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6);
  const weekStartText = weekStart.toISOString().slice(0, 10);
  const weekEndText = weekEnd.toISOString().slice(0, 10);
  const monthSchedules = year === currentYear ? schedules.filter((item) => item.month === currentMonth) : schedules;
  const completedThisMonth = monthSchedules.filter((item) => ["submitted", "verified"].includes(item.status)).length;
  const coveredPlans = plans.filter((plan) => plan.active && plan.templateId).length;
  const activePlans = plans.filter((plan) => plan.active).length;

  return {
    summary: {
      scheduledThisMonth: monthSchedules.length,
      dueThisWeek: schedules.filter((item) => item.scheduledDate >= weekStartText && item.scheduledDate <= weekEndText).length,
      overdue: schedules.filter((item) => item.overdue).length,
      completedThisMonth,
      compliancePercent: monthSchedules.length ? Math.round((completedThisMonth / monthSchedules.length) * 100) : 100,
      checklistCoveragePercent: activePlans ? Math.round((coveredPlans / activePlans) * 100) : 100
    },
    schedules,
    plans,
    templates
  };
}

function getPmScheduleBase(scheduleId: string): PmScheduleItem {
  const schedule = row<RawPmSchedule | undefined>(db.prepare(`
    ${pmScheduleSelect()}
    WHERE s.id = ?
    GROUP BY s.id
  `).get(scheduleId));
  if (!schedule) {
    throw new Error("PM assignment not found.");
  }
  return normalizePmSchedule(schedule);
}

function requireScheduleAccess(scheduleId: string, actorId: string) {
  const actor = requirePmActor(actorId);
  const schedule = getPmScheduleBase(scheduleId);
  if (actor.role === "technician" && schedule.technicianId !== actor.id) {
    throw new Error("This PM assignment belongs to another technician.");
  }
  return { actor, schedule };
}

export function getPmScheduleDetail(scheduleId: string, actorId: string): PmScheduleDetail {
  const { schedule } = requireScheduleAccess(scheduleId, actorId);
  const verification = row<{ verifiedByName: string | null }>(db.prepare(`
    SELECT u.name AS verifiedByName
    FROM scoped_pm_schedules s
    LEFT JOIN users u ON u.id = s.verifiedById
    WHERE s.id = ?
  `).get(scheduleId));
  const template = schedule.templateId ? getPmTemplate(schedule.templateId) : null;
  const storedResults = rows<PmChecklistResult>(db.prepare(`
    SELECT itemId, resultCode, readingValue, note, completedAt
    FROM scoped_pm_results WHERE scheduleId = ?
  `).all(scheduleId));
  const photos = rows<PmChecklistPhoto>(db.prepare(`
    SELECT photo.id, photo.scheduleId, photo.itemId, photo.uploadedBy, u.name AS uploadedByName,
           photo.originalName, photo.mimeType, photo.size,
           '/api/pm/photos/' || photo.id AS url, photo.createdAt
    FROM scoped_pm_result_photos photo
    JOIN users u ON u.id = photo.uploadedBy
    WHERE photo.scheduleId = ?
    ORDER BY photo.createdAt
  `).all(scheduleId));
  const photosByItem = new Map<string, PmChecklistPhoto[]>();
  photos.forEach((photo) => photosByItem.set(photo.itemId, [...(photosByItem.get(photo.itemId) || []), photo]));
  const resultsByItem = new Map(storedResults.map((result) => [result.itemId, {
    ...result,
    photos: photosByItem.get(result.itemId) || []
  }]));
  const results = (template?.items || []).map((item) => resultsByItem.get(item.id) || ({
    itemId: item.id,
    resultCode: null,
    readingValue: "",
    note: "",
    completedAt: null,
    photos: photosByItem.get(item.id) || []
  }));
  return { ...schedule, template, results, verifiedByName: verification.verifiedByName };
}

export function addPmResultPhoto(input: {
  scheduleId: string;
  itemId: string;
  actorId: string;
  originalName: string;
  mimeType: string;
  size: number;
  data: Uint8Array;
}): PmScheduleDetail {
  const { schedule } = requireScheduleAccess(input.scheduleId, input.actorId);
  if (["submitted", "verified"].includes(schedule.status)) {
    throw new Error("Photo proof cannot be changed after the checklist is submitted.");
  }
  if (!schedule.templateId) {
    throw new Error("This machine does not have a checklist yet.");
  }
  const item = db.prepare("SELECT id FROM scoped_pm_checklist_items WHERE id = ? AND templateId = ?")
    .get(input.itemId, schedule.templateId);
  if (!item) {
    throw new Error("Checklist item not found.");
  }
  const photoCount = row<{ count: number }>(db.prepare(`
    SELECT COUNT(*) AS count FROM scoped_pm_result_photos WHERE scheduleId = ? AND itemId = ?
  `).get(input.scheduleId, input.itemId)).count;
  if (photoCount >= 5) {
    throw new Error("A checklist item can keep up to 5 proof photos.");
  }
  const timestamp = now();
  db.prepare(`
    INSERT INTO pm_result_photos (plantId,
      id, scheduleId, itemId, uploadedBy, originalName, mimeType, size, data, createdAt
    ) VALUES (cmms_write_plant(), ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(),
    input.scheduleId,
    input.itemId,
    input.actorId,
    input.originalName,
    input.mimeType,
    input.size,
    input.data,
    timestamp
  );
  db.prepare(`
    UPDATE pm_schedules
    SET status = CASE WHEN status = 'scheduled' THEN 'in_progress' ELSE status END,
        startedAt = COALESCE(startedAt, ?), updatedAt = ?
    WHERE id = ?
  `).run(timestamp, timestamp, input.scheduleId);
  return getPmScheduleDetail(input.scheduleId, input.actorId);
}

export function getPmPhoto(photoId: string) {
  const photo = row<{ mimeType: string; originalName: string; data: Uint8Array } | undefined>(db.prepare(`
    SELECT mimeType, originalName, data FROM scoped_pm_result_photos WHERE id = ?
  `).get(photoId));
  if (!photo) {
    throw new Error("PM proof photo not found.");
  }
  return photo;
}

export function deletePmResultPhoto(photoId: string, actorId: string): PmScheduleDetail {
  requireAdmin(actorId);
  const photo = row<{ scheduleId: string } | undefined>(db.prepare(`
    SELECT scheduleId FROM scoped_pm_result_photos WHERE id = ?
  `).get(photoId));
  if (!photo) {
    throw new Error("PM proof photo not found.");
  }
  db.prepare("DELETE FROM pm_result_photos WHERE id = ?").run(photoId);
  return getPmScheduleDetail(photo.scheduleId, actorId);
}

export function startPmSchedule(scheduleId: string, actorId: string): PmScheduleDetail {
  const { schedule } = requireScheduleAccess(scheduleId, actorId);
  if (!schedule.templateId) {
    throw new Error("A checklist must be assigned before this PM can start.");
  }
  if (schedule.status === "scheduled") {
    const timestamp = now();
    db.prepare("UPDATE pm_schedules SET status = 'in_progress', startedAt = ?, updatedAt = ? WHERE id = ?")
      .run(timestamp, timestamp, scheduleId);
  }
  return getPmScheduleDetail(scheduleId, actorId);
}

export function savePmResult(scheduleId: string, input: SavePmResultInput): PmScheduleDetail {
  const { schedule } = requireScheduleAccess(scheduleId, input.actorId);
  if (["submitted", "verified"].includes(schedule.status)) {
    throw new Error("This checklist has already been submitted.");
  }
  if (!schedule.templateId) {
    throw new Error("This machine does not have a checklist yet.");
  }
  const item = row<{ id: string; dataType: string } | undefined>(
    db.prepare("SELECT id, dataType FROM scoped_pm_checklist_items WHERE id = ? AND templateId = ?").get(input.itemId, schedule.templateId)
  );
  if (!item) {
    throw new Error("Checklist item not found.");
  }
  const allowedResults = ["pass", "fail", "adjusted", "not_applicable"];
  if (input.resultCode && !allowedResults.includes(input.resultCode)) {
    throw new Error("Invalid checklist result.");
  }
  const timestamp = now();
  db.prepare(`
    INSERT INTO pm_results (plantId,
      id, scheduleId, itemId, resultCode, readingValue, note, completedAt, updatedById, updatedAt
    ) VALUES (cmms_write_plant(), ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(scheduleId, itemId) DO UPDATE SET
      resultCode = excluded.resultCode,
      readingValue = excluded.readingValue,
      note = excluded.note,
      completedAt = excluded.completedAt,
      updatedById = excluded.updatedById,
      updatedAt = excluded.updatedAt
  `).run(
    randomUUID(),
    scheduleId,
    input.itemId,
    input.resultCode,
    input.readingValue?.trim() || "",
    input.note?.trim() || "",
    input.resultCode ? timestamp : null,
    input.actorId,
    timestamp
  );
  db.prepare(`
    UPDATE pm_schedules
    SET status = CASE WHEN status = 'scheduled' THEN 'in_progress' ELSE status END,
        startedAt = COALESCE(startedAt, ?), updatedAt = ?
    WHERE id = ?
  `).run(timestamp, timestamp, scheduleId);
  return getPmScheduleDetail(scheduleId, input.actorId);
}

export function submitPmSchedule(scheduleId: string, input: SubmitPmScheduleInput): PmScheduleDetail {
  const { schedule } = requireScheduleAccess(scheduleId, input.actorId);
  if (!schedule.templateId) {
    throw new Error("This machine does not have a checklist yet.");
  }
  const incomplete = row<{ count: number }>(db.prepare(`
    SELECT COUNT(*) AS count
    FROM scoped_pm_checklist_items i
    LEFT JOIN scoped_pm_results r ON r.itemId = i.id AND r.scheduleId = ?
    WHERE i.templateId = ? AND i.required = 1
      AND (
        r.resultCode IS NULL
        OR (i.dataType = 'value' AND trim(COALESCE(r.readingValue, '')) = '')
        OR NOT EXISTS (
          SELECT 1 FROM scoped_pm_result_photos photo
          WHERE photo.scheduleId = ? AND photo.itemId = i.id
        )
      )
  `).get(scheduleId, schedule.templateId, scheduleId)).count;
  if (incomplete > 0) {
    throw new Error(`${incomplete} required checklist item${incomplete === 1 ? " is" : "s are"} missing a result, reading, or photo proof.`);
  }
  const timestamp = now();
  db.prepare(`
    UPDATE pm_schedules
    SET status = 'submitted', submittedAt = ?, remarks = ?, updatedAt = ?
    WHERE id = ?
  `).run(timestamp, input.remarks?.trim() || "", timestamp, scheduleId);
  return getPmScheduleDetail(scheduleId, input.actorId);
}

export function verifyPmSchedule(scheduleId: string, actorId: string): PmScheduleDetail {
  requirePmManager(actorId);
  const schedule = getPmScheduleBase(scheduleId);
  if (schedule.status !== "submitted") {
    throw new Error("Only a submitted checklist can be verified.");
  }
  const timestamp = now();
  db.prepare(`
    UPDATE pm_schedules
    SET status = 'verified', verifiedAt = ?, verifiedById = ?, updatedAt = ?
    WHERE id = ?
  `).run(timestamp, actorId, timestamp, scheduleId);
  return getPmScheduleDetail(scheduleId, actorId);
}

export function savePmTemplate(templateId: string | null, input: SavePmTemplateInput): PmChecklistTemplate {
  requirePmManager(input.actorId);
  const machineName = input.machineName.trim();
  const title = input.title.trim();
  if (!machineName || !title) {
    throw new Error("Machine name and checklist title are required.");
  }
  if (input.items.length === 0) {
    throw new Error("Add at least one checklist item.");
  }
  const timestamp = now();
  const id = templateId || randomUUID();
  if (templateId) {
    getPmTemplate(templateId);
    db.prepare(`
      UPDATE pm_checklist_templates
      SET machineName = ?, title = ?, documentNumber = ?, revisionNumber = ?, effectiveDate = ?,
          version = version + 1, active = ?, updatedAt = ?
      WHERE id = ?
    `).run(
      machineName,
      title,
      input.documentNumber?.trim() || "",
      input.revisionNumber?.trim() || "",
      input.effectiveDate || "",
      boolNumber(input.active ?? true),
      timestamp,
      id
    );
    db.prepare("DELETE FROM pm_checklist_items WHERE templateId = ?").run(id);
  } else {
    db.prepare(`
      INSERT INTO pm_checklist_templates (plantId,
        id, machineName, title, documentNumber, revisionNumber, effectiveDate, version, active, createdAt, updatedAt
      ) VALUES (cmms_write_plant(), ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    `).run(
      id,
      machineName,
      title,
      input.documentNumber?.trim() || "",
      input.revisionNumber?.trim() || "",
      input.effectiveDate || "",
      boolNumber(input.active ?? true),
      timestamp,
      timestamp
    );
  }
  const insertItem = db.prepare(`
    INSERT INTO pm_checklist_items (plantId,
      id, templateId, sortOrder, groupName, description, specification, inspectionMethod,
      frequency, dataType, maintenanceType, required
    ) VALUES (cmms_write_plant(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  input.items.forEach((item, index) => {
    if (!item.groupName.trim() || !item.description.trim()) {
      throw new Error(`Checklist item ${index + 1} needs a group and description.`);
    }
    insertItem.run(
      item.id || randomUUID(),
      id,
      index + 1,
      item.groupName.trim(),
      item.description.trim(),
      item.specification.trim(),
      item.inspectionMethod.trim(),
      item.frequency.trim() || "As scheduled",
      item.dataType,
      item.maintenanceType,
      boolNumber(item.required ?? true)
    );
  });
  return getPmTemplate(id);
}

export function assignPmTemplate(planId: string, input: AssignPmTemplateInput): PmPlan {
  requirePmManager(input.actorId);
  if (input.templateId) {
    getPmTemplate(input.templateId);
  }
  const plan = row<RawPmPlan | undefined>(db.prepare(`
    SELECT plantId, id, mainMachine, machineName, frequencyLabel, frequencyMonths, occurrencesPerMonth,
           technicianId, technicianName, templateId, startMonth, weekOfMonth, secondaryWeek, active
    FROM scoped_pm_plans WHERE id = ?
  `).get(planId));
  if (!plan) {
    throw new Error("PM plan not found.");
  }
  db.prepare("UPDATE pm_plans SET templateId = ?, updatedAt = ? WHERE id = ?").run(input.templateId, now(), planId);
  const updated = row<RawPmPlan>(db.prepare(`
    SELECT plantId, id, mainMachine, machineName, frequencyLabel, frequencyMonths, occurrencesPerMonth,
           technicianId, technicianName, templateId, startMonth, weekOfMonth, secondaryWeek, active
    FROM scoped_pm_plans WHERE id = ?
  `).get(planId));
  return { ...updated, active: Boolean(updated.active) };
}

function pmFrequencyLabel(frequencyMonths: number, occurrencesPerMonth: number) {
  if (occurrencesPerMonth === 2) return "Twice per month";
  if (frequencyMonths === 1) return "Monthly";
  return `Every ${frequencyMonths} months`;
}

export function createPmPlan(input: UpdatePmPlanInput): PmPlan {
  return updatePmPlan(randomUUID(), input, true);
}

export function updatePmPlan(planId: string, input: UpdatePmPlanInput, creating = false): PmPlan {
  requirePmManager(input.actorId);
  const existing = row<{ id: string } | undefined>(db.prepare("SELECT id FROM scoped_pm_plans WHERE id = ?").get(planId));
  if (!existing && !creating) throw new Error("PM plan not found.");

  const mainMachine = input.mainMachine.trim();
  const machineName = input.machineName.trim();
  const frequencyMonths = Number(input.frequencyMonths);
  const occurrencesPerMonth = Number(input.occurrencesPerMonth);
  const startMonth = Number(input.startMonth);
  const weekOfMonth = Number(input.weekOfMonth);
  const secondaryWeek = occurrencesPerMonth === 2 ? Number(input.secondaryWeek) : null;
  if (!mainMachine || !machineName) throw new Error("Section and machine name are required.");
  if (!Number.isInteger(frequencyMonths) || frequencyMonths < 1 || frequencyMonths > 12) {
    throw new Error("Frequency interval must be between 1 and 12 months.");
  }
  if (![1, 2].includes(occurrencesPerMonth) || (occurrencesPerMonth === 2 && frequencyMonths !== 1)) {
    throw new Error("Twice-per-month scheduling is only available for monthly plans.");
  }
  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) throw new Error("Start month is invalid.");
  if (!Number.isInteger(weekOfMonth) || weekOfMonth < 1 || weekOfMonth > 4) throw new Error("Primary week is invalid.");
  if (occurrencesPerMonth === 2 && (!Number.isInteger(secondaryWeek) || secondaryWeek! < 1 || secondaryWeek! > 4 || secondaryWeek === weekOfMonth)) {
    throw new Error("Choose a different valid secondary week.");
  }

  const technician = row<{ id: string; name: string } | undefined>(db.prepare(`
    SELECT id, name FROM users WHERE id = ? AND role IN ('technician', 'executive')
  `).get(input.technicianId));
  if (!technician || !userPlants(getUser(technician.id)).includes(writePlant())) throw new Error("Select a maintenance technician assigned to this plant.");

  const timestamp = now();
  const today = timestamp.slice(0, 10);
  const active = input.active ?? true;
  db.exec("BEGIN");
  try {
    if (creating) {
      db.prepare(`INSERT INTO pm_plans
        (plantId, id, mainMachine, machineName, frequencyLabel, technicianId, technicianName, createdAt, updatedAt)
        VALUES (cmms_write_plant(), ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(planId, mainMachine, machineName, pmFrequencyLabel(frequencyMonths, occurrencesPerMonth), technician.id, technician.name, timestamp, timestamp);
    }
    db.prepare(`
      UPDATE pm_plans
      SET mainMachine = ?, machineName = ?, frequencyLabel = ?, frequencyMonths = ?, occurrencesPerMonth = ?,
          technicianId = ?, technicianName = ?, startMonth = ?, weekOfMonth = ?, secondaryWeek = ?, active = ?, updatedAt = ?
      WHERE id = ?
    `).run(
      mainMachine,
      machineName,
      pmFrequencyLabel(frequencyMonths, occurrencesPerMonth),
      frequencyMonths,
      occurrencesPerMonth,
      technician.id,
      technician.name,
      startMonth,
      weekOfMonth,
      secondaryWeek,
      boolNumber(active),
      timestamp,
      planId
    );
    db.prepare("DELETE FROM pm_schedules WHERE planId = ? AND status = 'scheduled' AND scheduledDate >= ?").run(planId, today);
    if (active) {
      const currentYear = Number(today.slice(0, 4));
      generatePmSchedules(currentYear, planId, today);
      generatePmSchedules(currentYear + 1, planId, today);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return listPmPlans().find((plan) => plan.id === planId)!;
}

export function createSection(input: { actorId: string; department: WorkOrderDepartment; name: string; active?: boolean }): Section {
  requireAdmin(input.actorId);
  const id = randomUUID();
  const timestamp = now();
  const name = input.name.trim();
  const department = normalizeWorkOrderDepartment(input.department || "Production");
  if (!name) {
    throw new Error("Section name is required.");
  }

  db.prepare("INSERT INTO sections (plantId, id, department, name, active, createdAt, updatedAt) VALUES (cmms_write_plant(), ?, ?, ?, ?, ?, ?)")
    .run(id, department, name, boolNumber(input.active ?? true), timestamp, timestamp);

  return getSection(id);
}

export function updateSection(id: string, input: { actorId: string; department: WorkOrderDepartment; name: string; active?: boolean }): Section {
  requireAdmin(input.actorId);
  getSection(id);
  const name = input.name.trim();
  const department = normalizeWorkOrderDepartment(input.department || "Production");
  if (!name) {
    throw new Error("Section name is required.");
  }

  db.prepare("UPDATE sections SET department = ?, name = ?, active = ?, updatedAt = ? WHERE id = ?").run(department, name, boolNumber(input.active ?? true), now(), id);
  db.prepare("UPDATE machines SET department = ?, updatedAt = ? WHERE sectionId = ?").run(department, now(), id);
  return getSection(id);
}

export function createMachine(input: { actorId: string; department: WorkOrderDepartment; sectionId: string; area: string; name: string; active?: boolean }): Machine {
  requireAdmin(input.actorId);
  const section = getSection(input.sectionId);
  const department = normalizeWorkOrderDepartment(input.department || "Production");
  if (section.department !== department) throw new Error("The selected section belongs to a different department.");
  const id = randomUUID();
  const timestamp = now();
  const name = input.name.trim();
  const area = input.area.trim() || "General";
  if (!name) {
    throw new Error("Machine name is required.");
  }

  db.prepare("INSERT INTO machines (plantId, id, department, sectionId, area, name, active, createdAt, updatedAt) VALUES (cmms_write_plant(), ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, department, input.sectionId, area, name, boolNumber(input.active ?? true), timestamp, timestamp);

  return getMachine(id);
}

export function updateMachine(id: string, input: { actorId: string; department: WorkOrderDepartment; sectionId: string; area: string; name: string; active?: boolean }): Machine {
  requireAdmin(input.actorId);
  getMachine(id);
  const section = getSection(input.sectionId);
  const department = normalizeWorkOrderDepartment(input.department || "Production");
  if (section.department !== department) throw new Error("The selected section belongs to a different department.");
  const name = input.name.trim();
  const area = input.area.trim() || "General";
  if (!name) {
    throw new Error("Machine name is required.");
  }

  db.prepare("UPDATE machines SET department = ?, sectionId = ?, area = ?, name = ?, active = ?, updatedAt = ? WHERE id = ?")
    .run(department, input.sectionId, area, name, boolNumber(input.active ?? true), now(), id);
  return getMachine(id);
}

export function importMachines(input: { actorId: string; rows: MachineImportRow[] }): MachineImportResult {
  requireAdmin(input.actorId);
  const errors: string[] = [];
  let importedSections = 0;
  let importedMachines = 0;
  let skippedMachines = 0;

  const getSectionByName = db.prepare("SELECT * FROM scoped_sections WHERE lower(name) = lower(?)");
  const insertSection = db.prepare("INSERT INTO sections (plantId, id, department, name, active, createdAt, updatedAt) VALUES (cmms_write_plant(), ?, ?, ?, 1, ?, ?)");
  const getMachineBySectionName = db.prepare("SELECT * FROM scoped_machines WHERE sectionId = ? AND lower(area) = lower(?) AND lower(name) = lower(?)");
  const insertMachine = db.prepare("INSERT INTO machines (plantId, id, department, sectionId, area, name, active, createdAt, updatedAt) VALUES (cmms_write_plant(), ?, ?, ?, ?, ?, 1, ?, ?)");
  const reactivateMachine = db.prepare("UPDATE machines SET department = ?, area = ?, active = 1, updatedAt = ? WHERE id = ?");

  for (const [index, rowInput] of input.rows.entries()) {
    const sectionName = rowInput.sectionName.trim();
    const areaName = rowInput.areaName.trim() || "General";
    const machineName = rowInput.machineName.trim();
    const department = normalizeWorkOrderDepartment(rowInput.department || "Production");
    if (!sectionName && !machineName) {
      continue;
    }
    if (!sectionName || !machineName) {
      errors.push(`Row ${index + 1}: section and machine are required.`);
      continue;
    }

    const timestamp = now();
    let section = row<RawSection | undefined>(getSectionByName.get(sectionName));
    if (section && section.department !== department) {
      errors.push(`Row ${index + 1}: section ${sectionName} belongs to ${section.department}.`);
      continue;
    }
    if (!section) {
      const sectionId = randomUUID();
      insertSection.run(sectionId, department, sectionName, timestamp, timestamp);
      importedSections += 1;
      section = row<RawSection | undefined>(getSectionByName.get(sectionName));
    }
    if (!section) {
      errors.push(`Row ${index + 1}: unable to create section.`);
      continue;
    }

    const existingMachine = row<RawMachine | undefined>(getMachineBySectionName.get(section.id, areaName, machineName));
    if (existingMachine) {
      if (!existingMachine.active) {
        reactivateMachine.run(department, areaName, timestamp, existingMachine.id);
      }
      skippedMachines += 1;
      continue;
    }

    insertMachine.run(randomUUID(), department, section.id, areaName, machineName, timestamp, timestamp);
    importedMachines += 1;
  }

  return {
    importedSections,
    importedMachines,
    skippedMachines,
    errors,
    masterData: listMasterData()
  };
}

export function createIssueCategory(input: { actorId: string; department: WorkOrderDepartment; name: string; active?: boolean }): IssueCategory {
  requireAdmin(input.actorId);
  const id = randomUUID();
  const timestamp = now();
  const name = input.name.trim();
  const department = normalizeWorkOrderDepartment(input.department || "Production");
  if (!name) {
    throw new Error("Issue category name is required.");
  }

  db.prepare("INSERT INTO issue_categories (plantId, id, department, name, active, createdAt, updatedAt) VALUES (cmms_write_plant(), ?, ?, ?, ?, ?, ?)")
    .run(id, department, name, boolNumber(input.active ?? true), timestamp, timestamp);

  return getIssueCategory(id);
}

export function updateIssueCategory(id: string, input: { actorId: string; department: WorkOrderDepartment; name: string; active?: boolean }): IssueCategory {
  requireAdmin(input.actorId);
  getIssueCategory(id);
  const name = input.name.trim();
  const department = normalizeWorkOrderDepartment(input.department || "Production");
  if (!name) {
    throw new Error("Issue category name is required.");
  }

  db.prepare("UPDATE issue_categories SET department = ?, name = ?, active = ?, updatedAt = ? WHERE id = ?")
    .run(department, name, boolNumber(input.active ?? true), now(), id);
  return getIssueCategory(id);
}

type RawSparePart = Omit<SparePart, "active"> & { active: number };
type RawStockMovementDetail = Omit<StockMovementDetail, "syncStatus"> & { syncStatus: StockSyncStatus };
type SheetRecord = Record<string, string>;

function getSpareSetting(key: string) {
  key = plantSettingKey(key);
  const setting = row<{ value: string } | undefined>(db.prepare("SELECT value FROM spare_settings WHERE key = ?").get(key));
  return setting?.value || "";
}

function setSpareSetting(key: string, value: string) {
  key = plantSettingKey(key);
  db.prepare(`
    INSERT INTO spare_settings (key, value, updatedAt)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt
  `).run(key, value, now());
}

function spareSyncRuntimeSettings() {
  const scriptUrl = getSpareSetting("scriptUrl") || (writePlant() === "port-klang" && process.env.SPARE_SYNC_SCRIPT_URL) || "";
  const token = getSpareSetting("token") || (writePlant() === "port-klang" && process.env.SPARE_SYNC_TOKEN) || "";
  const masterSheetName = getSpareSetting("masterSheetName") || (writePlant() === "port-klang" && process.env.SPARE_MASTER_SHEET_NAME) || "Masterlist";
  const supplierSheetName = getSpareSetting("supplierSheetName") || (writePlant() === "port-klang" && process.env.SPARE_SUPPLIER_SHEET_NAME) || "Supplier";
  const movementSheetName = getSpareSetting("movementSheetName") || (writePlant() === "port-klang" && process.env.SPARE_MOVEMENT_SHEET_NAME) || "Movement Log";

  return {
    scriptUrl,
    token,
    masterSheetName,
    supplierSheetName,
    movementSheetName,
    configured: Boolean(scriptUrl && token)
  };
}

function spareSyncConfigured() {
  return spareSyncRuntimeSettings().configured;
}

function spareSheetNames() {
  const settings = spareSyncRuntimeSettings();
  return {
    master: settings.masterSheetName,
    supplier: settings.supplierSheetName,
    movement: settings.movementSheetName
  };
}

function cleanPasteCell(value = "") {
  return value.replace(/^\ufeff/, "").replace(/^"|"$/g, "").trim();
}

function splitSheetLine(line: string) {
  return (line.includes("\t") ? line.split("\t") : line.split(",")).map(cleanPasteCell);
}

function normalizeHeaderKey(value: string) {
  return cleanPasteCell(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function parseSheetText(text: string): SheetRecord[] {
  const table = text
    .split(/\r?\n/)
    .map(splitSheetLine)
    .filter((cells) => cells.some((cell) => cell.trim()));

  if (table.length < 2) {
    return [];
  }

  const headers = table[0];
  return table.slice(1).map((cells) => {
    return headers.reduce<SheetRecord>((record, header, index) => {
      const normalizedHeader = normalizeHeaderKey(header || `COLUMN${index + 1}`);
      record[normalizedHeader] = cells[index] || "";
      return record;
    }, {});
  });
}

function recordsFromUnknown(value: unknown): SheetRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  if (value.length === 0) {
    return [];
  }

  if (Array.isArray(value[0])) {
    const [headerRow, ...rowsInput] = value as unknown[][];
    const headers = headerRow.map((cell, index) => normalizeHeaderKey(String(cell || `COLUMN${index + 1}`)));
    return rowsInput.map((cells) => {
      return headers.reduce<SheetRecord>((record, header, index) => {
        record[header] = String(cells[index] ?? "").trim();
        return record;
      }, {});
    });
  }

  return (value as Array<Record<string, unknown>>).map((input) => {
    return Object.entries(input).reduce<SheetRecord>((record, [key, cell]) => {
      record[normalizeHeaderKey(key)] = String(cell ?? "").trim();
      return record;
    }, {});
  });
}

function getSheetValue(record: SheetRecord, aliases: string[]) {
  for (const alias of aliases) {
    const value = record[normalizeHeaderKey(alias)];
    if (value !== undefined) {
      return value.trim();
    }
  }

  return "";
}

function parseSheetNumber(value: string) {
  const cleaned = value.replace(/,/g, "").replace(/[^\d.-]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeSparePart(part: RawSparePart): SparePart {
  return {
    ...part,
    price: Number(part.price) || 0,
    minStock: Number(part.minStock) || 0,
    maxStock: Number(part.maxStock) || 0,
    openingStock: Number(part.openingStock) || 0,
    currentStock: Number(part.currentStock) || 0,
    active: Boolean(part.active)
  };
}

function normalizeSupplier(supplier: SpareSupplier): SpareSupplier {
  return supplier;
}

function normalizeMovementDetail(movement: RawStockMovementDetail): StockMovementDetail {
  return {
    ...movement,
    quantity: Number(movement.quantity) || 0,
    beforeStock: Number(movement.beforeStock) || 0,
    afterStock: Number(movement.afterStock) || 0
  };
}

function getSparePart(itemNo: string): SparePart {
  const part = db.prepare("SELECT * FROM scoped_spare_parts WHERE itemNo = ?").get(itemNo);
  if (!part) {
    throw new Error("Spare part not found.");
  }

  return normalizeSparePart(row<RawSparePart>(part));
}

function getMovementDetail(id: string): StockMovementDetail {
  const movement = db.prepare(`
    SELECT
      sm.*,
      COALESCE(sp.searchName, sp.description, sm.itemNo) as itemSearchName,
      COALESCE(sp.category, '') as itemCategory,
      COALESCE(u.name, sm.actorId) as actorName,
      wo.number as workOrderNumber
    FROM scoped_stock_movements sm
    LEFT JOIN scoped_spare_parts sp ON sp.itemNo = sm.itemNo AND sp.plantId = sm.plantId
    LEFT JOIN users u ON u.id = sm.actorId
    LEFT JOIN scoped_work_orders wo ON wo.id = sm.workOrderId
    WHERE sm.id = ?
  `).get(id);
  if (!movement) {
    throw new Error("Stock movement not found.");
  }

  return normalizeMovementDetail(row<RawStockMovementDetail>(movement));
}

function listMovementDetails(whereClause = "", params: Array<string | number | null> = [], limit = 20): StockMovementDetail[] {
  return rows<RawStockMovementDetail>(
    db.prepare(`
      SELECT
        sm.*,
        COALESCE(sp.searchName, sp.description, sm.itemNo) as itemSearchName,
        COALESCE(sp.category, '') as itemCategory,
        COALESCE(u.name, sm.actorId) as actorName,
        wo.number as workOrderNumber
      FROM scoped_stock_movements sm
      LEFT JOIN scoped_spare_parts sp ON sp.itemNo = sm.itemNo AND sp.plantId = sm.plantId
      LEFT JOIN users u ON u.id = sm.actorId
      LEFT JOIN scoped_work_orders wo ON wo.id = sm.workOrderId
      ${whereClause}
      ORDER BY sm.createdAt DESC
      LIMIT ?
    `).all(...params, limit)
  ).map(normalizeMovementDetail);
}

function inventorySummary(): SpareInventoryResponse["summary"] {
  const summary = row<{
    totalParts: number;
    lowStock: number;
    outOfStock: number;
    totalValue: number;
  }>(db.prepare(`
    SELECT
      COUNT(*) as totalParts,
      SUM(CASE WHEN minStock > 0 AND currentStock <= minStock THEN 1 ELSE 0 END) as lowStock,
      SUM(CASE WHEN currentStock <= 0 THEN 1 ELSE 0 END) as outOfStock,
      SUM(currentStock * price) as totalValue
    FROM scoped_spare_parts
  `).get());
  const unsyncedMovements = row<{ count: number }>(
    db.prepare("SELECT COUNT(*) as count FROM scoped_stock_movements WHERE syncStatus IN ('pending', 'failed')").get()
  ).count;

  return {
    totalParts: summary.totalParts || 0,
    lowStock: summary.lowStock || 0,
    outOfStock: summary.outOfStock || 0,
    totalValue: summary.totalValue || 0,
    unsyncedMovements: unsyncedMovements || 0
  };
}

export function listSpareInventory(): SpareInventoryResponse {
  const parts = rows<RawSparePart>(
    db.prepare("SELECT * FROM scoped_spare_parts ORDER BY category, searchName, itemNo").all()
  ).map(normalizeSparePart);
  const suppliers = rows<SpareSupplier>(
    db.prepare("SELECT * FROM scoped_spare_suppliers ORDER BY supplier, category, description").all()
  ).map(normalizeSupplier);

  return {
    parts,
    suppliers,
    recentMovements: listMovementDetails("", [], 12),
    summary: inventorySummary(),
    syncConfigured: plantContext.getStore()?.plant === "all" ? false : spareSyncConfigured()
  };
}

export function createSparePart(input: {
  actorId: string;
  itemNo: string;
  name: string;
  category?: string;
  uom?: string;
  currentStock?: number;
  minStock?: number;
  maxStock?: number;
  supplier?: string;
  price?: number;
  partRank?: string;
  status?: string;
  stockRank?: string;
  source?: string;
  leadTime?: string;
  description?: string;
}): SparePart {
  requireSpareManager(input.actorId);
  const itemNo = input.itemNo.trim();
  const name = (input.name || input.description || "").trim();
  const category = (input.category || "").trim();
  const uom = (input.uom || "pcs").trim() || "pcs";

  if (!itemNo) {
    throw new Error("Spare part item number is required.");
  }
  if (!name) {
    throw new Error("Spare part name is required.");
  }
  if (db.prepare("SELECT 1 FROM spare_parts WHERE itemNo = ?").get(itemNo)) {
    throw new Error("A spare part with this item number already exists.");
  }

  const timestamp = now();
  const currentStock = Number(input.currentStock ?? 0);
  const minStock = Number(input.minStock ?? 0);
  const maxStock = Number(input.maxStock ?? 0);

  db.prepare(`
    INSERT INTO spare_parts (plantId,
      itemNo, no, category, description, uom, price, partRank, status, stockRank,
      minStock, maxStock, searchName, openingStock, currentStock, source,
      supplier, supplier1, supplier2, supplier3, leadTime, active, createdAt, updatedAt
    ) VALUES (cmms_write_plant(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    itemNo,
    null,
    category,
    name,
    uom,
    Number(input.price ?? 0),
    input.partRank?.trim() || "",
    input.status?.trim() || "Active",
    input.stockRank?.trim() || "",
    minStock,
    maxStock,
    name,
    currentStock,
    currentStock,
    input.source?.trim() || "manual",
    input.supplier?.trim() || "",
    "",
    "",
    "",
    input.leadTime?.trim() || "",
    1,
    timestamp,
    timestamp
  );

  return getSparePart(itemNo);
}

export function listSpareMovementsForActor(actorId: string): StockMovementDetail[] {
  const actor = requireSpareActor(actorId);
  if (actor.role === "requester") {
    throw new Error("Technician access is required.");
  }
  return listMovementDetails("WHERE sm.actorId = ?", [actor.id], 100);
}

export function getSpareSyncSettings(): SpareSyncSettings {
  const settings = spareSyncRuntimeSettings();
  return {
    scriptUrl: settings.scriptUrl,
    hasToken: Boolean(settings.token),
    masterSheetName: settings.masterSheetName,
    supplierSheetName: settings.supplierSheetName,
    movementSheetName: settings.movementSheetName,
    configured: settings.configured
  };
}

export function updateSpareSyncSettings(input: UpdateSpareSyncSettingsInput): SpareSyncSettings {
  requireSpareManager(input.actorId);
  setSpareSetting("scriptUrl", input.scriptUrl.trim());
  if (input.token !== undefined && input.token.trim()) {
    setSpareSetting("token", input.token.trim());
  }
  setSpareSetting("masterSheetName", input.masterSheetName.trim() || "Masterlist");
  setSpareSetting("supplierSheetName", input.supplierSheetName.trim() || "Supplier");
  setSpareSetting("movementSheetName", input.movementSheetName.trim() || "Movement Log");
  return getSpareSyncSettings();
}

export function getSparePartDetail(itemNo: string): SparePartDetail {
  const part = getSparePart(itemNo);
  const allSuppliers = rows<SpareSupplier>(
    db.prepare("SELECT * FROM scoped_spare_suppliers ORDER BY supplier, description").all()
  ).map(normalizeSupplier);
  const supplierNames = new Set(
    [part.supplier, part.supplier1, part.supplier2, part.supplier3]
      .map((value) => value.toLowerCase().trim())
      .filter(Boolean)
  );
  const suppliers = allSuppliers.filter((supplier) => {
    const supplierName = supplier.supplier.toLowerCase().trim();
    return supplierNames.has(supplierName) || (!!part.category && supplier.category.toLowerCase() === part.category.toLowerCase());
  });

  return {
    ...part,
    suppliers,
    movements: listMovementDetails("WHERE sm.itemNo = ?", [part.itemNo], 80)
  };
}

function importSpareRows(actorId: string, masterRows: SheetRecord[], supplierRows: SheetRecord[]): SpareImportResult {
  requireSpareManager(actorId);
  const errors: string[] = [];
  let importedParts = 0;
  let updatedParts = 0;
  let skippedRows = 0;
  let importedSuppliers = 0;
  const seenItemNos = new Map<string, number>();
  const timestamp = now();
  const findPart = db.prepare("SELECT itemNo, currentStock FROM scoped_spare_parts WHERE itemNo = ?");
  const upsertPart = db.prepare(`
    INSERT INTO spare_parts (plantId,
      itemNo, no, category, description, uom, price, partRank, status, stockRank,
      minStock, maxStock, searchName, openingStock, currentStock, source,
      supplier, supplier1, supplier2, supplier3, leadTime, active, createdAt, updatedAt
    ) VALUES (cmms_write_plant(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(plantId, itemNo) DO UPDATE SET
      no = excluded.no,
      category = excluded.category,
      description = excluded.description,
      uom = excluded.uom,
      price = excluded.price,
      partRank = excluded.partRank,
      status = excluded.status,
      stockRank = excluded.stockRank,
      minStock = excluded.minStock,
      maxStock = excluded.maxStock,
      searchName = excluded.searchName,
      openingStock = excluded.openingStock,
      source = excluded.source,
      supplier = excluded.supplier,
      supplier1 = excluded.supplier1,
      supplier2 = excluded.supplier2,
      supplier3 = excluded.supplier3,
      leadTime = excluded.leadTime,
      active = excluded.active,
      updatedAt = excluded.updatedAt
  `);

  for (const [index, record] of masterRows.entries()) {
    const itemNo = getSheetValue(record, ["ITEM NO.", "ITEM NO", "ITEMNO", "PART NO", "PART NO."]);
    if (!itemNo) {
      skippedRows += 1;
      if (Object.values(record).some(Boolean)) {
        errors.push(`Master row ${index + 2}: ITEM NO. is required.`);
      }
      continue;
    }

    const normalizedItemNo = itemNo.toLowerCase();
    const firstSeenRow = seenItemNos.get(normalizedItemNo);
    if (firstSeenRow) {
      errors.push(`Master row ${index + 2}: duplicate ITEM NO. ${itemNo}; it updates row ${firstSeenRow}.`);
    } else {
      seenItemNos.set(normalizedItemNo, index + 2);
    }

    const existing = row<{ itemNo: string; currentStock: number } | undefined>(findPart.get(itemNo));
    const openingStock = parseSheetNumber(getSheetValue(record, ["OPENING", "OPENING STOCK"]));
    const currentStockValue = getSheetValue(record, ["CURRENT STOCK", "CURRENTSTOCK", "STOCK"]);
    const importedCurrentStock = currentStockValue ? parseSheetNumber(currentStockValue) : openingStock;
    const status = getSheetValue(record, ["STATUS"]);
    const itemName = getSheetValue(record, ["ITEM NAME", "ITEMNAME", "DESCRIPTION", "ITEM DESCRIPTION", "COLUMN 3", "COLUMN3"]);
    const searchName = getSheetValue(record, ["SEARCH NAME", "SEARCHNAME"]) || itemName;
    const description = itemName || searchName || itemNo;
    const active = !["inactive", "non active", "non-active", "obsolete", "discontinued"].includes(status.toLowerCase());

    upsertPart.run(
      itemNo,
      getSheetValue(record, ["NO", "NO."]),
      getSheetValue(record, ["CATEGORY"]),
      description,
      getSheetValue(record, ["OUM", "UOM", "UNIT"]),
      parseSheetNumber(getSheetValue(record, ["PRICE(RM)", "PRICE RM", "PRICE"])),
      getSheetValue(record, ["PART RANK", "PARTRANK"]),
      status,
      getSheetValue(record, ["STOCK RANK", "STOCKRANK"]),
      parseSheetNumber(getSheetValue(record, ["MIN", "MINIMUM"])),
      parseSheetNumber(getSheetValue(record, ["MAX", "MAXIMUM"])),
      searchName || description,
      openingStock,
      existing ? Number(existing.currentStock) || 0 : importedCurrentStock,
      getSheetValue(record, ["SOURCE"]),
      getSheetValue(record, ["SUPPLIER"]),
      getSheetValue(record, ["SUPPLIER 1", "SUPPLIER1"]),
      getSheetValue(record, ["SUPPLIER 2", "SUPPLIER2"]),
      getSheetValue(record, ["SUPPLIER 3", "SUPPLIER3"]),
      getSheetValue(record, ["LEAD TIME", "LEADTIME"]),
      boolNumber(active),
      timestamp,
      timestamp
    );

    if (existing) {
      updatedParts += 1;
    } else {
      importedParts += 1;
    }
  }

  if (supplierRows.length > 0) {
    db.prepare("DELETE FROM spare_suppliers WHERE plantId = cmms_write_plant()").run();
    const insertSupplier = db.prepare(`
      INSERT INTO spare_suppliers (plantId,
        id, no, category, description, supplier, address, pic, contactNo,
        faxNo, autoDial, email, createdAt, updatedAt
      ) VALUES (cmms_write_plant(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const [index, record] of supplierRows.entries()) {
      const supplier = getSheetValue(record, ["SUPPLIER"]);
      const description = getSheetValue(record, ["DESCRIPTION"]);
      if (!supplier && !description) {
        skippedRows += 1;
        continue;
      }

      insertSupplier.run(
        randomUUID(),
        getSheetValue(record, ["NO", "NO."]),
        getSheetValue(record, ["CATEGORY"]),
        description,
        supplier,
        getSheetValue(record, ["ADDRESS"]),
        getSheetValue(record, ["P.I.C", "PIC", "PERSON IN CHARGE"]),
        getSheetValue(record, ["CONTACT NO.", "CONTACT NO", "CONTACT"]),
        getSheetValue(record, ["FAKS NO.", "FAX NO.", "FAKS NO", "FAX NO"]),
        getSheetValue(record, ["AUTO DIAL", "AUTODIAL"]),
        getSheetValue(record, ["EMAIL"]),
        timestamp,
        timestamp
      );
      importedSuppliers += 1;

      if (index > 2000) {
        errors.push("Supplier import stopped after 2000 rows.");
        break;
      }
    }
  }

  return {
    importedParts,
    updatedParts,
    skippedRows,
    importedSuppliers,
    errors,
    inventory: listSpareInventory()
  };
}

export function importSpareParts(input: SpareImportInput): SpareImportResult {
  return importSpareRows(input.actorId, parseSheetText(input.masterText), input.supplierText ? parseSheetText(input.supplierText) : []);
}

export function lookupSpareQr(value: string): SpareQrLookupResult {
  const query = normalizeSpareQrValue(value);
  if (!query) {
    throw new Error("QR value is required.");
  }

  const exactPart = row<RawSparePart | undefined>(
    db.prepare("SELECT * FROM scoped_spare_parts WHERE lower(itemNo) = lower(?)").get(query)
  );
  if (exactPart) {
    return { query, exact: true, matches: [normalizeSparePart(exactPart)] };
  }

  const like = `%${query.replace(/[%_]/g, "")}%`;
  const matches = rows<RawSparePart>(
    db.prepare(`
      SELECT * FROM scoped_spare_parts
      WHERE lower(searchName) = lower(?)
        OR lower(description) = lower(?)
        OR itemNo LIKE ?
        OR searchName LIKE ?
        OR description LIKE ?
        OR supplier LIKE ?
        OR supplier1 LIKE ?
        OR supplier2 LIKE ?
        OR supplier3 LIKE ?
      ORDER BY
        CASE WHEN lower(searchName) = lower(?) OR lower(description) = lower(?) THEN 0 ELSE 1 END,
        category,
        searchName
      LIMIT 25
    `).all(query, query, like, like, like, like, like, like, like, query, query)
  ).map(normalizeSparePart);

  return { query, exact: false, matches };
}

function normalizeSpareQrValue(value: string) {
  const query = value.trim();
  if (!query) {
    return query;
  }

  try {
    const url = new URL(query, "https://cmms.local");
    const segments = url.pathname.split("/").filter(Boolean);
    const spareIndex = segments.indexOf("spare-parts");
    if (spareIndex === -1) {
      return query;
    }

    if (segments[spareIndex + 1] === "issue" && segments[spareIndex + 2]) {
      return decodeURIComponent(segments[spareIndex + 2]);
    }

    const maybeItemNo = segments[spareIndex + 1];
    if (maybeItemNo && !["scanner", "inventory", "setup"].includes(maybeItemNo)) {
      return decodeURIComponent(maybeItemNo);
    }
  } catch {
    return query;
  }

  return query;
}

function movementAfterStock(type: StockMovementType, beforeStock: number, quantity: number) {
  if (type === "issue" || type === "write_off") {
    return beforeStock - quantity;
  }

  return beforeStock + quantity;
}

function createStockMovement(input: {
  itemNo: string;
  workOrderId: string | null;
  actorId: string;
  type: StockMovementType;
  quantity: number;
  note: string;
  source: string;
}): StockMovementDetail {
  const timestamp = now();
  const movementId = randomUUID();
  const syncStatus: StockSyncStatus = spareSyncConfigured() ? "pending" : "disabled";
  let createdMovementId = "";

  db.exec("BEGIN IMMEDIATE");
  try {
    const rawPart = row<RawSparePart | undefined>(
      db.prepare("SELECT * FROM scoped_spare_parts WHERE itemNo = ?").get(input.itemNo)
    );
    if (!rawPart) {
      throw new Error("Spare part not found.");
    }
    const part = normalizeSparePart(rawPart);

    const afterStock = movementAfterStock(input.type, part.currentStock, input.quantity);
    if (afterStock < 0) {
      throw new Error(`Insufficient stock for ${part.itemNo}. Current stock is ${part.currentStock}.`);
    }

    db.prepare("UPDATE spare_parts SET currentStock = ?, updatedAt = ? WHERE itemNo = ? AND plantId = cmms_write_plant()")
      .run(afterStock, timestamp, part.itemNo);
    db.prepare(`
      INSERT INTO stock_movements (plantId,
        id, itemNo, workOrderId, actorId, type, quantity, beforeStock, afterStock,
        note, source, syncStatus, syncError, syncedAt, createdAt
      ) VALUES (cmms_write_plant(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      movementId,
      part.itemNo,
      input.workOrderId,
      input.actorId,
      input.type,
      input.quantity,
      part.currentStock,
      afterStock,
      input.note,
      input.source,
      syncStatus,
      null,
      null,
      timestamp
    );
    createdMovementId = movementId;
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return getMovementDetail(createdMovementId);
}

async function callSpareScript<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const settings = spareSyncRuntimeSettings();
  if (!settings.scriptUrl || !settings.token) {
    throw new Error("Apps Script sync is not configured.");
  }

  const response = await fetch(settings.scriptUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action,
      token: settings.token,
      sheetNames: spareSheetNames(),
      ...payload
    })
  });
  const body = await response.json().catch(() => null) as (T & { ok?: boolean; error?: string }) | null;
  if (!response.ok || !body || body.ok === false) {
    throw new Error(body?.error || `Apps Script ${action} failed with ${response.status}.`);
  }

  return body;
}

function recordSyncAttempt(action: string, status: "success" | "failed" | "disabled", message: string) {
  db.prepare("INSERT INTO spare_sync_attempts (plantId, id, action, status, message, createdAt) VALUES (cmms_write_plant(), ?, ?, ?, ?, ?)")
    .run(randomUUID(), action, status, message, now());
}

async function trySyncMovement(movementId: string) {
  if (!spareSyncConfigured()) {
    db.prepare("UPDATE stock_movements SET syncStatus = 'disabled', syncError = NULL WHERE id = ?").run(movementId);
    return false;
  }

  const movement = getMovementDetail(movementId);
  try {
    await callSpareScript("pushMovement", { movement });
    db.prepare("UPDATE stock_movements SET syncStatus = 'synced', syncError = NULL, syncedAt = ? WHERE id = ?")
      .run(now(), movementId);
    recordSyncAttempt("pushMovement", "success", `Synced movement ${movementId}.`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to sync movement.";
    db.prepare("UPDATE stock_movements SET syncStatus = 'failed', syncError = ? WHERE id = ?").run(message, movementId);
    recordSyncAttempt("pushMovement", "failed", message);
    return false;
  }
}

export async function issueSparePart(itemNo: string, input: SpareIssueInput): Promise<StockMovementDetail> {
  const actor = requireSpareActor(input.actorId);
  if (!["technician", "executive", "admin", "developer"].includes(actor.role)) {
    throw new Error("Only maintenance users can issue spare parts.");
  }
  const workOrder = getWorkOrder(input.workOrderId);
  if (["resolved", "closed", "cancelled"].includes(workOrder.status)) {
    throw new Error("Spare parts can only be issued to an active work order.");
  }
  if (!(input.quantity > 0)) {
    throw new Error("Quantity must be greater than zero.");
  }

  const movement = createStockMovement({
    itemNo,
    workOrderId: workOrder.id,
    actorId: actor.id,
    type: "issue",
    quantity: input.quantity,
    note: input.note?.trim() || `Issued to ${workOrder.number}.`,
    source: "qr_issue"
  });
  addActivity(workOrder.id, actor.id, "commented", null, `Issued spare ${movement.itemNo} x ${movement.quantity}.`);
  await trySyncMovement(movement.id);
  return getMovementDetail(movement.id);
}

export async function adjustSparePart(itemNo: string, input: SpareAdjustmentInput): Promise<StockMovementDetail> {
  const actor = requireSpareManager(input.actorId);
  const allowedTypes: Array<Exclude<StockMovementType, "issue">> = ["restock", "correction", "return", "write_off"];
  if (!allowedTypes.includes(input.type)) {
    throw new Error("Invalid adjustment type.");
  }
  if (!input.note.trim()) {
    throw new Error("Adjustment note is required.");
  }
  if (input.type !== "correction" && !(input.quantity > 0)) {
    throw new Error("Quantity must be greater than zero.");
  }
  if (input.type === "correction" && input.quantity === 0) {
    throw new Error("Correction quantity cannot be zero.");
  }

  const movement = createStockMovement({
    itemNo,
    workOrderId: null,
    actorId: actor.id,
    type: input.type,
    quantity: input.quantity,
    note: input.note.trim(),
    source: "manual_adjustment"
  });
  await trySyncMovement(movement.id);
  return getMovementDetail(movement.id);
}

export function listSparePartMovements(itemNo: string): StockMovementDetail[] {
  getSparePart(itemNo);
  return listMovementDetails("WHERE sm.itemNo = ?", [itemNo], 200);
}

export async function pullSparePartsFromSheet(actorId: string): Promise<SpareSyncResult> {
  requireSpareManager(actorId);
  if (!spareSyncConfigured()) {
    recordSyncAttempt("pullMasterData", "disabled", "Apps Script sync is not configured.");
    return {
      configured: false,
      ok: false,
      message: "Apps Script sync is not configured.",
      errors: ["Set SPARE_SYNC_SCRIPT_URL and SPARE_SYNC_TOKEN to enable live sync."]
    };
  }

  try {
    const result = await callSpareScript<{
      masterRows?: unknown;
      masterlist?: unknown;
      parts?: unknown;
      supplierRows?: unknown;
      suppliers?: unknown;
    }>("pullMasterData");
    const importResult = importSpareRows(
      actorId,
      recordsFromUnknown(result.masterRows ?? result.masterlist ?? result.parts),
      recordsFromUnknown(result.supplierRows ?? result.suppliers)
    );
    recordSyncAttempt("pullMasterData", "success", "Pulled spare master data from Apps Script.");
    return {
      configured: true,
      ok: true,
      message: "Spare master data synced from Google Sheet.",
      importedParts: importResult.importedParts,
      updatedParts: importResult.updatedParts,
      importedSuppliers: importResult.importedSuppliers,
      errors: importResult.errors,
      inventory: importResult.inventory
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to pull spare master data.";
    recordSyncAttempt("pullMasterData", "failed", message);
    return {
      configured: true,
      ok: false,
      message,
      errors: [message]
    };
  }
}

export async function retrySpareSync(actorId: string): Promise<SpareSyncResult> {
  requireSpareManager(actorId);
  if (!spareSyncConfigured()) {
    return {
      configured: false,
      ok: false,
      message: "Apps Script sync is not configured.",
      retriedMovements: 0,
      failedMovements: 0,
      errors: ["Set SPARE_SYNC_SCRIPT_URL and SPARE_SYNC_TOKEN to enable retry."]
    };
  }

  const movementIds = rows<{ id: string }>(
    db.prepare("SELECT id FROM scoped_stock_movements WHERE syncStatus IN ('pending', 'failed') ORDER BY createdAt ASC").all()
  ).map((movement) => movement.id);
  let retriedMovements = 0;
  let failedMovements = 0;

  for (const movementId of movementIds) {
    const ok = await trySyncMovement(movementId);
    if (ok) {
      retriedMovements += 1;
    } else {
      failedMovements += 1;
    }
  }

  return {
    configured: true,
    ok: failedMovements === 0,
    message: `${retriedMovements} movement sync retries succeeded, ${failedMovements} failed.`,
    retriedMovements,
    failedMovements,
    errors: [],
    inventory: listSpareInventory()
  };
}

function getWorkOrderSetting(key: string) {
  key = plantSettingKey(key);
  const setting = row<{ value: string } | undefined>(db.prepare("SELECT value FROM work_order_settings WHERE key = ?").get(key));
  return setting?.value || "";
}

function setWorkOrderSetting(key: string, value: string) {
  key = plantSettingKey(key);
  db.prepare(`
    INSERT INTO work_order_settings (key, value, updatedAt) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt
  `).run(key, value, now());
}

function workOrderSyncRuntimeSettings() {
  const scriptUrl = getWorkOrderSetting("scriptUrl") || (writePlant() === "port-klang" && process.env.WORK_ORDER_SYNC_SCRIPT_URL) || "";
  const token = getWorkOrderSetting("token") || (writePlant() === "port-klang" && process.env.WORK_ORDER_SYNC_TOKEN) || "";
  return {
    scriptUrl,
    token,
    sheetName: getWorkOrderSetting("sheetName") || (writePlant() === "port-klang" && process.env.WORK_ORDER_SYNC_SHEET_NAME) || "WorkOrders",
    webhookUrl: getWorkOrderSetting("webhookUrl") || (writePlant() === "port-klang" && process.env.WORK_ORDER_WEBHOOK_URL) || "",
    configured: Boolean(scriptUrl && token)
  };
}

export function getWorkOrderSyncSettings(): WorkOrderSyncSettings {
  const runtime = workOrderSyncRuntimeSettings();
  const updateCounts = row<{ pendingCount: number; failedCount: number }>(db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pendingCount,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failedCount
    FROM scoped_work_order_sync_queue
  `).get());
  const deletionCounts = row<{ pendingCount: number; failedCount: number }>(db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pendingCount,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failedCount
    FROM scoped_work_order_sync_deletions
  `).get());
  return {
    scriptUrl: runtime.scriptUrl,
    hasToken: Boolean(runtime.token),
    sheetName: runtime.sheetName,
    webhookUrl: runtime.webhookUrl,
    configured: runtime.configured,
    pendingCount: (updateCounts.pendingCount || 0) + (deletionCounts.pendingCount || 0),
    failedCount: (updateCounts.failedCount || 0) + (deletionCounts.failedCount || 0),
    lastSyncAt: getWorkOrderSetting("lastSyncAt") || null,
    lastError: getWorkOrderSetting("lastError") || null
  };
}

export function updateWorkOrderSyncSettings(input: UpdateWorkOrderSyncSettingsInput): WorkOrderSyncSettings {
  requireAdmin(input.actorId);
  const scriptUrl = input.scriptUrl.trim();
  const webhookUrl = input.webhookUrl?.trim() || "";
  for (const [label, value] of [["Apps Script URL", scriptUrl], ["Webhook URL", webhookUrl]] as const) {
    if (value && !/^https?:\/\//i.test(value)) throw new Error(`${label} must start with http:// or https://.`);
  }
  setWorkOrderSetting("scriptUrl", scriptUrl);
  setWorkOrderSetting("sheetName", input.sheetName.trim() || "WorkOrders");
  setWorkOrderSetting("webhookUrl", webhookUrl);
  if (input.token !== undefined && input.token.trim()) setWorkOrderSetting("token", input.token.trim());
  return getWorkOrderSyncSettings();
}

function airLeakSyncRuntimeSettings() {
  const inboundToken = getWorkOrderSetting("airLeakInboundToken") || process.env.APPSHEET_AIR_LEAK_INBOUND_TOKEN || "";
  const scriptUrl = getWorkOrderSetting("airLeakScriptUrl") || process.env.APPSHEET_AIR_LEAK_SCRIPT_URL || "";
  const scriptToken = getWorkOrderSetting("airLeakScriptToken") || process.env.APPSHEET_AIR_LEAK_SCRIPT_TOKEN || "";
  return {
    inboundToken,
    scriptUrl,
    scriptToken,
    sheetName: getWorkOrderSetting("airLeakSheetName") || process.env.APPSHEET_AIR_LEAK_SHEET_NAME || "Main",
    configured: Boolean(scriptUrl && scriptToken)
  };
}

export function getAirLeakSyncSettings(): AirLeakSyncSettings {
  const runtime = airLeakSyncRuntimeSettings();
  const counts = row<{ pendingCount: number; failedCount: number }>(db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pendingCount,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failedCount
    FROM scoped_air_leak_sync_queue
  `).get());
  return {
    hasInboundToken: Boolean(runtime.inboundToken),
    scriptUrl: runtime.scriptUrl,
    hasScriptToken: Boolean(runtime.scriptToken),
    sheetName: runtime.sheetName,
    configured: runtime.configured,
    pendingCount: counts.pendingCount || 0,
    failedCount: counts.failedCount || 0,
    lastSyncAt: getWorkOrderSetting("airLeakLastSyncAt") || null,
    lastError: getWorkOrderSetting("airLeakLastError") || null
  };
}

export function updateAirLeakSyncSettings(input: UpdateAirLeakSyncSettingsInput): AirLeakSyncSettings {
  requireAdmin(input.actorId);
  const scriptUrl = input.scriptUrl.trim();
  if (scriptUrl && !/^https:\/\//i.test(scriptUrl)) throw new Error("Apps Script URL must start with https://.");
  setWorkOrderSetting("airLeakScriptUrl", scriptUrl);
  setWorkOrderSetting("airLeakSheetName", input.sheetName.trim() || "Main");
  if (input.inboundToken?.trim()) setWorkOrderSetting("airLeakInboundToken", input.inboundToken.trim());
  if (input.scriptToken?.trim()) setWorkOrderSetting("airLeakScriptToken", input.scriptToken.trim());
  return getAirLeakSyncSettings();
}

export function authenticateAirLeakIntegration(token: string) {
  const expected = airLeakSyncRuntimeSettings().inboundToken;
  if (!expected || !token) return false;
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(token);
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

function enqueueAirLeakSync(workOrderId: string) {
  db.prepare(`
    INSERT INTO air_leak_sync_queue (plantId, workOrderId, status, attempts, lastError, queuedAt, syncedAt)
    SELECT plantId, workOrderId, 'pending', 0, NULL, ?, NULL
    FROM scoped_external_work_orders
    WHERE source = 'appsheet-air-leak' AND workOrderId = ?
    ON CONFLICT(workOrderId) DO UPDATE SET
      status = 'pending', attempts = 0, lastError = NULL, queuedAt = excluded.queuedAt, syncedAt = NULL
  `).run(now(), workOrderId);
}

function enqueueWorkOrderSync(workOrderId: string, notifyWebhook = false) {
  db.prepare(`
    INSERT INTO work_order_sync_queue (plantId, workOrderId, status, attempts, lastError, queuedAt, syncedAt, webhookPending)
    VALUES (cmms_write_plant(), ?, 'pending', 0, NULL, ?, NULL, ?)
    ON CONFLICT(workOrderId) DO UPDATE SET
      status = 'pending', attempts = 0, lastError = NULL, queuedAt = excluded.queuedAt, syncedAt = NULL,
      webhookPending = MAX(work_order_sync_queue.webhookPending, excluded.webhookPending)
  `).run(workOrderId, now(), boolNumber(notifyWebhook));
  enqueueAirLeakSync(workOrderId);
}

function enqueueWorkOrderSheetDeletion(workOrderNumber: string) {
  db.prepare(`
    INSERT INTO work_order_sync_deletions (plantId, workOrderNumber, status, attempts, lastError, queuedAt)
    VALUES (cmms_write_plant(), ?, 'pending', 0, NULL, ?)
    ON CONFLICT(workOrderNumber) DO UPDATE SET
      status = 'pending', attempts = 0, lastError = NULL, queuedAt = excluded.queuedAt
  `).run(workOrderNumber, now());
}

function publicMediaUrl(url: string | undefined) {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  const base = (process.env.APP_PUBLIC_URL || "").replace(/\/$/, "");
  return base ? `${base}${url.startsWith("/") ? "" : "/"}${url}` : url;
}

function elapsedMinutes(start: string, end: string) {
  if (!start || !end) return "";
  const duration = Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 60000));
  return Number.isFinite(duration) ? duration : "";
}

function workOrderSheetRow(workOrderId: string) {
  const detail = getWorkOrderDetail(workOrderId);
  const latestActivityAt = (action: ActivityAction) => detail.activities.find((item) => item.action === action)?.createdAt || "";
  const acknowledgedAt = [...detail.activities].reverse().find((item) => item.action === "acknowledged")?.createdAt || "";
  const repairStartedAt = detail.maintenanceStartedAt || "";
  const resolvedAt = detail.resolvedAt || "";
  const closedAt = latestActivityAt("closed");
  const issuePhoto = detail.attachments.find((item) => item.kind === "issue");
  const fixPhoto = detail.attachments.find((item) => item.kind === "after");
  const returnPhoto = detail.attachments.find((item) => item.kind === "return_evidence");
  const parts = rows<{ searchName: string; itemNo: string; quantity: number }>(db.prepare(`
    SELECT sp.searchName, sm.itemNo, SUM(sm.quantity) AS quantity
    FROM scoped_stock_movements sm JOIN scoped_spare_parts sp ON sp.itemNo = sm.itemNo AND sp.plantId = sm.plantId
    WHERE sm.workOrderId = ? AND sm.type = 'issue'
    GROUP BY sm.itemNo, sp.searchName ORDER BY sm.createdAt
  `).all(workOrderId));
  const comments = detail.activities.filter((item) => item.action === "commented").reverse();
  return {
    WorkOrderID: detail.number,
    DateSubmitted: detail.createdAt,
    Date: detail.workDate,
    Shift: detail.shiftGroup,
    Type: detail.type[0].toUpperCase() + detail.type.slice(1),
    Section: detail.section?.name || detail.location,
    Area: detail.area,
    "Machine Name": detail.machineName,
    MachineID: detail.machineId || "",
    IssueCategory: detail.issueCategoryName || detail.issueCategory?.name || "Other",
    ReportedBy: detail.reportedByName,
    Department: detail.reportedByDepartment,
    ResponsibleDepartment: detail.responsibleDepartment,
    Priority: detail.priority[0].toUpperCase() + detail.priority.slice(1),
    IssueDescription: detail.issueDescription,
    PhotoIssue: publicMediaUrl(issuePhoto?.url),
    "Downtime Actual": elapsedMinutes(repairStartedAt, resolvedAt),
    "Total Downtime": elapsedMinutes(detail.createdAt, closedAt),
    "Total Time": elapsedMinutes(detail.createdAt, closedAt),
    "Production Downtime": elapsedMinutes(detail.createdAt, resolvedAt),
    "Total Queue Time": elapsedMinutes(detail.createdAt, repairStartedAt),
    "System Repair Elapsed": elapsedMinutes(repairStartedAt, resolvedAt),
    "Maintenance Actual": detail.maintenanceActualMinutes ?? "",
    "Maintenance Team": [detail.assignedTo?.name, ...detail.supportingTechnicians.map((technician) => technician.name)].filter(Boolean).join(" | "),
    "Downtime Reason": detail.productionDowntimeReason || "",
    Status: workOrderStatusLabels[detail.status],
    MaintenanceBy: detail.assignedTo?.name || "",
    MaintenanceNotes: detail.completionNote || "",
    PhotoFix: publicMediaUrl(fixPhoto?.url),
    DateAcknowledge: acknowledgedAt,
    AcknowledgeTime: elapsedMinutes(detail.createdAt, acknowledgedAt),
    DateRepair: repairStartedAt,
    RepairTime: elapsedMinutes(repairStartedAt, resolvedAt),
    FinishTime: elapsedMinutes(detail.createdAt, resolvedAt),
    VerifyTime: elapsedMinutes(resolvedAt, closedAt),
    "Change Spare Part": parts.length ? "Yes" : "No",
    "Part Name": parts.map((part) => part.searchName).join(" | "),
    Quantity: parts.map((part) => part.quantity).join(" | "),
    "Part Number": parts.map((part) => part.itemNo).join(" | "),
    DateResolved: resolvedAt,
    "Date Finish": resolvedAt ? resolvedAt.slice(0, 10) : "",
    DateClosed: closedAt,
    Remarks: comments.map((item) => item.message).join(" | "),
    ReturnPhoto: publicMediaUrl(returnPhoto?.url),
    UpdatedAt: detail.updatedAt
  };
}

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  const result = await response.json().catch(() => ({ ok: true }));
  if (result?.ok === false || result?.success === false) throw new Error(String(result.error || result.message || "Integration rejected the update."));
}

function airLeakSheetRow(workOrderId: string) {
  const detail = getWorkOrderDetail(workOrderId);
  const external = row<{ externalId: string } | undefined>(db.prepare(`
    SELECT externalId FROM scoped_external_work_orders
    WHERE source = 'appsheet-air-leak' AND workOrderId = ?
  `).get(workOrderId));
  if (!external) throw new Error("Air leak integration mapping not found.");
  const proof = detail.attachments.find((attachment) => attachment.kind === "after");
  const proofUrl = proof
    ? `${publicMediaUrl(proof.url)}?token=${encodeURIComponent(guestTrackingToken(workOrderId))}`
    : "";
  return {
    "Air Leak ID": external.externalId,
    "CMMS Work Order ID": detail.id,
    "CMMS Work Order No": detail.number,
    Status: detail.status === "closed" ? "Close" : "Open",
    "CMMS Status": workOrderStatusLabels[detail.status],
    "Close Date": detail.closedAt ? detail.closedAt.slice(0, 10) : "",
    "Picture Proof": proofUrl,
    "Close By": detail.assignedTo?.name || "",
    "CMMS Updated At": detail.updatedAt,
    "Integration Status": "Synced",
    "Integration Error": ""
  };
}

const activeAirLeakSync = new Map<string, Promise<AirLeakSyncResult>>();

export function flushAirLeakSyncQueue(actorId?: string): Promise<AirLeakSyncResult> {
  const plant = writePlant();
  const active = activeAirLeakSync.get(plant);
  if (active) return active;
  const pending = runAirLeakSyncQueue(actorId).finally(() => { activeAirLeakSync.delete(plant); });
  activeAirLeakSync.set(plant, pending);
  return pending;
}

async function runAirLeakSyncQueue(actorId?: string): Promise<AirLeakSyncResult> {
  if (actorId) requireAdmin(actorId);
  const runtime = airLeakSyncRuntimeSettings();
  if (!runtime.configured) {
    return { configured: false, ok: false, synced: 0, failed: 0, message: "Air Leak return sync is not configured.", errors: [], settings: getAirLeakSyncSettings() };
  }
  const queued = rows<{ workOrderId: string }>(db.prepare(`
    SELECT workOrderId FROM scoped_air_leak_sync_queue
    WHERE status IN ('pending', 'failed') ORDER BY queuedAt LIMIT 100
  `).all());
  let synced = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const item of queued) {
    try {
      await postJson(runtime.scriptUrl, {
        token: runtime.scriptToken,
        action: "updateAirLeak",
        sheetName: runtime.sheetName,
        Data: airLeakSheetRow(item.workOrderId)
      });
      const syncedAt = now();
      db.prepare("UPDATE air_leak_sync_queue SET status = 'synced', attempts = attempts + 1, lastError = NULL, syncedAt = ? WHERE workOrderId = ?")
        .run(syncedAt, item.workOrderId);
      setWorkOrderSetting("airLeakLastSyncAt", syncedAt);
      synced += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Air Leak sync error";
      db.prepare("UPDATE air_leak_sync_queue SET status = 'failed', attempts = attempts + 1, lastError = ? WHERE workOrderId = ?")
        .run(message, item.workOrderId);
      setWorkOrderSetting("airLeakLastError", message);
      errors.push(`${item.workOrderId}: ${message}`);
      failed += 1;
    }
  }
  if (!failed) setWorkOrderSetting("airLeakLastError", "");
  return {
    configured: true,
    ok: failed === 0,
    synced,
    failed,
    message: queued.length ? `${synced} Air Leak updates synced, ${failed} failed.` : "All Air Leak work orders are already synced.",
    errors,
    settings: getAirLeakSyncSettings()
  };
}

const activeWorkOrderSync = new Map<string, Promise<WorkOrderSyncResult>>();

export function flushWorkOrderSyncQueue(actorId?: string): Promise<WorkOrderSyncResult> {
  const plant = writePlant();
  const active = activeWorkOrderSync.get(plant);
  if (active) return active;
  const pending = runWorkOrderSyncQueue(actorId).finally(() => { activeWorkOrderSync.delete(plant); });
  activeWorkOrderSync.set(plant, pending);
  return pending;
}

async function runWorkOrderSyncQueue(actorId?: string): Promise<WorkOrderSyncResult> {
  if (actorId) requireAdmin(actorId);
  const runtime = workOrderSyncRuntimeSettings();
  if (!runtime.configured) {
    return { configured: false, ok: false, synced: 0, failed: 0, message: "Google Sheets sync is not configured.", errors: [], settings: getWorkOrderSyncSettings() };
  }
  const queued = rows<{ workOrderId: string; status: string; webhookPending: number }>(db.prepare("SELECT workOrderId, status, webhookPending FROM scoped_work_order_sync_queue WHERE status IN ('pending', 'failed') OR webhookPending = 1 ORDER BY queuedAt LIMIT 100").all());
  const deletions = rows<{ workOrderNumber: string }>(
    db.prepare("SELECT workOrderNumber FROM scoped_work_order_sync_deletions WHERE status IN ('pending', 'failed') ORDER BY queuedAt LIMIT 100").all()
  );
  let synced = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const item of queued) {
    const data = workOrderSheetRow(item.workOrderId);
    let itemFailed = false;
    try {
      if (item.status !== "synced") {
        await postJson(runtime.scriptUrl, { token: runtime.token, action: "upsertWorkOrder", sheetName: runtime.sheetName, Data: data });
        const syncedAt = now();
        db.prepare("UPDATE work_order_sync_queue SET status = 'synced', attempts = attempts + 1, lastError = NULL, syncedAt = ? WHERE workOrderId = ?").run(syncedAt, item.workOrderId);
        setWorkOrderSetting("lastSyncAt", syncedAt);
        synced += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown sync error";
      db.prepare("UPDATE work_order_sync_queue SET status = 'failed', attempts = attempts + 1, lastError = ? WHERE workOrderId = ?").run(message, item.workOrderId);
      setWorkOrderSetting("lastError", message);
      errors.push(`${item.workOrderId} Google Sheet: ${message}`);
      itemFailed = true;
    }
    const waitingForIssuePhoto = data.Status === "Open" && !data.PhotoIssue && Date.now() - Date.parse(data.DateSubmitted) < 10000;
    if (item.webhookPending && runtime.webhookUrl && !waitingForIssuePhoto) {
      try {
        await postJson(runtime.webhookUrl, { Source: "CMMS", Data: data });
        db.prepare("UPDATE work_order_sync_queue SET webhookPending = 0 WHERE workOrderId = ?").run(item.workOrderId);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown webhook error";
        db.prepare("UPDATE work_order_sync_queue SET lastError = ? WHERE workOrderId = ?").run(message, item.workOrderId);
        setWorkOrderSetting("lastError", message);
        errors.push(`${item.workOrderId} webhook: ${message}`);
        itemFailed = true;
      }
    }
    if (itemFailed) failed += 1;
  }
  for (const deletion of deletions) {
    try {
      await postJson(runtime.scriptUrl, {
        token: runtime.token,
        action: "deleteWorkOrder",
        sheetName: runtime.sheetName,
        WorkOrderID: deletion.workOrderNumber
      });
      db.prepare("DELETE FROM work_order_sync_deletions WHERE workOrderNumber = ?").run(deletion.workOrderNumber);
      setWorkOrderSetting("lastSyncAt", now());
      synced += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown sync error";
      db.prepare(`
        UPDATE work_order_sync_deletions
        SET status = 'failed', attempts = attempts + 1, lastError = ?
        WHERE workOrderNumber = ?
      `).run(message, deletion.workOrderNumber);
      setWorkOrderSetting("lastError", message);
      errors.push(`${deletion.workOrderNumber} Google Sheet deletion: ${message}`);
      failed += 1;
    }
  }
  if (failed === 0) setWorkOrderSetting("lastError", "");
  return {
    configured: true,
    ok: failed === 0,
    synced,
    failed,
    message: queued.length || deletions.length ? `${synced} work-order changes synced, ${failed} failed.` : "All work orders are already synced.",
    errors,
    settings: getWorkOrderSyncSettings()
  };
}

type StoredWorkOrder = Omit<WorkOrder, "supportingTechnicianIds"> & { supportingTechnicianIds: string | string[] | null };

function hydrateWorkOrderTeam(workOrder: StoredWorkOrder): WorkOrder {
  let supportingTechnicianIds: string[] = [];
  if (Array.isArray(workOrder.supportingTechnicianIds)) {
    supportingTechnicianIds = workOrder.supportingTechnicianIds;
  } else if (workOrder.supportingTechnicianIds) {
    try {
      const parsed = JSON.parse(workOrder.supportingTechnicianIds) as unknown;
      if (Array.isArray(parsed)) supportingTechnicianIds = parsed.filter((id): id is string => typeof id === "string");
    } catch {
      supportingTechnicianIds = [];
    }
  }
  return { ...workOrder, supportingTechnicianIds };
}

export function listWorkOrders(actor?: User): WorkOrder[] {
  const workOrders = rows<StoredWorkOrder>(db.prepare(`
    SELECT wo.*,
      (SELECT activity.createdAt FROM scoped_work_order_activities activity
       WHERE activity.workOrderId = wo.id AND activity.action = 'started'
       ORDER BY activity.createdAt ASC LIMIT 1) AS maintenanceStartedAt,
      (SELECT activity.createdAt FROM scoped_work_order_activities activity
       WHERE activity.workOrderId = wo.id AND activity.action = 'resolved'
       ORDER BY activity.createdAt DESC LIMIT 1) AS resolvedAt,
      (SELECT activity.createdAt FROM scoped_work_order_activities activity
       WHERE activity.workOrderId = wo.id AND activity.action = 'closed'
       ORDER BY activity.createdAt DESC LIMIT 1) AS closedAt
    FROM scoped_work_orders wo
    ORDER BY wo.updatedAt DESC
  `).all()).map(hydrateWorkOrderTeam);
  if (!actor) return workOrders;
  if (actor.role === "requester") return workOrders;
  if (actor.role === "technician") return workOrders.filter((workOrder) => technicianCanAccessWorkOrder(actor, workOrder));
  return workOrders;
}

export function userCanAccessWorkOrder(actor: User, workOrder: WorkOrder) {
  if (actor.role === "requester") return true;
  return actor.role !== "technician" || technicianCanAccessWorkOrder(actor, workOrder);
}

export function listTvWorkOrders(): TvWorkOrder[] {
  return rows<TvWorkOrder>(db.prepare(`
    SELECT id, number, title, location, area, machineName, assetName, priority, status, updatedAt
    FROM scoped_work_orders WHERE status NOT IN ('closed', 'cancelled') ORDER BY updatedAt DESC
  `).all());
}

export function getWorkOrder(id: string): WorkOrder {
  const workOrder = db.prepare(`
    SELECT wo.*,
      (SELECT activity.createdAt FROM scoped_work_order_activities activity
       WHERE activity.workOrderId = wo.id AND activity.action = 'started'
       ORDER BY activity.createdAt ASC LIMIT 1) AS maintenanceStartedAt,
      (SELECT activity.createdAt FROM scoped_work_order_activities activity
       WHERE activity.workOrderId = wo.id AND activity.action = 'resolved'
       ORDER BY activity.createdAt DESC LIMIT 1) AS resolvedAt,
      (SELECT activity.createdAt FROM scoped_work_order_activities activity
       WHERE activity.workOrderId = wo.id AND activity.action = 'closed'
       ORDER BY activity.createdAt DESC LIMIT 1) AS closedAt
    FROM scoped_work_orders wo
    WHERE wo.id = ?
  `).get(id);
  if (!workOrder) {
    throw new Error("Work order not found");
  }

  return hydrateWorkOrderTeam(row<StoredWorkOrder>(workOrder));
}

export function getWorkOrderDetail(id: string): WorkOrderDetail {
  const workOrder = getWorkOrder(id);
  const requester = getUser(workOrder.requesterId);
  const assignedTo = workOrder.assignedToId ? getUser(workOrder.assignedToId) : null;
  const supportingTechnicians = workOrder.supportingTechnicianIds.map((userId) => getUser(userId));
  const section = getOptionalSection(workOrder.sectionId);
  const machine = getOptionalMachine(workOrder.machineId);
  const issueCategory = getOptionalIssueCategory(workOrder.issueCategoryId);
  const activities = rows<WorkOrderActivity>(
    db.prepare("SELECT * FROM scoped_work_order_activities WHERE workOrderId = ? ORDER BY createdAt DESC").all(id)
  );
  const attachments = rows<WorkOrderAttachment>(
    db.prepare("SELECT * FROM scoped_work_order_attachments WHERE workOrderId = ? ORDER BY createdAt DESC").all(id)
  );

  return { ...workOrder, requester, assignedTo, supportingTechnicians, section, machine, issueCategory, activities, attachments };
}

export function createWorkOrder(input: CreateWorkOrderInput): WorkOrder {
  const id = randomUUID();
  const createdAt = now();
  const requester = getUser(input.requesterId);
  const section = input.sectionId ? getSection(input.sectionId) : null;
  const machine = input.machineId ? getMachine(input.machineId) : null;
  const issueCategory = input.issueCategoryId ? getIssueCategory(input.issueCategoryId) : null;
  const issueCategoryName = issueCategory?.name || input.issueCategoryName?.trim() || "Other";
  const machineName = input.machineName?.trim() || machine?.name || input.assetName?.trim() || "Others";
  const area = input.area?.trim() || machine?.area || "General";
  const sectionName = section?.name || input.location?.trim() || "Unassigned";
  const issueDescription = input.issueDescription?.trim() || input.description?.trim() || input.title?.trim() || "No issue description provided.";
  const title = input.title?.trim() || `${machineName} - ${issueCategoryName}`;
  const description = input.description?.trim() || issueDescription;
  const workDate = input.workDate || createdAt.slice(0, 10);
  const reportedByName = input.reportedByName?.trim() || requester.name;
  const reportedByDepartment = input.reportedByDepartment?.trim() || requester.department;
  const responsibleDepartment = normalizeWorkOrderDepartment(input.responsibleDepartment || reportedByDepartment);
  if (section && section.department !== responsibleDepartment) {
    throw new Error(`The selected section belongs to ${section.department}, not ${responsibleDepartment}.`);
  }
  if (machine && (machine.department !== responsibleDepartment || (section && machine.sectionId !== section.id))) {
    throw new Error("The selected machine does not belong to the responsible department and section.");
  }
  if (issueCategory && issueCategory.department !== responsibleDepartment) {
    throw new Error(`The selected issue category belongs to ${issueCategory.department}, not ${responsibleDepartment}.`);
  }
  const shiftGroup = responsibleDepartment === "Production" ? (input.shiftGroup === "B" ? "B" : "A") : "N/A";
  const number = nextWorkOrderNumber(input.type, section?.name || input.location || "General", responsibleDepartment);

  db.prepare(`
    INSERT INTO work_orders (plantId,
      id, number, type, title, description, assetName, location, priority, status,
      requesterId, assignedToId, dueDate, completionNote, workDate, shiftGroup, sectionId,
      machineId, area, machineName, reportedByName, reportedByDepartment, responsibleDepartment,
      issueCategoryId, issueCategoryName, issueDescription, createdAt, updatedAt
    ) VALUES (cmms_write_plant(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    number,
    input.type,
    title,
    description,
    machineName,
    sectionName,
    input.priority || "medium",
    "open",
    input.requesterId,
    null,
    input.dueDate || null,
    null,
    workDate,
    shiftGroup,
    section?.id || null,
    machine?.id || null,
    area,
    machineName,
    reportedByName,
    reportedByDepartment,
    responsibleDepartment,
    issueCategory?.id || null,
    issueCategoryName,
    issueDescription,
    createdAt,
    createdAt
  );

  addActivity(id, input.requesterId, "created", "open", "Work order issued.");
  notifyUsers(
    listMaintenanceUsers()
      .filter((user) => user.role !== "technician" || technicianCanAccessWorkOrder(user, { type: input.type }))
      .map((user) => user.id),
    id,
    `New work order ${number}`,
    `${title} at ${sectionName}`
  );
  enqueueWorkOrderSync(id, true);

  return getWorkOrder(id);
}

function normalizeExternalWorkDate(value: string) {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const usDate = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (usDate) {
    const [, month, day, year] = usDate;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? now().slice(0, 10) : parsed.toISOString().slice(0, 10);
}

export function upsertAppSheetAirLeak(input: AppSheetAirLeakInput): AppSheetAirLeakResult {
  const externalId = input.airLeakId.trim();
  const issue = input.issue.trim();
  if (!externalId || !issue) throw new Error("Air Leak ID and issue are required.");
  if (externalId.length > 100) throw new Error("Air Leak ID is too long.");

  const existing = row<{ workOrderId: string } | undefined>(db.prepare(`
    SELECT workOrderId FROM scoped_external_work_orders
    WHERE source = 'appsheet-air-leak' AND externalId = ?
  `).get(externalId));
  if (existing) {
    const workOrder = getWorkOrder(existing.workOrderId);
    return {
      ok: true,
      created: false,
      workOrderId: workOrder.id,
      workOrderNumber: workOrder.number,
      status: workOrderStatusLabels[workOrder.status],
      photoImported: false
    };
  }

  const sectionName = input.section.trim();
  const machineName = input.machine.trim();
  const section = sectionName ? row<Section | undefined>(db.prepare(`
    SELECT * FROM scoped_sections
    WHERE department = 'SHE' AND active = 1 AND lower(name) = lower(?)
    LIMIT 1
  `).get(sectionName)) : undefined;
  const machine = machineName ? row<Machine | undefined>(db.prepare(`
    SELECT * FROM scoped_machines
    WHERE department = 'SHE' AND active = 1
      AND lower(name) = lower(?)
      AND (? IS NULL OR sectionId = ?)
    ORDER BY CASE WHEN sectionId = ? THEN 0 ELSE 1 END, name
    LIMIT 1
  `).get(machineName, section?.id || null, section?.id || null, section?.id || null)) : undefined;
  const issueCategory = row<IssueCategory | undefined>(db.prepare(`
    SELECT * FROM scoped_issue_categories
    WHERE department = 'SHE' AND active = 1 AND lower(name) = 'air leak'
    LIMIT 1
  `).get());

  const workOrder = createWorkOrder({
    type: "maintenance",
    title: `Air leak ${externalId} - ${machineName || "Equipment"}`,
    requesterId: publicRequesterId,
    workDate: normalizeExternalWorkDate(input.date),
    shiftGroup: "N/A",
    sectionId: section?.id || null,
    location: section?.name || sectionName || "SHE",
    machineId: machine?.id || null,
    area: machine?.area || "General",
    machineName: machine?.name || machineName || "Not specified",
    reportedByName: input.issuedBy.trim() || "Safety Department",
    reportedByDepartment: "SHE",
    responsibleDepartment: "SHE",
    issueCategoryId: issueCategory?.id || null,
    issueCategoryName: issueCategory?.name || "Air Leak",
    issueDescription: issue,
    priority: "medium"
  });
  const timestamp = now();
  db.prepare(`
    INSERT INTO external_work_orders (plantId, source, externalId, workOrderId, createdAt, updatedAt)
    VALUES (cmms_write_plant(), 'appsheet-air-leak', ?, ?, ?, ?)
  `).run(externalId, workOrder.id, timestamp, timestamp);
  enqueueAirLeakSync(workOrder.id);
  return {
    ok: true,
    created: true,
    workOrderId: workOrder.id,
    workOrderNumber: workOrder.number,
    status: workOrderStatusLabels[workOrder.status],
    photoImported: false
  };
}

export function updateWorkOrder(id: string, input: UpdateWorkOrderInput): WorkOrder {
  const current = getWorkOrder(id);
  requireWorkOrderManager(input.actorId);

  const section = input.sectionId ? getSection(input.sectionId) : null;
  const machine = input.machineId ? getMachine(input.machineId) : null;
  if (machine && section && machine.sectionId !== section.id) {
    throw new Error("The selected machine does not belong to the selected section.");
  }

  const issueCategory = input.issueCategoryId ? getIssueCategory(input.issueCategoryId) : null;
  const issueCategoryName = issueCategory?.name || input.issueCategoryName?.trim() || "Other";
  const issueDescription = input.issueDescription.trim();
  if (!issueDescription) {
    throw new Error("Issue description is required.");
  }

  const machineName = input.machineName?.trim() || machine?.name || current.machineName || "Others";
  const area = input.area?.trim() || machine?.area || current.area || "General";
  const location = section?.name || current.location || "Unassigned";
  const responsibleDepartment = normalizeWorkOrderDepartment(input.responsibleDepartment);
  if (section && section.department !== responsibleDepartment) {
    throw new Error(`The selected section belongs to ${section.department}, not ${responsibleDepartment}.`);
  }
  if (machine && machine.department !== responsibleDepartment) {
    throw new Error(`The selected machine belongs to ${machine.department}, not ${responsibleDepartment}.`);
  }
  if (issueCategory && issueCategory.department !== responsibleDepartment) {
    throw new Error(`The selected issue category belongs to ${issueCategory.department}, not ${responsibleDepartment}.`);
  }
  const shiftGroup = responsibleDepartment === "Production" ? (input.shiftGroup === "B" ? "B" : "A") : "N/A";
  const assignedToId = input.assignedToId === undefined ? current.assignedToId : input.assignedToId;
  if (assignedToId) {
    const leadTechnician = getUser(assignedToId);
    if (leadTechnician.role !== "technician" || !userPlants(leadTechnician).includes(current.plantId) || !technicianCanAccessWorkOrder(leadTechnician, { ...current, type: input.type })) {
      throw new Error("Select a lead technician from the team responsible for this work-order type.");
    }
  }
  const supportingTechnicianIds = input.supportingTechnicianIds === undefined
    ? current.supportingTechnicianIds
    : [...new Set(input.supportingTechnicianIds.filter(Boolean))].filter((userId) => userId !== assignedToId);
  if (!assignedToId && supportingTechnicianIds.length) {
    throw new Error("Choose a lead technician before adding supporting technicians.");
  }
  if (supportingTechnicianIds.length > 3) {
    throw new Error("Select no more than 3 supporting technicians.");
  }
  if (["resolved", "closed"].includes(current.status) && (input.assignedToId !== undefined || input.supportingTechnicianIds !== undefined) && supportingTechnicianIds.length < 1) {
    throw new Error("Completed work orders must record at least 1 supporting technician.");
  }
  for (const userId of supportingTechnicianIds) {
    const technician = getUser(userId);
    if (technician.role !== "technician" || !userPlants(technician).includes(current.plantId)) {
      throw new Error("Every supporting person must be a technician with access to this plant.");
    }
  }
  const productionDowntimeReason = input.productionDowntimeReason === undefined
    ? current.productionDowntimeReason
    : input.productionDowntimeReason?.trim() || null;
  const completionNote = input.completionNote === undefined
    ? current.completionNote
    : input.completionNote?.trim() || null;
  const updatedAt = now();

  db.prepare(
    "UPDATE work_orders SET type = ?, title = ?, description = ?, assetName = ?, location = ?, priority = ?, " +
    "dueDate = ?, workDate = ?, shiftGroup = ?, sectionId = ?, machineId = ?, area = ?, machineName = ?, " +
    "reportedByName = ?, reportedByDepartment = ?, responsibleDepartment = ?, issueCategoryId = ?, issueCategoryName = ?, " +
    "issueDescription = ?, completionNote = ?, assignedToId = ?, supportingTechnicianIds = ?, productionDowntimeReason = ?, updatedAt = ? WHERE id = ?"
  ).run(
    input.type,
    machineName + " - " + issueCategoryName,
    issueDescription,
    machineName,
    location,
    input.priority,
    input.dueDate || null,
    input.workDate,
    shiftGroup,
    section?.id || null,
    machine?.id || null,
    area,
    machineName,
    input.reportedByName.trim(),
    input.reportedByDepartment.trim(),
    responsibleDepartment,
    issueCategory?.id || null,
    issueCategoryName,
    issueDescription,
    completionNote,
    assignedToId,
    JSON.stringify(supportingTechnicianIds),
    productionDowntimeReason,
    updatedAt,
    id
  );

  addActivity(id, input.actorId, "edited", null, "Work order brief and maintenance team edited.");
  enqueueWorkOrderSync(id, true);
  return getWorkOrder(id);
}

function nextWorkOrderNumber(type: WorkOrderType, sectionName: string, responsibleDepartment: WorkOrderDepartment) {
  const date = new Date();
  const yearMonth = `${String(date.getFullYear()).slice(-2)}${String(date.getMonth() + 1).padStart(2, "0")}`;
  const sectionCode = sectionName.toLowerCase().includes("roll") ? "RM" : sectionName.toLowerCase().includes("conversion") ? "CV" : "GEN";
  const typeCode: Record<WorkOrderType, string> = { office: "OFF", maintenance: "MNT", project: "PRJ", kaizen: "KZN" };
  const departmentCode: Record<WorkOrderDepartment, string> = {
    Logistic: "LOG",
    Production: "PROD",
    SHE: "SHE",
    DTU: "DTU",
    "R&D": "RND",
    Account: "ACC",
    Management: "MGT",
    "Business Development": "BD"
  };
  const counterKey = `${writePlant()}-${yearMonth}-${departmentCode[responsibleDepartment]}-${sectionCode}-${typeCode[type]}`;
  const counter = row<{ value: number }>(db.prepare(`
    INSERT INTO work_order_counters (counterKey, value) VALUES (?, 1)
    ON CONFLICT(counterKey) DO UPDATE SET value = value + 1
    RETURNING value
  `).get(counterKey));
  return `WO-${writePlant() === "sendayan" ? "SDN-" : ""}${departmentCode[responsibleDepartment]}-${sectionCode}-${typeCode[type]}-${yearMonth}-${String(counter.value).padStart(3, "0")}`;
}

export function updateWorkOrderStatus(id: string, input: UpdateWorkOrderStatusInput): WorkOrder {
  const current = getWorkOrder(id);
  const actor = getUser(input.actorId);
  const elevated = ["executive", "admin", "developer"].includes(actor.role);
  if (actor.role === "requester" && (current.requesterId !== actor.id || !["closed", "returned", "cancelled"].includes(input.status))) {
    throw new Error("Requesters may only close, return, or cancel their own work orders.");
  }
  if (actor.role === "requester" && input.status === "cancelled" &&
      (!['open', 'acknowledged'].includes(current.status) || Boolean(current.maintenanceStartedAt))) {
    throw new Error("A requester can only cancel a work order before repair work starts.");
  }
  const effectiveAssignment = current.assignedToId || input.assignedToId;
  if (actor.role === "technician" && (effectiveAssignment !== actor.id || !["acknowledged", "in_progress", "pending_material", "resolved"].includes(input.status))) {
    throw new Error("Technicians may only update work orders assigned to them.");
  }
  if (!elevated && !["requester", "technician"].includes(actor.role)) {
    throw new Error("You do not have permission to update this work order.");
  }
  const updatedAt = now();
  const assignedToId = input.assignedToId === undefined ? current.assignedToId : input.assignedToId;
  if (assignedToId && !userPlants(getUser(assignedToId)).includes(current.plantId)) throw new Error("Assignee must have access to this plant.");
  const trimmedNote = input.note.trim();
  const productionDowntimeReason = input.productionDowntimeReason?.trim() || "";

  if (input.status === "resolved") {
    if (!trimmedNote) {
      throw new Error("Repair or replacement summary is required before resolving.");
    }

    const afterAttachmentCount = row<{ count: number }>(
      db.prepare("SELECT COUNT(*) as count FROM scoped_work_order_attachments WHERE workOrderId = ? AND kind = 'after'").get(id)
    ).count;

    if (afterAttachmentCount === 0) {
      throw new Error("At least one completion photo is required before resolving.");
    }

    if (!current.maintenanceStartedAt) {
      throw new Error("Select Start Repair before resolving so total queue time can be measured fairly.");
    }

    if (!Number.isInteger(input.maintenanceActualMinutes) || Number(input.maintenanceActualMinutes) < 1 || Number(input.maintenanceActualMinutes) > 10080) {
      throw new Error("Enter maintenance actual time between 1 minute and 7 days before resolving.");
    }

    const supportingTechnicianIds = [...new Set((input.supportingTechnicianIds || []).filter(Boolean))]
      .filter((userId) => userId !== assignedToId);
    if (supportingTechnicianIds.length < 1 || supportingTechnicianIds.length > 3) {
      throw new Error("Select 1 to 3 supporting technicians before resolving.");
    }
    for (const userId of supportingTechnicianIds) {
      const technician = getUser(userId);
      if (technician.role !== "technician" || !userPlants(technician).includes(current.plantId)) {
        throw new Error("Every supporting person must be a technician with access to this plant.");
      }
    }
  }

  if (input.status === "closed" && current.responsibleDepartment === "Production") {
    const totalOpenMinutes = Math.max(0, Math.round((Date.parse(updatedAt) - Date.parse(current.createdAt)) / 60000));
    if (totalOpenMinutes >= longProductionDowntimeMinutes && !productionDowntimeReason && !current.productionDowntimeReason) {
      throw new Error(`Choose one reason before closing work orders open for ${longProductionDowntimeMinutes} minutes or more.`);
    }
  }

  const completionNote = input.status === "resolved" ? trimmedNote : current.completionNote;
  const maintenanceActualMinutes = input.status === "resolved" ? Number(input.maintenanceActualMinutes) : current.maintenanceActualMinutes;
  const supportingTechnicianIds = input.status === "resolved"
    ? [...new Set((input.supportingTechnicianIds || []).filter(Boolean))].filter((userId) => userId !== assignedToId)
    : current.supportingTechnicianIds;
  const savedProductionDowntimeReason = input.status === "closed" && current.responsibleDepartment === "Production" && productionDowntimeReason
    ? productionDowntimeReason
    : current.productionDowntimeReason;

  db.prepare(`
    UPDATE work_orders
    SET status = ?, assignedToId = ?, completionNote = ?, maintenanceActualMinutes = ?, supportingTechnicianIds = ?, productionDowntimeReason = ?, updatedAt = ?
    WHERE id = ?
  `).run(input.status, assignedToId, completionNote, maintenanceActualMinutes, JSON.stringify(supportingTechnicianIds), savedProductionDowntimeReason, updatedAt, id);

  const action = statusToAction(input.status);
  addActivity(id, input.actorId, action, input.status, trimmedNote || `Status changed to ${input.status}.`);
  notifyForStatusChange(getWorkOrder(id), input.status);
  enqueueWorkOrderSync(id, true);

  return getWorkOrder(id);
}

export function updateWorkOrderDowntimeReason(id: string, input: UpdateDowntimeReasonInput): WorkOrder {
  const current = getWorkOrder(id);
  const actor = getUser(input.actorId);
  const actorDepartment = workOrderDepartmentForUser(actor.department);
  const canUpdate = ["executive", "admin", "developer"].includes(actor.role) ||
    (actor.role === "requester" && (current.requesterId === actor.id || actorDepartment === current.responsibleDepartment));
  if (!canUpdate) {
    throw new Error("Only the requester or responsible department can update this reason.");
  }
  if (["closed", "cancelled"].includes(current.status)) {
    throw new Error("This work order is already finished.");
  }
  const reason = input.reason.trim();
  if (!reason) throw new Error("Choose or enter a reason.");
  if (reason.length > 500) throw new Error("Keep the reason under 500 characters.");

  db.prepare("UPDATE work_orders SET productionDowntimeReason = ?, updatedAt = ? WHERE id = ?")
    .run(reason, now(), id);
  addActivity(id, actor.id, "commented", null, `Delay reason recorded: ${reason}`);
  enqueueWorkOrderSync(id, true);
  return getWorkOrder(id);
}

export function notifyLongRunningWorkOrders() {
  const cutoff = new Date(Date.now() - longProductionDowntimeMinutes * 60000).toISOString();
  const workOrders = rows<WorkOrder>(db.prepare(`
    SELECT wo.*,
      (SELECT activity.createdAt FROM scoped_work_order_activities activity
       WHERE activity.workOrderId = wo.id AND activity.action = 'started'
       ORDER BY activity.createdAt ASC LIMIT 1) AS maintenanceStartedAt,
      (SELECT activity.createdAt FROM scoped_work_order_activities activity
       WHERE activity.workOrderId = wo.id AND activity.action = 'resolved'
       ORDER BY activity.createdAt DESC LIMIT 1) AS resolvedAt,
      (SELECT activity.createdAt FROM scoped_work_order_activities activity
       WHERE activity.workOrderId = wo.id AND activity.action = 'closed'
       ORDER BY activity.createdAt DESC LIMIT 1) AS closedAt
    FROM scoped_work_orders wo
    WHERE wo.responsibleDepartment = 'Production'
      AND wo.status NOT IN ('closed', 'cancelled')
      AND wo.createdAt <= ?
      AND COALESCE(trim(wo.productionDowntimeReason), '') = ''
  `).all(cutoff));
  const productionRequesters = listUsers("requester")
    .filter((user) => user.id !== publicRequesterId && workOrderDepartmentForUser(user.department) === "Production");
  let sent = 0;
  for (const workOrder of workOrders) {
    const targetIds = new Set(productionRequesters.map((user) => user.id));
    if (workOrder.requesterId !== publicRequesterId) targetIds.add(workOrder.requesterId);
    const title = `${workOrder.number}: reason pending`;
    for (const userId of targetIds) {
      const exists = row<{ count: number }>(db.prepare(`
        SELECT COUNT(*) AS count FROM scoped_notifications
        WHERE userId = ? AND workOrderId = ? AND title = ?
      `).get(userId, workOrder.id, title)).count;
      if (exists) continue;
      notifyUsers([userId], workOrder.id, title, "Open the work order, follow up with maintenance, and choose why it is taking longer.");
      sent += 1;
    }
  }
  return sent;
}

export function claimWorkOrder(id: string, actorId: string, note?: string): WorkOrder {
  const actor = getUser(actorId);
  if (actor.role !== "technician") {
    throw new Error("Only technicians can accept work orders.");
  }

  const current = getWorkOrder(id);
  if (!technicianCanAccessWorkOrder(actor, current)) {
    throw new Error("This work order belongs to another technician team.");
  }
  if (current.type === "project") {
    throw new Error("Projects must be assigned by a coordinator before work starts.");
  }
  if (current.status !== "open") {
    if (current.status === "acknowledged" && current.assignedToId === actorId) {
      return current;
    }

    throw new Error(`${current.number} is no longer available to accept.`);
  }

  if (current.assignedToId && current.assignedToId !== actorId) {
    const assignedUser = getUser(current.assignedToId);
    throw new Error(`${current.number} was already assigned to ${assignedUser.name}.`);
  }

  const updatedAt = now();
  const claimed = db.prepare(`
    UPDATE work_orders SET status = ?, assignedToId = ?, updatedAt = ?
    WHERE id = ? AND status = 'open' AND (assignedToId IS NULL OR assignedToId = ?)
  `).run("acknowledged", actorId, updatedAt, id, actorId);
  if (claimed.changes !== 1) {
    const latest = getWorkOrder(id);
    const owner = latest.assignedToId ? getUser(latest.assignedToId).name : "another technician";
    throw new Error(`${latest.number} was already accepted by ${owner}.`);
  }
  addActivity(id, actorId, "acknowledged", "acknowledged", note?.trim() || `Accepted by ${actor.name}.`);

  const workOrder = getWorkOrder(id);
  if (workOrder.requesterId !== publicRequesterId) {
    notifyUsers([workOrder.requesterId], id, `${workOrder.number} accepted`, `${actor.name} accepted ${workOrder.title}.`);
  }
  enqueueWorkOrderSync(id, true);

  return workOrder;
}

export function assignWorkOrder(id: string, assignedToId: string, actorId: string, note?: string): WorkOrder {
  const actor = getUser(actorId);
  if (!["executive", "admin", "developer"].includes(actor.role)) {
    throw new Error("Executive, admin, or developer access is required to assign work orders.");
  }
  const currentWorkOrder = getWorkOrder(id);
  const workOrderPlant = currentWorkOrder.plantId;
  const assignedUser = getUser(assignedToId);
  if (!userPlants(assignedUser).includes(workOrderPlant)) throw new Error("Assignee must have access to this plant.");
  if (assignedUser.role === "technician" && !technicianCanAccessWorkOrder(assignedUser, currentWorkOrder)) {
    throw new Error("Select a technician from the team responsible for this work-order type.");
  }
  const updatedAt = now();
  db.prepare("UPDATE work_orders SET assignedToId = ?, updatedAt = ? WHERE id = ?").run(assignedToId, updatedAt, id);
  addActivity(id, actorId, "assigned", null, note?.trim() || `Assigned to ${assignedUser.name}.`);

  const workOrder = getWorkOrder(id);
  notifyUsers(
    [assignedToId, ...(workOrder.requesterId !== publicRequesterId ? [workOrder.requesterId] : [])],
    id,
    `${workOrder.number} assigned`,
    `${assignedUser.name} is assigned.`
  );
  enqueueWorkOrderSync(id);

  return workOrder;
}

export function addComment(workOrderId: string, actorId: string, message: string): WorkOrderActivity {
  const activity = addActivity(workOrderId, actorId, "commented", null, message.trim());
  enqueueWorkOrderSync(workOrderId);
  return activity;
}

export function addAttachment(input: {
  workOrderId: string;
  uploadedBy: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
  kind: WorkOrderAttachment["kind"];
}): WorkOrderAttachment {
  const id = randomUUID();
  const createdAt = now();
  db.prepare(`
    INSERT INTO work_order_attachments (plantId,
      id, workOrderId, uploadedBy, filename, originalName, mimeType, size, url, kind, createdAt
    ) VALUES (cmms_write_plant(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.workOrderId,
    input.uploadedBy,
    input.filename,
    input.originalName,
    input.mimeType,
    input.size,
    input.url,
    input.kind,
    createdAt
  );

  addActivity(input.workOrderId, input.uploadedBy, "attachment_added", null, `Uploaded ${input.originalName}.`);
  enqueueWorkOrderSync(input.workOrderId);

  return row<WorkOrderAttachment>(
    db.prepare("SELECT * FROM scoped_work_order_attachments WHERE id = ?").get(id)
  );
}

export function listRequesterWorkOrders(): PublicRequesterWorkOrder[] {
  const workOrders = rows<Omit<PublicRequesterWorkOrder, "attachments">>(
    db.prepare(`
      SELECT
        wo.id,
        wo.number,
        wo.type,
        wo.status,
        wo.workDate,
        wo.shiftGroup,
        COALESCE(s.name, wo.location) as sectionName,
        wo.area,
        wo.machineName,
        COALESCE(NULLIF(wo.issueCategoryName, ''), ic.name, 'Other') as issueCategoryName,
        wo.issueDescription,
        wo.reportedByName,
        wo.reportedByDepartment,
        wo.responsibleDepartment,
        wo.maintenanceActualMinutes,
        wo.productionDowntimeReason,
        wo.createdAt,
        (SELECT activity.createdAt FROM scoped_work_order_activities activity
         WHERE activity.workOrderId = wo.id AND activity.action = 'started'
         ORDER BY activity.createdAt ASC LIMIT 1) AS maintenanceStartedAt,
        (SELECT activity.createdAt FROM scoped_work_order_activities activity
         WHERE activity.workOrderId = wo.id AND activity.action = 'resolved'
         ORDER BY activity.createdAt DESC LIMIT 1) AS resolvedAt,
        (SELECT activity.createdAt FROM scoped_work_order_activities activity
         WHERE activity.workOrderId = wo.id AND activity.action = 'closed'
         ORDER BY activity.createdAt DESC LIMIT 1) AS closedAt,
        wo.updatedAt
      FROM scoped_work_orders wo
      JOIN users requester ON requester.id = wo.requesterId
      LEFT JOIN scoped_sections s ON s.id = wo.sectionId
      LEFT JOIN scoped_issue_categories ic ON ic.id = wo.issueCategoryId
      WHERE requester.role = 'requester'
      ORDER BY wo.updatedAt DESC
    `).all()
  );
  const attachmentsForWorkOrder = db.prepare(`
    SELECT * FROM scoped_work_order_attachments
    WHERE workOrderId = ?
    ORDER BY createdAt ASC, id ASC
  `);
  return workOrders.map((workOrder) => ({
    ...workOrder,
    attachments: rows<WorkOrderAttachment>(attachmentsForWorkOrder.all(workOrder.id))
  }));
}

export function publicRequesterIdForUploads() {
  return publicRequesterId;
}

function guestTrackingSecret() {
  let secret = getWorkOrderSetting("guestTrackingSecret");
  if (!secret) {
    secret = randomBytes(32).toString("hex");
    setWorkOrderSetting("guestTrackingSecret", secret);
  }
  return secret;
}

function guestTrackingToken(workOrderId: string) {
  return createHmac("sha256", guestTrackingSecret()).update(`guest-work-order:${workOrderId}`).digest("base64url");
}

function requireGuestTrackingAccess(workOrderId: string, token: string) {
  const workOrder = getWorkOrder(workOrderId);
  if (workOrder.requesterId !== publicRequesterId || !token) {
    throw new Error("This guest tracking link is invalid.");
  }
  const expected = Buffer.from(guestTrackingToken(workOrderId));
  const actual = Buffer.from(token);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error("This guest tracking link is invalid.");
  }
  return workOrder;
}

export function createGuestTrackingLink(workOrderId: string): GuestTrackingLink {
  const workOrder = getWorkOrder(workOrderId);
  if (workOrder.requesterId !== publicRequesterId) {
    throw new Error("Tracking links are only generated for guest work orders.");
  }
  const token = guestTrackingToken(workOrderId);
  return {
    workOrderId,
    workOrderNumber: workOrder.number,
    path: `/requester/track/${encodeURIComponent(workOrderId)}?token=${encodeURIComponent(token)}`
  };
}

export function getGuestTrackingLink(workOrderId: string, actorId: string): GuestTrackingLink {
  const actor = getUser(actorId);
  if (!["executive", "admin", "developer"].includes(actor.role)) {
    throw new Error("Executive, admin, or developer access is required to view guest tracking links.");
  }
  return createGuestTrackingLink(workOrderId);
}

export function getGuestWorkOrderTracking(workOrderId: string, token: string): GuestWorkOrderTracking {
  requireGuestTrackingAccess(workOrderId, token);
  const detail = getWorkOrderDetail(workOrderId);
  return {
    workOrder: {
      id: detail.id,
      number: detail.number,
      type: detail.type,
      status: detail.status,
      workDate: detail.workDate,
      shiftGroup: detail.shiftGroup,
      sectionName: detail.section?.name || detail.location,
      area: detail.area,
      machineName: detail.machineName,
      issueCategoryName: detail.issueCategoryName || detail.issueCategory?.name || "Other",
      issueDescription: detail.issueDescription,
      reportedByName: detail.reportedByName,
      reportedByDepartment: detail.reportedByDepartment,
      responsibleDepartment: detail.responsibleDepartment,
      attachments: detail.attachments.map((attachment) => ({ ...attachment, url: `${attachment.url}?token=${encodeURIComponent(token)}` })),
      createdAt: detail.createdAt,
      closedAt: detail.closedAt,
      updatedAt: detail.updatedAt,
      title: detail.title,
      priority: detail.priority,
      completionNote: detail.completionNote,
      maintenanceActualMinutes: detail.maintenanceActualMinutes,
      productionDowntimeReason: detail.productionDowntimeReason,
      maintenanceStartedAt: detail.maintenanceStartedAt,
      resolvedAt: detail.resolvedAt,
      assignedToName: detail.assignedTo?.name || "Waiting for assignment"
    },
    activities: detail.activities.map((activity) => ({
      action: activity.action,
      status: activity.status,
      message: activity.message,
      createdAt: activity.createdAt
    }))
  };
}

export function verifyGuestWorkOrder(
  workOrderId: string,
  token: string,
  status: "closed" | "returned",
  note: string
): GuestWorkOrderTracking {
  const workOrder = requireGuestTrackingAccess(workOrderId, token);
  if (workOrder.status !== "resolved") {
    throw new Error("This work order is not waiting for guest verification.");
  }
  const trimmedNote = note.trim();
  if (status === "returned" && !trimmedNote) {
    throw new Error("Add a short reason before returning the work order to maintenance.");
  }
  updateWorkOrderStatus(workOrderId, {
    actorId: publicRequesterId,
    status,
    note: trimmedNote || "Guest requester verified and closed the work order.",
    productionDowntimeReason: status === "closed" && workOrder.responsibleDepartment === "Production" ? trimmedNote : null
  });
  return getGuestWorkOrderTracking(workOrderId, token);
}

export function updateGuestWorkOrderDowntimeReason(workOrderId: string, token: string, reason: string): GuestWorkOrderTracking {
  requireGuestTrackingAccess(workOrderId, token);
  updateWorkOrderDowntimeReason(workOrderId, { actorId: publicRequesterId, reason });
  return getGuestWorkOrderTracking(workOrderId, token);
}

async function permanentlyDeleteWorkOrder(workOrder: WorkOrder, notifyWebhook = true) {
  const id = workOrder.id;
  const runtime = workOrderSyncRuntimeSettings();

  if (notifyWebhook && runtime.webhookUrl) {
    const deletionData = { ...workOrderSheetRow(id), Status: "Deleted", UpdatedAt: now() };
    await postJson(runtime.webhookUrl, { Source: "CMMS", Event: "Deleted", Data: deletionData });
  }

  db.exec("BEGIN");
  try {
    enqueueWorkOrderSheetDeletion(workOrder.number);
    db.prepare("UPDATE stock_movements SET workOrderId = NULL WHERE workOrderId = ?").run(id);
    db.prepare("DELETE FROM work_orders WHERE id = ?").run(id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  const workOrderUploadsRoot = path.resolve(uploadsRoot, "work-orders");
  const targetDir = path.resolve(workOrderUploadsRoot, id);
  const uploadsRootPrefix = workOrderUploadsRoot.endsWith(path.sep) ? workOrderUploadsRoot : `${workOrderUploadsRoot}${path.sep}`;
  if (targetDir.startsWith(uploadsRootPrefix) && existsSync(targetDir)) {
    rmSync(targetDir, { recursive: true, force: true });
  }

  return workOrder;
}

export async function deleteWorkOrder(id: string, actorId: string) {
  const actor = getUser(actorId);
  const workOrder = getWorkOrder(id);
  if (actor.role === "requester") {
    if (workOrder.requesterId !== actor.id) {
      throw new Error("You can only delete a work order issued from your requester account.");
    }
    if (!["open", "cancelled"].includes(workOrder.status) || workOrder.assignedToId || workOrder.maintenanceStartedAt) {
      throw new Error("This work order has already entered the maintenance workflow. Cancel it instead or contact an administrator.");
    }
  } else {
    requireWorkOrderManager(actorId);
  }
  return permanentlyDeleteWorkOrder(workOrder);
}

export async function deleteAppSheetAirLeak(airLeakId: string) {
  const externalId = airLeakId.trim();
  if (!externalId) throw new Error("Air Leak ID is required.");
  const mapping = row<{ workOrderId: string } | undefined>(db.prepare(`
    SELECT workOrderId FROM scoped_external_work_orders
    WHERE source = 'appsheet-air-leak' AND externalId = ?
  `).get(externalId));
  if (!mapping) return { ok: true as const, deleted: false, airLeakId: externalId };
  const workOrder = await permanentlyDeleteWorkOrder(getWorkOrder(mapping.workOrderId), false);
  return {
    ok: true as const,
    deleted: true,
    airLeakId: externalId,
    workOrderId: workOrder.id,
    workOrderNumber: workOrder.number
  };
}

export function listNotifications(userId: string): NotificationRecord[] {
  return rows<NotificationRecord>(
    db.prepare("SELECT * FROM scoped_notifications WHERE userId = ? ORDER BY createdAt DESC LIMIT 50").all(userId)
  );
}

export function markNotificationRead(id: string, userId: string) {
  db.prepare("UPDATE notifications SET readAt = ? WHERE id = ? AND userId = ? AND cmms_can_access(plantId) AND readAt IS NULL").run(now(), id, userId);
}

export function markAllNotificationsRead(userId: string) {
  db.prepare("UPDATE notifications SET readAt = ? WHERE userId = ? AND cmms_can_access(plantId) AND readAt IS NULL").run(now(), userId);
}

export interface StoredPushSubscription {
  endpoint: string;
  userId: string;
  expirationTime: number | null;
  p256dh: string;
  auth: string;
  createdAt: string;
  updatedAt: string;
}

export function savePushSubscription(userId: string, subscription: {
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
}) {
  getUser(userId);
  const timestamp = now();
  db.prepare(`
    INSERT INTO push_subscriptions (endpoint, userId, expirationTime, p256dh, auth, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET
      userId = excluded.userId,
      expirationTime = excluded.expirationTime,
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      updatedAt = excluded.updatedAt
  `).run(
    subscription.endpoint,
    userId,
    subscription.expirationTime ?? null,
    subscription.keys.p256dh,
    subscription.keys.auth,
    timestamp,
    timestamp
  );
}

export function listPushSubscriptions(userId: string): StoredPushSubscription[] {
  return rows<StoredPushSubscription>(
    db.prepare("SELECT * FROM push_subscriptions WHERE userId = ? ORDER BY createdAt DESC").all(userId)
  );
}

export function listPushSubscriptionUserIds(): string[] {
  return rows<{ userId: string }>(
    db.prepare("SELECT DISTINCT userId FROM push_subscriptions ORDER BY userId").all()
  ).map((subscription) => subscription.userId);
}

export function deletePushSubscription(endpoint: string, userId: string) {
  db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND userId = ?").run(endpoint, userId);
}

export function dashboardSummary(): DashboardSummary {
  const today = new Date().toISOString().slice(0, 10);
  const summary = row<DashboardSummary>(
    db.prepare(`
      SELECT
        SUM(CASE WHEN status NOT IN ('closed', 'cancelled') THEN 1 ELSE 0 END) as totalOpen,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as newWorkOrders,
        SUM(CASE WHEN status IN ('acknowledged', 'in_progress', 'returned') THEN 1 ELSE 0 END) as inProgress,
        SUM(CASE WHEN status = 'pending_material' THEN 1 ELSE 0 END) as pendingMaterial,
        SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolvedWaitingVerification,
        SUM(CASE WHEN status = 'closed' AND substr(updatedAt, 1, 10) = ? THEN 1 ELSE 0 END) as closedToday
      FROM scoped_work_orders
    `).get(today)
  );

  return {
    totalOpen: summary.totalOpen || 0,
    newWorkOrders: summary.newWorkOrders || 0,
    inProgress: summary.inProgress || 0,
    pendingMaterial: summary.pendingMaterial || 0,
    resolvedWaitingVerification: summary.resolvedWaitingVerification || 0,
    closedToday: summary.closedToday || 0
  };
}

function addActivity(
  workOrderId: string,
  actorId: string,
  action: ActivityAction,
  status: WorkOrderStatus | null,
  message: string
): WorkOrderActivity {
  const id = randomUUID();
  const createdAt = now();
  db.prepare(`
    INSERT INTO work_order_activities (plantId, id, workOrderId, actorId, action, status, message, createdAt)
    VALUES (cmms_write_plant(), ?, ?, ?, ?, ?, ?, ?)
  `).run(id, workOrderId, actorId, action, status, message, createdAt);

  return row<WorkOrderActivity>(
    db.prepare("SELECT * FROM scoped_work_order_activities WHERE id = ?").get(id)
  );
}

function notifyUsers(userIds: string[], workOrderId: string, title: string, body: string) {
  const uniqueUserIds = [...new Set(userIds)];
  const insert = db.prepare(`
    INSERT INTO notifications (plantId, id, userId, workOrderId, title, body, readAt, createdAt)
    VALUES (cmms_write_plant(), ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const userId of uniqueUserIds) {
    if (!userPlants(getUser(userId)).includes(getWorkOrder(workOrderId).plantId)) continue;
    const notification: NotificationRecord = {
      id: randomUUID(),
      userId,
      workOrderId,
      title,
      body,
      readAt: null,
      createdAt: now()
    };
    insert.run(
      notification.id,
      notification.userId,
      notification.workOrderId,
      notification.title,
      notification.body,
      notification.readAt,
      notification.createdAt
    );
    emitNotificationCreated(notification);
  }
}

function notifyForStatusChange(workOrder: WorkOrder, status: WorkOrderStatus) {
  if (status === "resolved") {
    if (workOrder.requesterId !== publicRequesterId) {
      notifyUsers(
        [workOrder.requesterId],
        workOrder.id,
        `${workOrder.number} ready for verification`,
        `${workOrder.title} has been resolved. Please review the completed work and verify it.`
      );
    }
    return;
  }

  if (["acknowledged", "in_progress", "pending_material"].includes(status)) {
    if (workOrder.requesterId !== publicRequesterId) {
      notifyUsers(
        [workOrder.requesterId],
        workOrder.id,
        `${workOrder.number} ${status.replace("_", " ")}`,
        `${workOrder.title} is now ${status.replace("_", " ")}.`
      );
    }
    return;
  }

  if (["closed", "returned", "cancelled"].includes(status)) {
    const maintenanceIds = [
      ...listExecutives().map((user) => user.id),
      ...(workOrder.assignedToId ? [workOrder.assignedToId] : listMaintenanceUsers().map((user) => user.id))
    ];
    notifyUsers(
      maintenanceIds,
      workOrder.id,
      `${workOrder.number} ${status.replace("_", " ")}`,
      `${workOrder.title} was ${status.replace("_", " ")} by the requester or system.`
    );
  }
}

function statusToAction(status: WorkOrderStatus): ActivityAction {
  const map: Record<WorkOrderStatus, ActivityAction> = {
    open: "created",
    acknowledged: "acknowledged",
    in_progress: "started",
    pending_material: "pending_material",
    resolved: "resolved",
    closed: "closed",
    returned: "returned",
    cancelled: "cancelled"
  };

  return map[status];
}

function normalizeWorkOrderType(value: unknown): WorkOrderType {
  const type = String(value || "").toLowerCase();
  if (type === "maintenance" || type === "standard_maintenance") {
    return "maintenance";
  }
  if (["office", "project", "kaizen"].includes(type)) {
    return type as WorkOrderType;
  }

  throw new Error("Work order type must be Office, Maintenance, Project, or Kaizen.");
}

function normalizeWorkOrderDepartment(value: unknown): WorkOrderDepartment {
  const department = String(value || "").trim().toLowerCase();
  const matches: Record<string, WorkOrderDepartment> = {
    logistic: "Logistic",
    logistics: "Logistic",
    production: "Production",
    she: "SHE",
    safety: "SHE",
    "safety, health and environment": "SHE",
    "safety health and environment": "SHE",
    dtu: "DTU",
    "digital transformation unit": "DTU",
    "r&d": "R&D",
    "research and development": "R&D",
    account: "Account",
    accounts: "Account",
    finance: "Account",
    management: "Management",
    "business development": "Business Development"
  };
  const normalized = matches[department];
  if (!normalized) {
    throw new Error("Responsible department must be Logistic, Production, SHE, DTU, R&D, Account, Management, or Business Development.");
  }
  return normalized;
}

export function validateCreateWorkOrderInput(body: Partial<CreateWorkOrderInput>): CreateWorkOrderInput {
  const requiredFields: Array<keyof CreateWorkOrderInput> = [
    "type",
    "requesterId"
  ];

  for (const field of requiredFields) {
    if (!body[field]) {
      throw new Error(`Missing required field: ${field}`);
    }
  }

  const type = normalizeWorkOrderType(body.type);
  getUser(body.requesterId as string);
  if (body.sectionId) {
    getSection(String(body.sectionId));
  }
  if (body.machineId) {
    getMachine(String(body.machineId));
  }
  if (body.issueCategoryId) {
    getIssueCategory(String(body.issueCategoryId));
  }

  const issueDescription = body.issueDescription || body.description || body.title;
  if (!issueDescription) {
    throw new Error("Issue description is required.");
  }

  const responsibleDepartment = normalizeWorkOrderDepartment(
    body.responsibleDepartment || body.reportedByDepartment || getUser(String(body.requesterId)).department
  );

  return {
    type,
    title: body.title ? String(body.title) : undefined,
    description: body.description ? String(body.description) : undefined,
    assetName: body.assetName ? String(body.assetName) : undefined,
    location: body.location ? String(body.location) : undefined,
    priority: body.priority || "medium",
    requesterId: String(body.requesterId),
    dueDate: body.dueDate || null,
    workDate: body.workDate || now().slice(0, 10),
    shiftGroup: responsibleDepartment === "Production" ? (body.shiftGroup === "B" ? "B" : "A") : "N/A",
    sectionId: body.sectionId ? String(body.sectionId) : null,
    machineId: body.machineId ? String(body.machineId) : null,
    area: body.area ? String(body.area) : undefined,
    machineName: body.machineName ? String(body.machineName) : undefined,
    reportedByName: body.reportedByName ? String(body.reportedByName) : undefined,
    reportedByDepartment: body.reportedByDepartment ? String(body.reportedByDepartment) : undefined,
    responsibleDepartment,
    issueCategoryId: body.issueCategoryId ? String(body.issueCategoryId) : null,
    issueCategoryName: body.issueCategoryName ? String(body.issueCategoryName).trim() : undefined,
    issueDescription: String(issueDescription)
  };
}

export function validateUpdateWorkOrderInput(body: Partial<UpdateWorkOrderInput>): UpdateWorkOrderInput {
  if (!body.actorId) {
    throw new Error("actorId is required.");
  }
  getUser(String(body.actorId));

  const issueDescription = String(body.issueDescription || "").trim();
  const reportedByName = String(body.reportedByName || "").trim();
  const reportedByDepartment = String(body.reportedByDepartment || "").trim();
  const workDate = String(body.workDate || "").trim();
  if (!issueDescription || !reportedByName || !reportedByDepartment || !workDate) {
    throw new Error("Date, reporter details, and issue description are required.");
  }

  if (body.sectionId) getSection(String(body.sectionId));
  if (body.machineId) getMachine(String(body.machineId));
  if (body.issueCategoryId) getIssueCategory(String(body.issueCategoryId));

  const priority = String(body.priority || "medium");
  if (!["low", "medium", "high", "critical"].includes(priority)) {
    throw new Error("Select a valid work-order priority.");
  }

  const responsibleDepartment = normalizeWorkOrderDepartment(body.responsibleDepartment);
  return {
    actorId: String(body.actorId),
    type: normalizeWorkOrderType(body.type),
    priority: priority as UpdateWorkOrderInput["priority"],
    dueDate: body.dueDate ? String(body.dueDate) : null,
    workDate,
    shiftGroup: responsibleDepartment === "Production" && body.shiftGroup === "B" ? "B" : responsibleDepartment === "Production" ? "A" : "N/A",
    sectionId: body.sectionId ? String(body.sectionId) : null,
    machineId: body.machineId ? String(body.machineId) : null,
    area: String(body.area || ""),
    machineName: String(body.machineName || ""),
    reportedByName,
    reportedByDepartment,
    responsibleDepartment,
    issueCategoryId: body.issueCategoryId ? String(body.issueCategoryId) : null,
    issueCategoryName: body.issueCategoryName ? String(body.issueCategoryName).trim() : undefined,
    issueDescription,
    completionNote: body.completionNote === undefined ? undefined : body.completionNote ? String(body.completionNote).trim() : null,
    assignedToId: body.assignedToId === undefined ? undefined : body.assignedToId ? String(body.assignedToId) : null,
    supportingTechnicianIds: Array.isArray(body.supportingTechnicianIds) ? body.supportingTechnicianIds.map(String) : undefined,
    productionDowntimeReason: body.productionDowntimeReason === undefined ? undefined : body.productionDowntimeReason ? String(body.productionDowntimeReason) : null
  };
}

export function validateStatusInput(body: Partial<UpdateWorkOrderStatusInput>): UpdateWorkOrderStatusInput {
  if (!body.status || !body.actorId) {
    throw new Error("Status and actorId are required.");
  }

  getUser(body.actorId);

  if (body.assignedToId) {
    getUser(body.assignedToId);
  }

  return {
    status: body.status,
    actorId: body.actorId,
    note: body.note ? String(body.note) : "",
    assignedToId: body.assignedToId,
    maintenanceActualMinutes: body.maintenanceActualMinutes == null ? null : Number(body.maintenanceActualMinutes),
    supportingTechnicianIds: Array.isArray(body.supportingTechnicianIds) ? body.supportingTechnicianIds.map(String) : undefined,
    productionDowntimeReason: body.productionDowntimeReason ? String(body.productionDowntimeReason) : null
  };
}

function validatePlantAccess(value: unknown, actor: User): User["plantAccess"] {
  if (!["port-klang", "sendayan", "both"].includes(String(value))) throw new Error("Select valid plant access.");
  if (actor.plantAccess !== "both" && value !== actor.plantAccess) throw new Error("Only an administrator with both plants can grant access to another plant.");
  return value as User["plantAccess"];
}
