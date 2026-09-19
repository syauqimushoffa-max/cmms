import { plantContext, userPlants } from "./plant-context.js";
import { db } from "./db.js";
import type { PlantId } from "@pbs-cmms/shared";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { loadEnvFile } from "node:process";
import type { MachineImportRow, WorkOrderDepartment } from "@pbs-cmms/shared";
import type { User } from "@pbs-cmms/shared";
import {
  addAttachment,
  addPmResultPhoto,
  addComment,
  adjustSparePart,
  authenticateAirLeakIntegration,
  assignPmTemplate,
  assignWorkOrder,
  authenticateSession,
  claimWorkOrder,
  createUser,
  createPmPlan,
  createSparePart,
  ensurePlantPmSchedules,
  createIssueCategory,
  createAuthSession,
  authSessionMaxAgeMs,
  createMachine,
  createSection,
  createGuestTrackingLink,
  createWorkOrder,
  dashboardSummary,
  deactivateUser,
  deleteAppSheetAirLeak,
  deletePushSubscription,
  deleteWorkOrder,
  deletePmResultPhoto,
  getPmDashboard,
  getPmPhoto,
  getAssetDashboard,
  getGuestTrackingLink,
  getGuestWorkOrderTracking,
  getPmScheduleDetail,
  getWorkOrderDetail,
  importMachines,
  importSpareParts,
  issueSparePart,
  getSparePartDetail,
  getSpareSyncSettings,
  getWorkOrderSyncSettings,
  listMasterData,
  listNotifications,
  listPmTemplates,
  listSpareInventory,
  listSpareMovementsForActor,
  listSparePartMovements,
  listTvWorkOrders,
  listUsers,
  listWorkOrders,
  userCanAccessWorkOrder,
  lookupSpareQr,
  markAllNotificationsRead,
  markNotificationRead,
  migrate,
  notifyLongRunningWorkOrders,
  pullSparePartsFromSheet,
  publicRequesterIdForUploads,
  retrySpareSync,
  revokeAuthSession,
  revokeUserSessions,
  flushWorkOrderSyncQueue,
  flushAirLeakSyncQueue,
  getAirLeakSyncSettings,
  savePmResult,
  savePmTemplate,
  savePushSubscription,
  seed,
  startPmSchedule,
  submitPmSchedule,
  updateIssueCategory,
  updateAirLeakSyncSettings,
  updateAsset,
  updateMachine,
  updatePmPlan,
  updateSpareSyncSettings,
  updateWorkOrderSyncSettings,
  updateSection,
  updateUser,
  updateUserAvatar,
  updateWorkOrder,
  updateWorkOrderDowntimeReason,
  updateWorkOrderStatus,
  upsertAppSheetAirLeak,
  uploadsRoot,
  validateCreateWorkOrderInput,
  validateStatusInput,
  validateUpdateWorkOrderInput,
  verifyGuestWorkOrder,
  updateGuestWorkOrderDowntimeReason,
  verifyPmSchedule
} from "./db.js";
import { initializeWebPush, sendPushToAllUsers, webPushConfig } from "./web-push.js";

const localEnvFile = path.basename(process.cwd()) === "api"
  ? path.resolve(process.cwd(), "../../.env")
  : path.resolve(process.cwd(), ".env");
if (process.env.NODE_ENV !== "test" && existsSync(localEnvFile)) loadEnvFile(localEnvFile);

const app = express();
const port = Number(process.env.PORT || 3300);
const liveClients = new Set<Response>();
const uploadsTempDir = path.join(uploadsRoot, "tmp");
const webDistRoot = [
  path.resolve(process.cwd(), "../web/dist"),
  path.resolve(process.cwd(), "apps/web/dist")
].find((candidate) => existsSync(path.join(candidate, "index.html")));

if (!existsSync(uploadsTempDir)) {
  mkdirSync(uploadsTempDir, { recursive: true });
}

const upload = multer({
  dest: uploadsTempDir,
  limits: {
    fileSize: 8 * 1024 * 1024,
    files: 10
  },
  fileFilter: (_request, file, callback) => {
    if (file.mimetype.startsWith("image/")) {
      callback(null, true);
      return;
    }

    callback(new Error("Only image uploads are supported in this MVP."));
  }
});

const pmProofUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024,
    files: 1
  },
  fileFilter: (_request, file, callback) => {
    if (file.mimetype.startsWith("image/")) {
      callback(null, true);
      return;
    }
    callback(new Error("PM proof must be an image."));
  }
});

function asyncHandler(handler: (request: Request, response: Response) => Promise<void>) {
  return (request: Request, response: Response, next: NextFunction) => {
    handler(request, response).catch(next);
  };
}

function saveWorkOrderAttachments(
  workOrderId: string,
  uploadedBy: string,
  kind: "issue" | "before" | "progress" | "after" | "return_evidence" | "general",
  files: Express.Multer.File[]
) {
  const targetDir = path.join(uploadsRoot, "work-orders", workOrderId);
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  return files.map((file) => {
    const extension = path.extname(file.originalname) || ".jpg";
    const filename = `${randomUUID()}${extension}`;
    const targetPath = path.join(targetDir, filename);
    renameSync(file.path, targetPath);

    return addAttachment({
      workOrderId,
      uploadedBy,
      filename,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      url: `/uploads/work-orders/${workOrderId}/${filename}`,
      kind
    });
  });
}

