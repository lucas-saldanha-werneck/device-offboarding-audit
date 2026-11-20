import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCsv } from "../src/csv.js";
import { audit, toMarkdown } from "../src/audit.js";

const today = new Date("2026-11-20T00:00:00Z");
const emp = (o) => ({ email: "x@example.com", name: "X", status: "active", start_date: "2020-01-01", end_date: "", ...o });
const dev = (o) => ({ serial: "S1", model: "M", assigned_to: "", status: "in_stock", ...o });
const run = (e, d, o = {}) => audit(e, d, { today, ...o });

test("csv: quotes, escaped quotes, CRLF, blank lines", () => {
  const r = parseCsv('a,b\r\n"x, y","say ""hi"""\r\n\r\n1,2\r\n');
  assert.deepEqual(r, [{ a: "x, y", b: 'say "hi"' }, { a: "1", b: "2" }]);
});
test("csv: header is case-insensitive, short rows get empty strings", () => {
  assert.deepEqual(parseCsv("A,B\n1\n"), [{ a: "1", b: "" }]);
});
test("terminated employee with device: high when past grace", () => {
  const f = run([emp({ status: "terminated", end_date: "2026-11-10" })],
    [dev({ status: "assigned", assigned_to: "x@example.com" })]);
  assert.equal(f[0].type, "departed_with_device");
  assert.equal(f[0].severity, "high");
  assert.equal(f[0].daysSinceEnd, 10);
});
test("terminated inside grace window is medium", () => {
  const f = run([emp({ status: "terminated", end_date: "2026-11-18" })],
    [dev({ status: "assigned", assigned_to: "x@example.com" })]);
  assert.equal(f[0].severity, "medium");
});
test("email matching ignores case and spaces", () => {
  const f = run([emp({ status: "terminated", end_date: "2026-01-01" })],
    [dev({ status: "assigned", assigned_to: "  X@Example.COM " })]);
  assert.equal(f.filter((x) => x.type === "departed_with_device").length, 1);
  assert.equal(f.filter((x) => x.type === "unknown_assignee").length, 0);
});
test("terminated with no end date still flags, with bad_date note", () => {
  const f = run([emp({ status: "terminated", end_date: "" })],
    [dev({ status: "assigned", assigned_to: "x@example.com" })]);
  assert.ok(f.some((x) => x.type === "bad_date"));
  assert.ok(f.some((x) => x.type === "departed_with_device" && x.daysSinceEnd === null));
});
test("terminated employee with returned device is clean", () => {
  const f = run([emp({ status: "terminated", end_date: "2026-01-01" })],
    [dev({ status: "returned", assigned_to: "x@example.com" })]);
  assert.deepEqual(f, []);
});
test("new hire inside lead window with no device", () => {
  const f = run([emp({ start_date: "2026-11-24" })], []);
  assert.equal(f[0].type, "no_device_for_hire");
  assert.equal(f[0].daysUntilStart, 4);
  assert.equal(f[0].severity, "medium");
});
test("new hire far in the future is ignored; already started is high", () => {
  assert.deepEqual(run([emp({ start_date: "2027-03-01" })], []), []);
  const f = run([emp({ start_date: "2026-11-18" })], []);
  assert.equal(f[0].severity, "high");
});
test("active long-time employee without device is not flagged (may be BYOD)", () => {
  assert.deepEqual(run([emp({ start_date: "2020-01-01" })], []), []);
});
test("unknown assignee, missing owner, duplicate serial", () => {
  const f = run([emp({})], [
    dev({ serial: "A", status: "assigned", assigned_to: "ghost@example.com" }),
    dev({ serial: "B", status: "assigned" }),
    dev({ serial: "c" }), dev({ serial: "C" }),
  ]);
  const types = f.map((x) => x.type);
  assert.ok(types.includes("unknown_assignee"));
  assert.ok(types.includes("assigned_without_owner"));
  assert.ok(types.includes("duplicate_serial"));
});
test("missing columns throw a clear error", () => {
  assert.throws(() => run([{ nope: 1 }], []), /employees: missing column/);
  assert.throws(() => run([emp({})], [{ nope: 1 }]), /devices: missing column/);
});
test("findings are sorted high before low", () => {
  const f = run([emp({ start_date: "bad" }), emp({ email: "y@example.com", status: "terminated", end_date: "2026-01-01" })],
    [dev({ status: "assigned", assigned_to: "y@example.com" })]);
  assert.equal(f[0].severity, "high");
  assert.equal(f.at(-1).severity, "low");
});
test("example files produce the expected report", () => {
  const e = parseCsv(readFileSync(new URL("../examples/employees.csv", import.meta.url), "utf8"));
  const d = parseCsv(readFileSync(new URL("../examples/devices.csv", import.meta.url), "utf8"));
  const f = audit(e, d, { today });
  const key = f.map((x) => `${x.type}:${x.email ?? x.serial}`).sort();
  assert.deepEqual(key, [
    "assigned_without_owner:SN1006",
    "departed_with_device:bruno.costa@example.com",
    "departed_with_device:carla.souza@example.com",
    "departed_with_device:fabio.nunes@example.com",
    "bad_date:fabio.nunes@example.com",
    "duplicate_serial:SN1005",
    "no_device_for_hire:diego.alves@example.com",
    "no_device_for_hire:elena.ruiz@example.com",
    "unknown_assignee:gabriel.rocha@example.com",
  ].sort());
  assert.match(toMarkdown(f, { today }), /9 finding\(s\)/);
  assert.equal(toMarkdown([], { today }).includes("No findings."), true);
});
