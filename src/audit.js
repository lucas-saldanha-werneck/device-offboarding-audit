import { requireColumns } from "./csv.js";

export const normEmail = (e) => (e ?? "").trim().toLowerCase();
const DAY = 86400000;
const toDate = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s ?? "")) return null;
  const d = new Date(s + "T00:00:00Z");
  return Number.isNaN(d.getTime()) ? null : d;
};
const daysBetween = (a, b) => Math.round((a - b) / DAY);

/**
 * employees: {email,name,status,start_date,end_date}
 * devices:   {serial,model,assigned_to,status}
 * opts: {today: Date, leadDays: number, graceDays: number}
 */
export function audit(employees, devices, opts) {
  requireColumns(employees, ["email", "name", "status"], "employees");
  requireColumns(devices, ["serial", "assigned_to", "status"], "devices");
  const { today, leadDays = 14, graceDays = 3, recentDays = 30 } = opts;
  const findings = [];
  const byEmail = new Map();
  for (const e of employees) byEmail.set(normEmail(e.email), e);

  const holding = new Map(); // email -> devices currently assigned
  const serialSeen = new Map();
  for (const d of devices) {
    const s = d.serial.trim().toUpperCase();
    serialSeen.set(s, (serialSeen.get(s) ?? 0) + 1);
    if (d.status.toLowerCase() === "assigned" && d.assigned_to) {
      const k = normEmail(d.assigned_to);
      if (!holding.has(k)) holding.set(k, []);
      holding.get(k).push(d);
    }
  }

  for (const [s, n] of serialSeen)
    if (n > 1) findings.push({ type: "duplicate_serial", severity: "high", serial: s,
      detail: `serial listed ${n} times in the inventory` });

  for (const d of devices) {
    if (d.status.toLowerCase() !== "assigned") continue;
    if (!d.assigned_to) findings.push({ type: "assigned_without_owner", severity: "medium",
      serial: d.serial, detail: "status is assigned but no owner is set" });
    else if (!byEmail.has(normEmail(d.assigned_to)))
      findings.push({ type: "unknown_assignee", severity: "medium", serial: d.serial,
        email: d.assigned_to, detail: "owner is not in the HR export" });
  }

  for (const e of employees) {
    const k = normEmail(e.email);
    const status = e.status.toLowerCase();
    const devs = holding.get(k) ?? [];
    if (status === "terminated") {
      const end = toDate(e.end_date);
      if (!end) {
        if (devs.length) findings.push({ type: "bad_date", severity: "low", email: k,
          detail: `terminated with no valid end_date ("${e.end_date}"); cannot age the return` });
      }
      for (const d of devs) {
        const late = end ? daysBetween(today, end) : null;
        const overdue = late !== null && late > graceDays;
        findings.push({ type: "departed_with_device",
          severity: overdue ? "high" : "medium", email: k, serial: d.serial,
          model: d.model, daysSinceEnd: late,
          detail: late === null ? "device still assigned"
            : `device still assigned ${late} day(s) after the end date` });
      }
    } else if (status === "active" && devs.length === 0) {
      const start = toDate(e.start_date);
      if (!start) { findings.push({ type: "bad_date", severity: "low", email: k,
        detail: `active with no valid start_date ("${e.start_date}")` }); continue; }
      const until = daysBetween(start, today);
      if (until <= leadDays && until >= -recentDays)
        findings.push({ type: "no_device_for_hire", severity: until <= 0 ? "high" : "medium",
          email: k, daysUntilStart: until,
          detail: until <= 0 ? `started ${-until} day(s) ago with no device`
            : `starts in ${until} day(s) with no device assigned` });
    }
  }
  const rank = { high: 0, medium: 1, low: 2 };
  findings.sort((a, b) => rank[a.severity] - rank[b.severity] || a.type.localeCompare(b.type));
  return findings;
}

export function toMarkdown(findings, { today }) {
  const counts = {};
  for (const f of findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  const out = [`# Device audit (as of ${today.toISOString().slice(0, 10)})`, ""];
  if (!findings.length) return out.concat("No findings.", "").join("\n");
  out.push(`${findings.length} finding(s): ` +
    ["high", "medium", "low"].filter((s) => counts[s]).map((s) => `${counts[s]} ${s}`).join(", "), "");
  out.push("| Severity | Type | Who / what | Detail |", "|---|---|---|---|");
  for (const f of findings)
    out.push(`| ${f.severity} | ${f.type} | ${f.email ?? f.serial} | ${f.detail} |`);
  return out.concat("").join("\n");
}