async function importAirLeakPhoto(workOrderId: string, pictureUrl: string) {
  if (!pictureUrl.trim()) return false;
  const detail = getWorkOrderDetail(workOrderId);
  if (detail.attachments.some((attachment) => attachment.kind === "issue")) return true;
  let url: URL;
  try { url = new URL(pictureUrl); }
  catch { return false; }
  if (url.protocol !== "https:" || !(url.hostname === "appsheet.com" || url.hostname.endsWith(".appsheet.com"))) return false;

  const remote = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: "follow" });
  if (!remote.ok) throw new Error(`Unable to download the AppSheet picture (HTTP ${remote.status}).`);
  const mimeType = remote.headers.get("content-type")?.split(";")[0].trim().toLowerCase() || "";
  if (!mimeType.startsWith("image/")) throw new Error("The AppSheet picture URL did not return an image.");
  const bytes = Buffer.from(await remote.arrayBuffer());
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new Error("The AppSheet picture must be between 1 byte and 8 MB.");

  const extension = mimeType === "image/png" ? ".png" : mimeType === "image/gif" ? ".gif" : mimeType === "image/webp" ? ".webp" : ".jpg";
  const filename = `${randomUUID()}${extension}`;
  const targetDir = path.join(uploadsRoot, "work-orders", workOrderId);
  if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
  writeFileSync(path.join(targetDir, filename), bytes);
  addAttachment({
    workOrderId,
    uploadedBy: publicRequesterIdForUploads(),
    filename,
    originalName: `AppSheet-${filename}`,
    mimeType,
    size: bytes.length,
    url: `/uploads/work-orders/${workOrderId}/${filename}`,
    kind: "issue"
  });
  return true;
}

migrate();
plantContext.run({ plant: "port-klang" }, () => seed());
plantContext.run({ plant: "sendayan" }, () => ensurePlantPmSchedules());
initializeWebPush();

app.use(cors());
app.use(express.json({ limit: "12mb" }));

app.use("/api", (_request, response, next) => {
  response.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  response.set("Pragma", "no-cache");
  response.set("Expires", "0");
  next();
});

declare global {
  namespace Express {
    interface Request { cmmsUser?: User }
  }
}

