#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseCsv } from "./csv.js";
import { audit, toMarkdown } from "./audit.js";

const a = process.argv.slice(2);
const opt = (n, d) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : d; };
const pos = a.filter((x, i) => !x.startsWith("--") && !a[i - 1]?.startsWith("--"));
if (pos.length !== 2 || a.includes("--help")) {
  console.log("usage: device-audit <employees.csv> <devices.csv> [--today YYYY-MM-DD] [--lead-days 14] [--grace-days 3] [--json]");
  process.exit(pos.length === 2 ? 0 : 2);
}
const today = new Date((opt("--today", new Date().toISOString().slice(0, 10))) + "T00:00:00Z");
if (Number.isNaN(today.getTime())) { console.error("bad --today"); process.exit(2); }
try {
  const f = audit(parseCsv(readFileSync(pos[0], "utf8")), parseCsv(readFileSync(pos[1], "utf8")),
    { today, leadDays: Number(opt("--lead-days", 14)), graceDays: Number(opt("--grace-days", 3)) });
  console.log(a.includes("--json") ? JSON.stringify(f, null, 2) : toMarkdown(f, { today }));
  process.exit(f.some((x) => x.severity === "high") ? 1 : 0);
} catch (e) { console.error("error:", e.message); process.exit(2); }
