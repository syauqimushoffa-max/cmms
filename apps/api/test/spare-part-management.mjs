import assert from "node:assert/strict";
import path from "node:path";
import { mkdirSync } from "node:fs";

const root = path.resolve("tmp", `spare-part-management-${Date.now()}`);
mkdirSync(root, { recursive: true });
process.env.CMMS_DATA_DIR = root;
process.env.CMMS_UPLOADS_DIR = path.join(root, "uploads");
process.env.NODE_ENV = "test";

const m = await import("../dist/db.js");
m.migrate();
m.seed();

const admin = m.listUsers().find((user) => user.role === "admin");
assert(admin, "seeded admin user not found");

const created = m.createSparePart({
  actorId: admin.id,
  itemNo: "SP-NEW-001",
  name: "Nama sparepart",
  category: "Bearing",
  uom: "pcs",
  currentStock: 12,
  minStock: 3,
  maxStock: 24,
  supplier: "PBS Supplier"
});

assert.equal(created.itemNo, "SP-NEW-001");
assert.equal(created.searchName, "Nama sparepart");
assert.equal(created.description, "Nama sparepart");
assert.equal(created.currentStock, 12);
assert.equal(m.listSpareInventory().parts.some((part) => part.itemNo === "SP-NEW-001"), true);

console.log("PASS: create spare part and name field saved correctly.");