app.use("/api", (request, response, next) => {
  const appSheetAirLeakMutation = request.method === "POST" && request.path === "/integrations/appsheet/air-leaks";
  const publicRequesterMutation =
    request.method === "POST" &&
    (request.path === "/requester/work-orders" || /^\/requester\/work-orders\/[^/]+\/attachments$/.test(request.path));
  const publicGuestTracking =
    (request.method === "GET" && /^\/requester\/work-orders\/[^/]+\/(tracking|events)$/.test(request.path)) ||
    (request.method === "POST" && /^\/requester\/work-orders\/[^/]+\/verification$/.test(request.path));
  const publicRequest =
    request.path === "/health" ||
    request.path === "/auth/login" ||

    publicRequesterMutation ||
    publicGuestTracking ||
    (request.method === "GET" && request.path === "/master-data");
  if (appSheetAirLeakMutation || publicGuestTracking || publicRequesterMutation || (publicRequest && !request.header("authorization") && !sessionCookie(request))) {
    let plant = String(request.header("x-cmms-plant") || request.query.plant || "port-klang");
    const guestId = request.path.match(/^\/requester\/work-orders\/([^/]+)/)?.[1];
    if (guestId) {
      const record = db.prepare("SELECT plantId FROM work_orders WHERE id = ?").get(decodeURIComponent(guestId)) as { plantId: string } | undefined;
      if (record) plant = record.plantId;
    }
    if (!["port-klang", "sendayan"].includes(plant)) { response.status(400).json({ error: "Select a valid plant." }); return; }
    plantContext.run({ plant: plant as PlantId }, next); return;
  }
  if (request.path === "/health" || request.path === "/auth/login") { next(); return; }

  const authorization = request.header("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : sessionCookie(request);
  if (!token) { response.status(401).json({ error: "Authentication is required." }); return; }
  try {
    request.cmmsUser = authenticateSession(token);
    if (authorization.startsWith("Bearer ")) {
      response.cookie("cmms-session", token, { httpOnly: true, sameSite: "strict", secure: request.secure, maxAge: authSessionMaxAgeMs(), path: "/" });
    }
  } catch {
    response.status(401).json({ error: "Your session has expired. Sign in again." });
    return;
  }

  let requestedPlant = String(request.header("x-cmms-plant") || request.query.plant || userPlants(request.cmmsUser)[0]);
  if (request.path.startsWith("/auth/")) requestedPlant = userPlants(request.cmmsUser)[0];
  const photoId = request.path.match(/^\/pm\/photos\/([^/]+)$/)?.[1];
  if (photoId && request.method === "GET") {
    const photo = db.prepare("SELECT plantId FROM pm_result_photos WHERE id = ?").get(photoId) as { plantId: string } | undefined;
    if (photo) requestedPlant = photo.plantId;
  }
  if (requestedPlant === "all" ? request.cmmsUser.plantAccess !== "both" : !userPlants(request.cmmsUser).includes(requestedPlant as PlantId)) {
    response.status(403).json({ error: "You do not have access to this plant." }); return;
  }
  if (requestedPlant === "all" && !["GET", "HEAD"].includes(request.method) && !["/auth/", "/users", "/notifications", "/push/"].some((prefix) => request.path.startsWith(prefix))) {
    response.status(400).json({ error: "Select one plant before making changes." }); return;
  }
  plantContext.run({ plant: requestedPlant as PlantId | "all" }, () => authorizeRequest(request, response, next));
});

function authorizeRequest(request: Request, response: Response, next: NextFunction) {
  const actorId = request.body?.actorId || request.body?.uploadedBy || request.body?.requesterId || request.query.actorId || request.query.userId;
  if (actorId && String(actorId) !== request.cmmsUser!.id) {
    response.status(403).json({ error: "You cannot perform an action as another user." });
    return;
  }
  const scopedWorkOrderMatch = request.path.match(/^\/work-orders\/([^/]+)/);
  if (scopedWorkOrderMatch && !["sync"].includes(scopedWorkOrderMatch[1])) {
    try {
      const workOrder = getWorkOrderDetail(decodeURIComponent(scopedWorkOrderMatch[1]));
      if (!userCanAccessWorkOrder(request.cmmsUser!, workOrder)) {
        response.status(403).json({ error: "You do not have access to this work order." });
        return;
      }
    } catch {
      response.status(404).json({ error: "Work order not found." });
      return;
    }
  }
  if (request.cmmsUser!.role === "requester" && scopedWorkOrderMatch && request.method !== "GET") {
    try {
      const workOrder = getWorkOrderDetail(decodeURIComponent(scopedWorkOrderMatch[1]));
      if (workOrder.requesterId !== request.cmmsUser!.id) {
        response.status(403).json({ error: "You can only access work orders issued from your requester account." });
        return;
      }
    } catch {
      response.status(404).json({ error: "Work order not found." });
      return;
    }
  }
  if ((request.path.startsWith("/work-orders/sync")) && !["executive", "admin", "developer"].includes(request.cmmsUser!.role)) {
    response.status(403).json({ error: "This feature is locked while development is in progress." });
    return;
  }
  if (request.path.startsWith("/pm") && request.cmmsUser!.role === "requester") { response.status(403).json({ error: "Maintenance access is required." }); return; }
  if (request.path.startsWith("/assets") && !["executive", "admin", "developer"].includes(request.cmmsUser!.role)) { response.status(403).json({ error: "Management access is required." }); return; }
  next();
}

type LiveTopic = "work-orders" | "notifications" | "dashboard" | "spare-parts" | "pm" | "assets" | "master-data" | "users";

function topicsForMutation(pathname: string): LiveTopic[] {
  if (pathname.startsWith("/api/requester/work-orders") || pathname.startsWith("/api/work-orders") || pathname.startsWith("/api/integrations/appsheet/air-leaks")) {
    return ["work-orders", "notifications", "dashboard"];
  }
  if (pathname.startsWith("/api/spare-parts")) return ["spare-parts", "dashboard"];
  if (pathname.startsWith("/api/pm")) return ["pm", "dashboard"];
  if (pathname.startsWith("/api/assets")) return ["assets", "dashboard"];
  if (pathname.startsWith("/api/master-data")) return ["master-data"];
  if (pathname.startsWith("/api/users")) return ["users"];
  if (pathname.startsWith("/api/notifications")) return ["notifications"];
  return [];
}

function publishLiveChange(topic: LiveTopic, request: Request) {
  const message = JSON.stringify({ topic, at: new Date().toISOString() });
  for (const client of Array.from(liveClients)) {
    try {
      client.write(`data: ${message}\n\n`);
    } catch {
      liveClients.delete(client);
    }
  }
}

function connectLiveClient(request: Request, response: Response) {
  response.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  response.flushHeaders();
  try {
    response.write(`retry: 2000\ndata: ${JSON.stringify({ topic: "connected", at: new Date().toISOString() })}\n\n`);
  } catch {
    liveClients.delete(response);
    response.end();
    return;
  }
  liveClients.add(response);

  request.on("close", () => {
    liveClients.delete(response);
  });
  response.on("close", () => {
    liveClients.delete(response);
  });
  response.on("error", () => {
    liveClients.delete(response);
  });
}

app.get("/api/events", (request, response) => {
  connectLiveClient(request, response);
});

app.get("/api/requester/work-orders/:id/events", (request, response) => {
  getGuestWorkOrderTracking(request.params.id, String(request.query.token || ""));
  connectLiveClient(request, response);
});

// Broadcast only after a successful write has fully completed. This covers every
// current and future mutation without coupling the database layer to HTTP clients.
app.use((request, response, next) => {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
    next();
    return;
  }

  response.on("finish", () => {
    if (response.statusCode < 400) {
      const topics = topicsForMutation(request.path);
      topics.forEach((topic) => publishLiveChange(topic, request));
      if (topics.includes("work-orders")) void flushAllPlants().catch(console.error);
    }
  });
  next();
});

const liveHeartbeat = setInterval(() => {
  for (const client of Array.from(liveClients)) {
    try {
      client.write(`: keep-alive ${Date.now()}\n\n`);
    } catch {
      liveClients.delete(client);
    }
  }
}, 25000);
liveHeartbeat.unref();

const workOrderSyncRetry = setInterval(() => {
  void flushAllPlants().catch(console.error);
}, 60000);
workOrderSyncRetry.unref();

function notifyAllPlantsAboutLongRunningWork() {
  for (const plant of ["port-klang", "sendayan"] as const) {
    plantContext.run({ plant }, () => notifyLongRunningWorkOrders());
  }
}
notifyAllPlantsAboutLongRunningWork();
const longRunningWorkReminder = setInterval(notifyAllPlantsAboutLongRunningWork, 60000);
longRunningWorkReminder.unref();

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    service: "pbs-cmms-api",
    timestamp: new Date().toISOString()
  });
});

