import assert from "node:assert/strict";
import path from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";

const root = path.resolve("tmp", `plant-integration-${Date.now()}`);
mkdirSync(root, { recursive: true });
process.env.CMMS_DATA_DIR = root;
process.env.CMMS_UPLOADS_DIR = path.join(root, "uploads");
process.env.NODE_ENV = "test";
for (const key of Object.keys(process.env)) {
  if (/^(WORK_ORDER_|SPARE_|VAPID_)/.test(key)) delete process.env[key];
}
process.env.ADMIN_PASSWORD = "Plant-test-only-123!";
const m = await import("../dist/db.js");
const { plantContext } = await import("../dist/plant-context.js");
const inPlant = (plant, fn) => plantContext.run({ plant }, fn);
const password = "Plant-test-only-123!";
m.migrate();
inPlant("port-klang", () => m.seed());
m.migrate();
const admin = m.listUsers().find((u) => u.role === "admin");
assert.equal(admin.plantAccess, "both");
const createUser = (plant, role) => inPlant(plant, () => m.createUser({ actorId: admin.id, username: `${plant}-${role}`, name: `${plant} ${role}`, role, department: "Production", title: role, password, plantAccess: plant }));
const pk = createUser("port-klang", "requester");
const sd = createUser("sendayan", "requester");
const pkTech = createUser("port-klang", "technician");
const sdTech = createUser("sendayan", "technician");
const section = inPlant("sendayan", () => m.createSection({ actorId: admin.id, name: "Conversion" }));
const createOrder = (user) => inPlant(user.plantAccess, () => m.createWorkOrder(m.validateCreateWorkOrderInput({ requesterId: user.id, type: "maintenance", title: "Plant isolation test", issueDescription: "Test repair", responsibleDepartment: "Production" })));
const pkOrder = createOrder(pk), sdOrder = createOrder(sd);
const photoDir = path.join(process.env.CMMS_UPLOADS_DIR, "work-orders", sdOrder.id);
mkdirSync(photoDir, { recursive: true });
writeFileSync(path.join(photoDir, "proof.png"), "test photo fixture");
assert.equal(pkOrder.plantId, "port-klang");
assert.equal(sdOrder.plantId, "sendayan");
assert.notEqual(pkOrder.number, sdOrder.number);
assert.deepEqual(inPlant("sendayan", () => m.listWorkOrders()).map((wo) => wo.id), [sdOrder.id]);
assert.throws(() => inPlant("port-klang", () => m.getWorkOrderDetail(sdOrder.id)), /not found/i);
assert.throws(() => inPlant("port-klang", () => m.createMachine({ actorId: admin.id, sectionId: section.id, name: "Cross plant", area: "Test" })), /not found/i);
assert.throws(() => inPlant("port-klang", () => m.assignWorkOrder(pkOrder.id, sdTech.id, admin.id)), /plant/i);
assert.throws(() => inPlant("port-klang", () => m.db.prepare("UPDATE work_orders SET title = 'Leak' WHERE id = ?").run(sdOrder.id)), /plant/i);
assert.throws(() => inPlant("port-klang", () => m.db.prepare("DELETE FROM work_orders WHERE id = ?").run(sdOrder.id)), /plant/i);
for (const plant of ["port-klang", "sendayan"]) {
  inPlant(plant, () => m.importSpareParts({ actorId: admin.id, masterText: "ITEM NO.\tDESCRIPTION\tCURRENT STOCK\tPRICE\nSAME-001\tBearing\t10\t5" }));
}
await inPlant("sendayan", () => m.issueSparePart("SAME-001", { actorId: sdTech.id, workOrderId: sdOrder.id, quantity: 3 }));
assert.equal(inPlant("sendayan", () => m.listSpareInventory()).parts[0].currentStock, 7);
assert.equal(inPlant("port-klang", () => m.listSpareInventory()).parts[0].currentStock, 10);
await assert.rejects(inPlant("sendayan", () => m.issueSparePart("SAME-001", { actorId: sdTech.id, workOrderId: pkOrder.id, quantity: 1 })), /not found/i);
const planInput = { actorId: admin.id, mainMachine: "Conversion", machineName: "Sendayan machine", frequencyMonths: 1, occurrencesPerMonth: 1, technicianId: sdTech.id, startMonth: 1, weekOfMonth: 1, secondaryWeek: null, active: true };
const plan = inPlant("sendayan", () => m.createPmPlan(planInput));
assert.equal(inPlant("sendayan", () => m.getPmDashboard(admin.id)).plans.length, 1);
assert.throws(() => inPlant("port-klang", () => m.updatePmPlan(plan.id, { ...planInput, technicianId: pkTech.id })), /not found/i);
const schedule = inPlant("sendayan", () => m.getPmDashboard(admin.id)).schedules[0];
assert.throws(() => inPlant("port-klang", () => m.getPmScheduleDetail(schedule.id, admin.id)), /not found/i);
assert.equal(inPlant("all", () => m.listWorkOrders()).length, 2);
assert.equal(inPlant("all", () => m.listSpareInventory()).summary.totalValue, 85);
assert.equal(inPlant("all", () => m.dashboardSummary()).totalOpen, 2);
assert.equal(inPlant("sendayan", () => m.getSpareSyncSettings()).configured, false);
assert(inPlant("sendayan", () => m.listNotifications(sdTech.id)).every((n) => n.workOrderId === sdOrder.id));
assert(inPlant("port-klang", () => m.listNotifications(pkTech.id)).every((n) => n.workOrderId === pkOrder.id));
const sdSession = m.createAuthSession(sd.username, password);
const pkSession = m.createAuthSession(pk.username, password);
const adminSession = m.createAuthSession(admin.username, password);
const sdTechSession = m.createAuthSession(sdTech.username, password);
const port = 3397;
const server = spawn(process.execPath, [path.resolve("apps/api/dist/server.js")], { env: { ...process.env, PORT: String(port) }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
let logs = "";
server.stdout.on("data", (data) => { logs += data; });
server.stderr.on("data", (data) => { logs += data; });
const base = `http://localhost:${port}/api`;
async function get(url, session, plant) {
  return fetch(base + url, { headers: { ...(session ? { Authorization: `Bearer ${session.token}` } : {}), ...(plant ? { "X-CMMS-Plant": plant } : {}) } });
}
try {
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(logs);
    try { if ((await fetch(base + "/health")).ok) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal((await get("/work-orders", sdSession, "port-klang")).status, 403);
  assert.equal((await get("/work-orders", pkSession, "all")).status, 403);
  assert.equal((await get("/dashboard-summary")).status, 401);
  assert.equal((await get("/tv/work-orders")).status, 401);
  assert.equal((await get(`/work-orders/${pkOrder.id}`, sdSession, "sendayan")).ok, false);
  const media = `http://localhost:${port}/uploads/work-orders/${sdOrder.id}/proof.png`;
  assert.equal((await fetch(media)).status, 403);
  assert.equal((await fetch(media, { headers: { Authorization: `Bearer ${pkSession.token}` } })).status, 403);
  assert.equal((await fetch(media, { headers: { Authorization: `Bearer ${sdSession.token}` } })).status, 200);
  const sdResponse = await get("/work-orders", sdSession, "sendayan");
  const sdBody = await sdResponse.json();
  assert.equal(sdResponse.status, 200, JSON.stringify(sdBody) + logs);
  assert.equal(sdBody.length, 1);
  assert.equal((await (await get("/work-orders", adminSession, "all")).json()).length, 2);
  assert.equal((await (await get("/spare-parts", adminSession, "all")).json()).summary.totalValue, 85);
  assert.equal((await get(`/pm/dashboard?actorId=${sdTech.id}`, m.createAuthSession(sdTech.username, password), "sendayan")).status, 200);
  const concurrent = await Promise.all(Array.from({ length: 8 }, (_, i) => get("/work-orders", i % 2 ? pkSession : sdSession, i % 2 ? "port-klang" : "sendayan").then((response) => response.json())));
  concurrent.forEach((orders, i) => assert(orders.every((order) => order.plantId === (i % 2 ? "port-klang" : "sendayan"))));
  const guest = await fetch(base + "/requester/work-orders", { method: "POST", headers: { "Content-Type": "application/json", "X-CMMS-Plant": "sendayan" }, body: JSON.stringify({ type: "maintenance", title: "Guest Sendayan", issueDescription: "Guest repair", responsibleDepartment: "Production" }) }).then((response) => response.json());
  assert.equal(guest.workOrder.plantId, "sendayan");
  const requesterOrders = await (await get("/work-orders", sdSession, "sendayan")).json();
  const technicianOrders = await (await get("/work-orders", sdTechSession, "sendayan")).json();
  assert(requesterOrders.some((order) => order.id === guest.workOrder.id));
  assert(technicianOrders.some((order) => order.id === guest.workOrder.id));
  assert.equal((await get(`/work-orders/${guest.workOrder.id}`, sdSession, "sendayan")).status, 200);
  const requesterMutation = await fetch(base + `/work-orders/${guest.workOrder.id}/status`, { method: "PATCH", headers: { Authorization: `Bearer ${sdSession.token}`, "Content-Type": "application/json", "X-CMMS-Plant": "sendayan" }, body: JSON.stringify({ actorId: sd.id, status: "closed", note: "Not my request" }) });
  assert.equal(requesterMutation.status, 403);
  const guestToken = new URL(guest.tracking.path, "http://localhost").searchParams.get("token");
  assert.equal((await get(`/requester/work-orders/${guest.workOrder.id}/tracking?token=${guestToken}`)).status, 200);
  const guestEvents = await get(`/requester/work-orders/${guest.workOrder.id}/events?token=${guestToken}`);
  assert.equal(guestEvents.status, 200);
  assert.match(guestEvents.headers.get("content-type") || "", /text\/event-stream/);
  await guestEvents.body.cancel();
  assert.equal((await get(`/requester/work-orders/${guest.workOrder.id}/events?token=invalid`)).status, 400);
  const staffEvents = await get("/events", sdTechSession, "sendayan");
  const staffEventReader = staffEvents.body.getReader();
  await staffEventReader.read();
  await fetch(base + "/requester/work-orders", { method: "POST", headers: { "Content-Type": "application/json", "X-CMMS-Plant": "sendayan" }, body: JSON.stringify({ type: "maintenance", title: "Live event test", issueDescription: "Instant technician refresh", responsibleDepartment: "Production" }) });
  const liveChunk = await Promise.race([
    staffEventReader.read(),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Timed out waiting for work-order live event")), 3000))
  ]);
  assert.match(new TextDecoder().decode(liveChunk.value), /"topic":"work-orders"/);
  await staffEventReader.cancel();
  assert.equal((await get(`/requester/work-orders/${pkOrder.id}/tracking?token=${guestToken}`)).ok, false);
  const deniedWrite = await fetch(base + `/work-orders/${sdOrder.id}/comments`, { method: "POST", headers: { Authorization: `Bearer ${pkSession.token}`, "Content-Type": "application/json", "X-CMMS-Plant": "port-klang" }, body: JSON.stringify({ actorId: pk.id, message: "Forbidden comment" }) });
  assert.equal(deniedWrite.ok, false);
  const update = await fetch(base + `/users/${sd.id}`, { method: "PATCH", headers: { Authorization: `Bearer ${adminSession.token}`, "Content-Type": "application/json", "X-CMMS-Plant": "port-klang" }, body: JSON.stringify({ ...sd, actorId: admin.id, plantAccess: "both" }) });
  assert.equal(update.status, 200, await update.text());
  assert.equal((await get("/work-orders", sdSession, "sendayan")).status, 401);
  console.log("PASS: migration, plant isolation, cross-plant writes, same-number inventory, PM, notifications, combined summaries, HTTP access and session revocation.");
} finally {
  server.kill();
  m.db.close();
}