app.get("/api/users", (request, response) => {
  const list = () => listUsers(request.query.role ? String(request.query.role) : undefined);
  response.json(request.query.manage && request.cmmsUser?.plantAccess === "both" && ["executive", "admin", "developer"].includes(request.cmmsUser.role) ? plantContext.run({ plant: "all" }, list) : list());
});

app.post("/api/users", (request, response) => {
  response.status(201).json(createUser({
    actorId: String(request.body.actorId || ""),
    username: String(request.body.username || ""),
    password: String(request.body.password || ""),
    name: String(request.body.name || ""),
    role: String(request.body.role || "requester") as User["role"],
    department: String(request.body.department || ""),
    title: String(request.body.title || ""),
    plantAccess: request.body.plantAccess
  }));
});

app.patch("/api/users/:id", (request, response) => {
  response.json(updateUser(request.params.id, {
    actorId: String(request.body.actorId || ""),
    username: String(request.body.username || ""),
    password: request.body.password ? String(request.body.password) : undefined,
    name: String(request.body.name || ""),
    role: String(request.body.role || "requester") as User["role"],
    department: String(request.body.department || ""),
    title: String(request.body.title || ""),
    plantAccess: request.body.plantAccess
  }));
});

app.delete("/api/users/:id", (request, response) => {
  deactivateUser(request.params.id, String(request.body.actorId || ""));
  response.status(204).send();
});

app.delete("/api/users/:id/sessions", (request, response) => {
  const ended = revokeUserSessions(request.params.id, String(request.body.actorId || ""));
  response.json({ ended });
});

app.post("/api/auth/login", (request, response) => {
  if (!request.body.username || !request.body.password) {
    throw new Error("Username and password are required.");
  }

  const session = createAuthSession(String(request.body.username), String(request.body.password));
  response.cookie("cmms-session", session.token, { httpOnly: true, sameSite: "strict", secure: request.secure, maxAge: authSessionMaxAgeMs(), path: "/" });
  response.json(session);
});

app.post("/api/auth/logout", (request, response) => {
  const token = request.header("authorization")?.replace(/^Bearer /, "") || sessionCookie(request);
  if (token) revokeAuthSession(token);
  response.clearCookie("cmms-session", { path: "/" });
  response.status(204).send();
});
app.use("/uploads", (request, response, next) => {
  try {
    const mediaPath = decodeURIComponent(request.path);
    if (mediaPath.split("/").some((part) => part === "." || part === ".." || part.includes("\\"))) throw new Error("Invalid media path.");
    const workOrderId = mediaPath.match(/^\/work-orders\/([^/]+)\/[^/]+$/)?.[1];
    const avatarUserId = mediaPath.match(/^\/users\/([^/]+)\/[^/]+$/)?.[1];
    if (!workOrderId && !avatarUserId) throw new Error("Invalid media path.");
    const token = request.header("authorization")?.replace(/^Bearer /, "") || sessionCookie(request);
    if (token && !request.query.token) {
      const user = authenticateSession(token);
      const record = workOrderId ? db.prepare("SELECT plantId FROM work_orders WHERE id = ?").get(workOrderId) as { plantId: PlantId } | undefined : null;
      if (workOrderId && (!record || !userPlants(user).includes(record.plantId))) throw new Error("Media access denied.");
      if (avatarUserId) {
        const owner = db.prepare("SELECT plantAccess FROM users WHERE id = ?").get(avatarUserId) as User | undefined;
        if (!owner || !userPlants(owner).some((plant) => userPlants(user).includes(plant))) throw new Error("Media access denied.");
      }
      next(); return;
    }
    if (workOrderId && request.query.token) {
      const record = db.prepare("SELECT plantId FROM work_orders WHERE id = ?").get(workOrderId) as { plantId: PlantId } | undefined;
      if (!record) throw new Error("Media access denied.");
      plantContext.run({ plant: record.plantId }, () => getGuestWorkOrderTracking(workOrderId, String(request.query.token)));
      next(); return;
    }
    throw new Error("Authentication required.");
  } catch { response.status(403).json({ error: "Media access denied." }); }
}, express.static(uploadsRoot));

app.get("/api/auth/me", (request, response) => {
  response.json(request.cmmsUser);
});

app.post("/api/users/:id/avatar", upload.single("avatar"), (request, response) => {
  if (request.cmmsUser?.id !== request.params.id && !["executive", "admin", "developer"].includes(request.cmmsUser?.role || "")) {
    response.status(403).json({ error: "You can only update your own profile photo." });
    return;
  }
  const file = request.file;
  if (!file) {
    throw new Error("avatar image is required.");
  }

  const targetDir = path.join(uploadsRoot, "users", request.params.id);
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  const extension = path.extname(file.originalname) || ".jpg";
  const filename = `${randomUUID()}${extension}`;
  const targetPath = path.join(targetDir, filename);
  renameSync(file.path, targetPath);

  const user = updateUserAvatar(request.params.id, `/uploads/users/${request.params.id}/${filename}`);
  response.status(201).json(user);
});

app.get("/api/dashboard-summary", (_request, response) => {
  response.json(dashboardSummary());
});

app.get("/api/system/public-config", (_request, response) => {
  const publicUrl = (process.env.APP_PUBLIC_URL || "").trim().replace(/\/$/, "");
  response.json({ requesterUrl: publicUrl ? `${publicUrl}/requester` : "" });
});

app.get("/api/tv/work-orders", (_request, response) => {
  response.json(listTvWorkOrders());
});

app.get("/api/assets", (_request, response) => {
  response.json(getAssetDashboard());
});

app.post("/api/pm/plans", (request, response) => {
  response.status(201).json(createPmPlan({ ...request.body, actorId: request.cmmsUser!.id }));
});

app.patch("/api/assets/:id", (request, response) => {
  response.json(updateAsset(request.params.id, {
    actorId: String(request.body.actorId || ""),
    condition: String(request.body.condition || "operational") as "operational" | "watch" | "obsolete" | "decommissioned",
    criticality: String(request.body.criticality || "medium") as "critical" | "high" | "medium" | "low",
    location: String(request.body.location || "Production"),
    notes: String(request.body.notes || "")
  }));
});

app.get("/api/master-data", (_request, response) => {
  response.json(listMasterData());
});

app.post("/api/master-data/sections", (request, response) => {
  response.status(201).json(createSection({
    actorId: String(request.body.actorId || ""),
    department: String(request.body.department || "Production") as WorkOrderDepartment,
    name: String(request.body.name || ""),
    active: request.body.active === undefined ? true : Boolean(request.body.active)
  }));
});

app.patch("/api/master-data/sections/:id", (request, response) => {
  response.json(updateSection(request.params.id, {
    actorId: String(request.body.actorId || ""),
    department: String(request.body.department || "Production") as WorkOrderDepartment,
    name: String(request.body.name || ""),
    active: request.body.active === undefined ? true : Boolean(request.body.active)
  }));
});

app.post("/api/master-data/machines", (request, response) => {
  response.status(201).json(createMachine({
    actorId: String(request.body.actorId || ""),
    department: String(request.body.department || "Production") as WorkOrderDepartment,
    sectionId: String(request.body.sectionId || ""),
    area: String(request.body.area || "General"),
    name: String(request.body.name || ""),
    active: request.body.active === undefined ? true : Boolean(request.body.active)
  }));
});

app.post("/api/master-data/machines/import", (request, response) => {
  const rows = Array.isArray(request.body.rows) ? request.body.rows : [];
  response.status(201).json(importMachines({
    actorId: String(request.body.actorId || ""),
    rows: rows.map((row: Partial<MachineImportRow>) => ({
      department: String(row.department || "Production") as WorkOrderDepartment,
      sectionName: String(row.sectionName || ""),
      areaName: String(row.areaName || "General"),
      machineName: String(row.machineName || "")
    }))
  }));
});

app.patch("/api/master-data/machines/:id", (request, response) => {
  response.json(updateMachine(request.params.id, {
    actorId: String(request.body.actorId || ""),
    department: String(request.body.department || "Production") as WorkOrderDepartment,
    sectionId: String(request.body.sectionId || ""),
    area: String(request.body.area || "General"),
    name: String(request.body.name || ""),
    active: request.body.active === undefined ? true : Boolean(request.body.active)
  }));
});

app.post("/api/master-data/issue-categories", (request, response) => {
  response.status(201).json(createIssueCategory({
    actorId: String(request.body.actorId || ""),
    department: String(request.body.department || "Production") as WorkOrderDepartment,
    name: String(request.body.name || ""),
    active: request.body.active === undefined ? true : Boolean(request.body.active)
  }));
});

app.patch("/api/master-data/issue-categories/:id", (request, response) => {
  response.json(updateIssueCategory(request.params.id, {
    actorId: String(request.body.actorId || ""),
    department: String(request.body.department || "Production") as WorkOrderDepartment,
    name: String(request.body.name || ""),
    active: request.body.active === undefined ? true : Boolean(request.body.active)
  }));
});

app.get("/api/pm/dashboard", (request, response) => {
  const actorId = String(request.query.actorId || "");
  if (!actorId) {
    throw new Error("actorId query parameter is required.");
  }
  const year = Number(request.query.year || new Date().getFullYear());
  response.json(getPmDashboard(actorId, year));
});

app.get("/api/pm/templates", (_request, response) => {
  response.json(listPmTemplates());
});

app.post("/api/pm/templates", (request, response) => {
  response.status(201).json(savePmTemplate(null, request.body));
});

app.patch("/api/pm/templates/:id", (request, response) => {
  response.json(savePmTemplate(request.params.id, request.body));
});

app.patch("/api/pm/plans/:id/template", (request, response) => {
  response.json(assignPmTemplate(request.params.id, request.body));
});

app.patch("/api/pm/plans/:id", (request, response) => {
  response.json(updatePmPlan(request.params.id, request.body));
});

app.get("/api/pm/photos/:photoId", (request, response) => {
  const photo = getPmPhoto(request.params.photoId);
  response.setHeader("Content-Type", photo.mimeType);
  response.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(photo.originalName)}`);
  response.setHeader("Cache-Control", "private, max-age=3600");
  response.send(Buffer.from(photo.data));
});

app.get("/api/pm/schedules/:id", (request, response) => {
  const actorId = String(request.query.actorId || "");
  if (!actorId) {
    throw new Error("actorId query parameter is required.");
  }
  response.json(getPmScheduleDetail(request.params.id, actorId));
});

app.post("/api/pm/schedules/:id/start", (request, response) => {
  if (!request.body.actorId) {
    throw new Error("actorId is required.");
  }
  response.json(startPmSchedule(request.params.id, String(request.body.actorId)));
});

app.put("/api/pm/schedules/:id/results/:itemId", (request, response) => {
  response.json(savePmResult(request.params.id, { ...request.body, itemId: request.params.itemId }));
});

app.post("/api/pm/schedules/:id/results/:itemId/photos", pmProofUpload.single("photo"), (request, response) => {
  if (!request.file) {
    throw new Error("A proof photo is required.");
  }
  response.status(201).json(addPmResultPhoto({
    scheduleId: request.params.id,
    itemId: request.params.itemId,
    actorId: request.cmmsUser!.id,
    originalName: request.file.originalname,
    mimeType: request.file.mimetype,
    size: request.file.size,
    data: request.file.buffer
  }));
});

app.delete("/api/pm/photos/:photoId", (request, response) => {
  response.json(deletePmResultPhoto(request.params.photoId, String(request.body.actorId || "")));
});

app.post("/api/pm/schedules/:id/submit", (request, response) => {
  response.json(submitPmSchedule(request.params.id, request.body));
});

app.post("/api/pm/schedules/:id/verify", (request, response) => {
  if (!request.body.actorId) {
    throw new Error("actorId is required.");
  }
  response.json(verifyPmSchedule(request.params.id, String(request.body.actorId)));
});

app.get("/api/spare-parts", (_request, response) => {
  response.json(listSpareInventory());
});

app.post("/api/spare-parts", (request, response) => {
  response.status(201).json(createSparePart({
    actorId: String(request.body.actorId || ""),
    itemNo: String(request.body.itemNo || ""),
    name: String(request.body.name || request.body.description || ""),
    category: request.body.category ? String(request.body.category) : undefined,
    uom: request.body.uom ? String(request.body.uom) : undefined,
    currentStock: request.body.currentStock === undefined ? undefined : Number(request.body.currentStock),
    minStock: request.body.minStock === undefined ? undefined : Number(request.body.minStock),
    maxStock: request.body.maxStock === undefined ? undefined : Number(request.body.maxStock),
    supplier: request.body.supplier ? String(request.body.supplier) : undefined,
    price: request.body.price === undefined ? undefined : Number(request.body.price),
    partRank: request.body.partRank ? String(request.body.partRank) : undefined,
    status: request.body.status ? String(request.body.status) : undefined,
    stockRank: request.body.stockRank ? String(request.body.stockRank) : undefined,
    source: request.body.source ? String(request.body.source) : undefined,
    leadTime: request.body.leadTime ? String(request.body.leadTime) : undefined,
    description: request.body.description ? String(request.body.description) : undefined
  }));
});

app.get("/api/spare-parts/qr/lookup", (request, response) => {
  response.json(lookupSpareQr(String(request.query.value || "")));
});

app.get("/api/spare-parts/history/by-actor", (request, response) => {
  response.json(listSpareMovementsForActor(String(request.query.actorId || "")));
});

app.get("/api/spare-parts/sync/settings", (_request, response) => {
  response.json(getSpareSyncSettings());
});

app.patch("/api/spare-parts/sync/settings", (request, response) => {
  response.json(updateSpareSyncSettings({
    actorId: String(request.body.actorId || ""),
    scriptUrl: String(request.body.scriptUrl || ""),
    token: request.body.token === undefined ? undefined : String(request.body.token || ""),
    masterSheetName: String(request.body.masterSheetName || "Masterlist"),
    supplierSheetName: String(request.body.supplierSheetName || "Supplier"),
    movementSheetName: String(request.body.movementSheetName || "Movement Log")
  }));
});

app.post("/api/spare-parts/import", (request, response) => {
  response.status(201).json(importSpareParts({
    actorId: String(request.body.actorId || ""),
    masterText: String(request.body.masterText || ""),
    supplierText: request.body.supplierText ? String(request.body.supplierText) : undefined
  }));
});

app.post("/api/spare-parts/sync/pull", asyncHandler(async (request, response) => {
  response.json(await pullSparePartsFromSheet(String(request.body.actorId || "")));
}));

app.post("/api/spare-parts/sync/retry", asyncHandler(async (request, response) => {
  response.json(await retrySpareSync(String(request.body.actorId || "")));
}));

app.get("/api/work-orders/sync/settings", (_request, response) => {
  response.json(getWorkOrderSyncSettings());
});

app.patch("/api/work-orders/sync/settings", (request, response) => {
  response.json(updateWorkOrderSyncSettings({
    actorId: String(request.body.actorId || ""),
    scriptUrl: String(request.body.scriptUrl || ""),
    token: request.body.token === undefined ? undefined : String(request.body.token || ""),
    sheetName: String(request.body.sheetName || "WorkOrders"),
    webhookUrl: String(request.body.webhookUrl || "")
  }));
});

app.post("/api/work-orders/sync/retry", asyncHandler(async (request, response) => {
  response.json(await flushWorkOrderSyncQueue(String(request.body.actorId || "")));
}));

app.get("/api/integrations/air-leaks/settings", (_request, response) => {
  response.json(getAirLeakSyncSettings());
});

app.patch("/api/integrations/air-leaks/settings", (request, response) => {
  response.json(updateAirLeakSyncSettings({
    actorId: String(request.body.actorId || ""),
    inboundToken: request.body.inboundToken ? String(request.body.inboundToken) : undefined,
    scriptUrl: String(request.body.scriptUrl || ""),
    scriptToken: request.body.scriptToken ? String(request.body.scriptToken) : undefined,
    sheetName: String(request.body.sheetName || "Main")
  }));
});

app.post("/api/integrations/air-leaks/retry", asyncHandler(async (request, response) => {
  response.json(await flushAirLeakSyncQueue(String(request.body.actorId || "")));
}));

app.get("/api/spare-parts/:itemNo", (request, response) => {
  response.json(getSparePartDetail(request.params.itemNo));
});

app.get("/api/spare-parts/:itemNo/movements", (request, response) => {
  response.json(listSparePartMovements(request.params.itemNo));
});

app.post("/api/spare-parts/:itemNo/issue", asyncHandler(async (request, response) => {
  response.status(201).json(await issueSparePart(request.params.itemNo, {
    actorId: String(request.body.actorId || ""),
    workOrderId: String(request.body.workOrderId || ""),
    quantity: Number(request.body.quantity || 0),
    note: request.body.note ? String(request.body.note) : undefined
  }));
}));

app.post("/api/spare-parts/:itemNo/adjust", asyncHandler(async (request, response) => {
  response.status(201).json(await adjustSparePart(request.params.itemNo, {
    actorId: String(request.body.actorId || ""),
    type: request.body.type,
    quantity: Number(request.body.quantity || 0),
    note: String(request.body.note || "")
  }));
}));

app.get("/api/requester/work-orders", (_request, response) => {
  response.status(403).json({ error: "Guest tracking is disabled. Sign in with a requester account to track work orders." });
});

app.post("/api/integrations/appsheet/air-leaks", asyncHandler(async (request, response) => {
  const authorization = request.header("authorization") || "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : String(request.header("x-integration-key") || "").trim();
  if (!authenticateAirLeakIntegration(token)) {
    response.status(401).json({ ok: false, error: "Invalid Air Leak integration token." });
    return;
  }
  if (String(request.body.action || "").toLowerCase() === "delete") {
    const result = await deleteAppSheetAirLeak(String(request.body.airLeakId || request.body["Air Leak ID"] || ""));
    response.json(result);
    return;
  }
  const result = upsertAppSheetAirLeak({
    airLeakId: String(request.body.airLeakId || request.body["Air Leak ID"] || ""),
    date: String(request.body.date || request.body.Date || ""),
    section: String(request.body.section || request.body.Section || ""),
    pictureUrl: String(request.body.pictureUrl || request.body.Picture || ""),
    issue: String(request.body.issue || request.body.Issue || ""),
    machine: String(request.body.machine || request.body["Machine/Equipment"] || ""),
    issuedBy: String(request.body.issuedBy || request.body["Issue By"] || "")
  });
  let photoImported = false;
  if (request.body.pictureUrl || request.body.Picture) {
    photoImported = await importAirLeakPhoto(result.workOrderId, String(request.body.pictureUrl || request.body.Picture));
  }
  response.status(result.created ? 201 : 200).json({ ...result, photoImported });
}));

app.post("/api/requester/work-orders", (request, response) => {
  const input = validateCreateWorkOrderInput({
    ...request.body,
    requesterId: publicRequesterIdForUploads()
  });
  const workOrder = createWorkOrder(input);
  response.status(201).json({ workOrder, tracking: createGuestTrackingLink(workOrder.id) });
});

app.post("/api/requester/work-orders/:id/attachments", upload.array("attachments", 10), (request, response) => {
  const files = request.files as Express.Multer.File[];
  try { getGuestWorkOrderTracking(request.params.id, String(request.body.token || "")); }
  catch { files.forEach((file) => rmSync(file.path, { force: true })); response.status(403).json({ error: "A valid guest tracking token is required." }); return; }
  const workOrder = getWorkOrderDetail(request.params.id);
  const uploadWindowOpen = Date.now() - Date.parse(workOrder.createdAt) <= 5 * 60 * 1000;
  if (workOrder.requesterId !== publicRequesterIdForUploads() || workOrder.status !== "open" || !uploadWindowOpen) {
    files.forEach((file) => rmSync(file.path, { force: true }));
    response.status(403).json({ error: "The public upload window for this work order has closed." });
    return;
  }
  const saved = saveWorkOrderAttachments(request.params.id, publicRequesterIdForUploads(), "issue", files);
  response.status(201).json(saved);
});

app.get("/api/requester/work-orders/:id/tracking", (request, response) => {
  response.json(getGuestWorkOrderTracking(request.params.id, String(request.query.token || "")));
});

app.post("/api/requester/work-orders/:id/verification", (request, response) => {
  const status = String(request.body.status || "") as "closed" | "returned";
  if (!["closed", "returned"].includes(status)) {
    throw new Error("Guest verification status must be closed or returned.");
  }
  response.json(verifyGuestWorkOrder(
    request.params.id,
    String(request.body.token || ""),
    status,
    String(request.body.note || "")
  ));
});

app.patch("/api/requester/work-orders/:id/downtime-reason", (request, response) => {
  response.json(updateGuestWorkOrderDowntimeReason(
    request.params.id,
    String(request.body.token || ""),
    String(request.body.reason || "")
  ));
});

app.get("/api/work-orders", (request, response) => {
  const workOrders = listWorkOrders(request.cmmsUser);
  response.json(workOrders);
});

app.post("/api/work-orders", (request, response) => {
  if (request.cmmsUser?.role === "technician") {
    response.status(403).json({ error: "Technicians cannot create work orders. Use the assigned jobs queue instead." });
    return;
  }
  const input = validateCreateWorkOrderInput(request.body);
  const workOrder = createWorkOrder(input);
  response.status(201).json(workOrder);
});

app.get("/api/work-orders/:id/guest-link", (request, response) => {
  response.json(getGuestTrackingLink(request.params.id, request.cmmsUser!.id));
});

app.get("/api/work-orders/:id", (request, response) => {
  response.json(getWorkOrderDetail(request.params.id));
});

app.patch("/api/work-orders/:id", (request, response) => {
  const input = validateUpdateWorkOrderInput(request.body);
  response.json(updateWorkOrder(request.params.id, input));
});

app.delete("/api/work-orders/:id", asyncHandler(async (request, response) => {
  if (!request.body.actorId) {
    throw new Error("actorId is required.");
  }

  response.json(await deleteWorkOrder(request.params.id, String(request.body.actorId)));
}));

app.patch("/api/work-orders/:id/status", (request, response) => {
  const input = validateStatusInput(request.body);
  const workOrder = updateWorkOrderStatus(request.params.id, input);
  response.json(workOrder);
});

app.patch("/api/work-orders/:id/downtime-reason", (request, response) => {
  response.json(updateWorkOrderDowntimeReason(request.params.id, {
    actorId: request.cmmsUser!.id,
    reason: String(request.body.reason || "")
  }));
});

app.patch("/api/work-orders/:id/claim", (request, response) => {
  if (!request.body.actorId) {
    throw new Error("actorId is required.");
  }

  const workOrder = claimWorkOrder(
    request.params.id,
    String(request.body.actorId),
    request.body.note ? String(request.body.note) : undefined
  );
  response.json(workOrder);
});

app.patch("/api/work-orders/:id/assign", (request, response) => {
  if (!request.body.assignedToId || !request.body.actorId) {
    throw new Error("assignedToId and actorId are required.");
  }

  const workOrder = assignWorkOrder(
    request.params.id,
    String(request.body.assignedToId),
    String(request.body.actorId),
    request.body.note ? String(request.body.note) : undefined
  );
  response.json(workOrder);
});

app.post("/api/work-orders/:id/comments", (request, response) => {
  if (!request.body.actorId || !request.body.message) {
    throw new Error("actorId and message are required.");
  }

  const activity = addComment(request.params.id, String(request.body.actorId), String(request.body.message));
  response.status(201).json(activity);
});

app.post("/api/work-orders/:id/attachments", upload.array("attachments", 10), (request, response) => {
  const files = request.files as Express.Multer.File[];
  const uploadedBy = request.cmmsUser!.id;
  const kind = String(request.body.kind || "general");

  const saved = saveWorkOrderAttachments(
    request.params.id,
    uploadedBy,
    kind as "issue" | "before" | "progress" | "after" | "return_evidence" | "general",
    files
  );
  response.status(201).json(saved);
});

app.get("/api/notifications", (request, response) => {
  if (!request.query.userId) {
    throw new Error("userId query parameter is required.");
  }

  response.json(listNotifications(String(request.query.userId)));
});

app.patch("/api/notifications/read-all", (request, response) => {
  if (!request.body.userId) {
    throw new Error("userId is required.");
  }

  markAllNotificationsRead(String(request.body.userId));
  response.status(204).send();
});

app.patch("/api/notifications/:id/read", (request, response) => {
  markNotificationRead(request.params.id, request.cmmsUser!.id);
  response.status(204).send();
});

app.get("/api/push/config", (_request, response) => {
  response.json(webPushConfig());
});

app.post("/api/push/subscriptions", (request, response) => {
  const endpoint = String(request.body?.endpoint || "");
  const p256dh = String(request.body?.keys?.p256dh || "");
  const auth = String(request.body?.keys?.auth || "");
  if (!endpoint.startsWith("https://") || !p256dh || !auth) {
    throw new Error("A valid Web Push subscription is required.");
  }

  savePushSubscription(request.cmmsUser!.id, {
    endpoint,
    expirationTime: request.body.expirationTime == null ? null : Number(request.body.expirationTime),
    keys: { p256dh, auth }
  });
  response.status(201).json({ ok: true });
});

app.delete("/api/push/subscriptions", (request, response) => {
  const endpoint = String(request.body?.endpoint || "");
  if (!endpoint) {
    throw new Error("Push subscription endpoint is required.");
  }
  deletePushSubscription(endpoint, request.cmmsUser!.id);
  response.status(204).send();
});

app.post("/api/push/test", asyncHandler(async (request, response) => {
  if (!["executive", "admin", "developer"].includes(request.cmmsUser!.role)) {
    response.status(403).json({ error: "Executive, admin, or developer access is required." });
    return;
  }

  const config = webPushConfig();
  if (!config.enabled) {
    response.status(503).json({ error: "Web Push is not configured on the server." });
    return;
  }

  const result = await sendPushToAllUsers({
    title: "PBS CMMS broadcast test",
    body: "The administrator sent a test notification to all registered devices.",
    workOrderId: ""
  });
  response.json(result);
}));

if (webDistRoot) {
  app.use(express.static(webDistRoot));
  app.get("*", (request, response, next) => {
    if (request.path.startsWith("/api") || request.path.startsWith("/uploads")) {
      next();
      return;
    }

    response.sendFile(path.join(webDistRoot, "index.html"));
  });
}

app.use((error: Error, _request: Request, response: Response, _next: NextFunction) => {
  console.error(error);
  response.status(400).json({
    error: error.message || "Something went wrong."
  });
});

app.listen(port, () => {
  console.log(`PBS CMMS API running on http://localhost:${port}`);
});

function sessionCookie(request: Request): string {
  return (request.headers.cookie || "").split(";").map((part) => part.trim()).find((part) => part.startsWith("cmms-session="))?.slice(13) || "";
}
async function flushAllPlants() {
  for (const plant of ["port-klang", "sendayan"] as const) {
    await plantContext.run({ plant }, async () => {
      await flushWorkOrderSyncQueue();
      await flushAirLeakSyncQueue();
    });
  }
}
