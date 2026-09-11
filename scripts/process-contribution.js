#!/usr/bin/env node
// Process an approved GitHub issue into data/jobs.json using the
// FresherFlow-compatible schema (see normalizeJob in feed.js).
//
// Handles all three contribution templates (mirrors SimplifyJobs):
//   - new_role         -> append a new job
//   - edit_role        -> update fields / mark inactive / permanently remove
//   - bulk_mark_inactive -> mark multiple URLs as EXPIRED
//
// The id is derived from (applyLink + title) so re-runs are stable and
// duplicates are dropped.

import { readFile, writeFile } from "node:fs/promises";
import { appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_FILE = path.join(ROOT, "data", "jobs.json");

const today = new Date().toISOString().slice(0, 10);

function hashId(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return "job_" + Math.abs(h).toString(36);
}
function hashJobId(applyLink, title) {
  return hashId(applyLink + "\u0000" + title);
}

function parseIssueBody(body) {
  const fields = {};
  const blocks = String(body).split(/\r?\n(?=### )/);
  for (const block of blocks) {
    const heading = block.match(/^### (.+?)\n/);
    if (!heading) continue;
    const label = heading[1].trim();
    const rest = block.slice(heading.index + heading[0].length).trim();
    if (!rest) continue;

    const items = rest
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (items.every((l) => /^[-*]\s*(\[.\])?\s*/.test(l))) {
      const checked = items.filter((l) => /^[-*]\s*\[x\]/i.test(l));
      const first = items.find((l) => /^[-*]\s*/.test(l));
      // Location multi-pick may render one city per bullet: keep them all.
      // Everywhere else keeps single-pick semantics (first checked, else first).
      const picked =
        label === "Location" && !checked.length
          ? items.map((l) => l.replace(/^[-*]\s*(\[.\])?\s*/i, ""))
          : [(checked[0] || first || "").replace(/^[-*]\s*(\[.\])?\s*/i, "")];
      fields[label] = picked.join("\n");
      // Removal consent lives ONLY in a checked box. An unchecked "- [ ]"
      // parses to the same text, so record the box state separately.
      if (/permanently remove/i.test(label)) fields.__removeChecked = checked.length > 0;
    } else if (items.length > 1) {
      // multi-line answer (e.g. a textarea): keep each line separate
      fields[label] = items.join("\n");
    } else {
      fields[label] = items[0];
    }
  }
  return fields;
}

function get(fields, ...labels) {
  for (const l of labels) {
    const v = fields[l] ? String(fields[l]).trim() : "";
    // GitHub writes "_No response_" for empty optional fields: never data.
    if (v && v !== "_No response_") return v;
  }
  return "";
}

function toLocations(...raws) {
  const out = [];
  for (const raw of raws) {
    if (!raw) continue;
    for (const s of String(raw).split(/[\r\n|,]+/)) {
      const t = s.trim().replace(/^Other$/i, "");
      if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
    }
  }
  return out.length ? out : ["Multiple locations"];
}

// Job vs internship comes from the TITLE text alone: contains "intern" ->
// INTERNSHIP, contains "walk-in"/"walk in" -> WALKIN, else JOB.
function isNone(v) {
  return String(v || "").trim().toLowerCase() === "none";
}

// Optional skills: comma/pipe/newline separated, de-duplicated.
// A lone "None" means none (never stored as a skill).
function toSkills(...raws) {
  const out = [];
  for (const raw of raws) {
    if (!raw) continue;
    for (const s of String(raw).split(/[\r\n|,;]+/)) {
      const t = s.trim();
      if (!t || isNone(t)) continue;
      if (!out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
    }
  }
  return out;
}

// Optional batches: 4-digit years only, sorted. Anything else is ignored,
// so "None" or free text can never pollute the field.
function toYears(...raws) {
  const out = [];
  for (const raw of raws) {
    if (!raw) continue;
    for (const m of String(raw).matchAll(/\b(20\d{2})\b/g)) {
      const y = Number(m[1]);
      if (!out.includes(y)) out.push(y);
    }
  }
  return out.sort((a, b) => a - b);
}

function typeFromTitle(title) {
  const t = String(title || "").toLowerCase();
  if (t.includes("intern")) return "INTERNSHIP";
  if (t.includes("walk-in") || t.includes("walk in")) return "WALKIN";
  return "JOB";
}

function newJobFromIssue(fields) {
  const applyLink = get(fields, "Link to Job Posting");
  const company = get(fields, "Company Name");
  const title = get(fields, "Job Title");
  const location = get(fields, "Location");
  const locationOther = get(fields, "Other city");
  const website = get(fields, "Company website", "Company website (optional)");
  const activeRaw = get(fields, "Is this posting currently accepting applications?", "Is the posting currently accepting applications?");
  // Untouched dropdowns submit "None" — that is NOT a "No".
  const active = activeRaw && !isNone(activeRaw) ? activeRaw : "";
  const skills = get(fields, "Required Skills", "Required skills", "Skills");
  const years = get(fields, "Allowed Passout Years", "Allowed passout years", "Passout Years");

  if (!applyLink || !company || !title) {
    return null;
  }

  return {
    id: hashJobId(applyLink, title),
    title,
    company,
    type: typeFromTitle(title),
    status: active.toLowerCase().startsWith("n") ? "EXPIRED" : "PUBLISHED",
    locations: toLocations(location, locationOther),
    workMode: "ONSITE",
    applyLink,
    ...(website ? { companyWebsite: String(website).trim() } : {}),
    dateAdded: today,
    addedAt: new Date().toISOString(),
    tags: [],
    requiredSkills: toSkills(skills),
    allowedPassoutYears: toYears(years),
  };
}

// ---------------------------------------------------------------------------
async function readData() {
  return JSON.parse(await readFile(DATA_FILE, "utf8"));
}
async function writeData(jobs) {
  await writeFile(DATA_FILE, JSON.stringify({ jobs }, null, 2) + "\n");
}

function handleNew(jobs, fields) {
  const job = newJobFromIssue(fields);
  if (!job) return { ok: false, error: "Missing required fields in issue body." };
  if (jobs.some((j) => j.id === job.id)) {
    return { ok: true, duplicate: true, kind: "duplicate" };
  }
  jobs.push(job);
  return { ok: true, duplicate: false, kind: "new", job };
}

function handleEdit(jobs, fields) {
  const applyLink = get(fields, "Link to Job Posting");
  if (!applyLink) return { ok: false, error: "Missing Link to Job Posting." };

  const index = jobs.findIndex((j) => j.applyLink === applyLink);
  if (index === -1) return { ok: false, error: `No job found with URL ${applyLink}` };

  // Remove ONLY on an explicitly checked box (see __removeChecked).
  if (fields.__removeChecked) {
    const [gone] = jobs.splice(index, 1);
    return { ok: true, duplicate: false, removed: true, kind: "removed", job: gone };
  }

  const j = jobs[index];
  const company = get(fields, "Company Name");
  const title = get(fields, "Job Title");
  const location = get(fields, "Location");
  const locationOther = get(fields, "Other city");
  const website = get(fields, "Company website", "Company website (optional)");
  const activeRaw = get(fields, "Is this posting currently accepting applications?", "Is the posting currently accepting applications?");
  const active = activeRaw && !isNone(activeRaw) ? activeRaw : "";
  const skillsRaw = get(fields, "Required Skills", "Required skills", "Skills");
  const yearsRaw = get(fields, "Allowed Passout Years", "Allowed passout years", "Passout Years");

  const changes = [];
  if (company && company !== j.company) {
    changes.push(`company set to ${company}`);
    j.company = company;
  }
  if (title && title !== j.title) {
    j.title = title;
    j.type = typeFromTitle(title);
    changes.push(`title set to ${title}`);
  }
  if (location || locationOther) {
    const locs = toLocations(location, locationOther);
    changes.push(`location set to ${locs.join(", ")}`);
    j.locations = locs;
  }
  if (website && String(website).trim() !== (j.companyWebsite || "")) {
    j.companyWebsite = String(website).trim();
    changes.push("website added");
  }
  // Skills/batches touch only when the issue actually filled them in.
  // Untouched renders as "_No response_" (or missing) and means keep current;
  // a lone "None" clears the field.
  const touched = (...labels) =>
    labels.some((l) => {
      const v = fields[l] ? String(fields[l]).trim() : "";
      return v !== "" && v !== "_No response_";
    });
  if (touched("Required Skills", "Required skills", "Skills")) {
    const sk = isNone(skillsRaw) ? [] : toSkills(skillsRaw);
    if (JSON.stringify(sk) !== JSON.stringify(j.requiredSkills || [])) {
      j.requiredSkills = sk;
      changes.push(sk.length ? `skills set to ${sk.join(", ")}` : "skills cleared");
    }
  }
  if (touched("Allowed Passout Years", "Allowed passout years", "Passout Years")) {
    const yr = toYears(yearsRaw);
    // Junk with no years in it is ignored (never wipes); only real
    // years or a lone "None" apply.
    if (yr.length > 0 || isNone(yearsRaw)) {
      if (JSON.stringify(yr) !== JSON.stringify(j.allowedPassoutYears || [])) {
        j.allowedPassoutYears = yr;
        changes.push(yr.length ? `batches set to ${yr.join(", ")}` : "batches cleared");
      }
    }
  }
  if (active) {
    const closed = String(active).toLowerCase().startsWith("n");
    j.status = closed ? "EXPIRED" : "PUBLISHED";
    changes.push(closed ? "marked closed" : "marked open");
  }
  j.id = hashJobId(j.applyLink, j.title);
  return { ok: true, duplicate: false, kind: "edit", job: j, summary: changes.length ? changes.join("; ") : "no field changes" };
}

function handleBulk(jobs, fields) {
  const raw = get(fields, "Job Posting URLs");
  if (!raw) return { ok: false, error: "Missing Job Posting URLs." };
  const urls = raw.split("\n").map((s) => s.trim()).filter(Boolean);
  let changed = 0;
  const failed = [];
  for (const url of urls) {
    const j = jobs.find((x) => x.applyLink === url);
    if (!j) {
      failed.push(url);
      continue;
    }
    if (j.status !== "EXPIRED") {
      j.status = "EXPIRED";
      changed++;
    }
  }
  return {
    ok: true,
    duplicate: false,
    bulk: true,
    kind: "bulk",
    summary: `Marked ${changed} role(s) inactive. ${failed.length ? "Not found: " + failed.join(", ") : ""}`,
  };
}

// ---------------------------------------------------------------------------
async function main() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error("GITHUB_EVENT_PATH is not set");

  const event = JSON.parse(await readFile(eventPath, "utf8"));
  const issue = event.issue;
  if (!issue) throw new Error("No issue in event payload");

  const fields = parseIssueBody(issue.body);
  const labels = (issue.labels || []).map((l) => String(l?.name || "").toLowerCase());

  if (labels.includes("bulk_mark_inactive")) {
    const jobs = (await readData()).jobs;
    const result = handleBulk(jobs, fields);
    if (result.ok) await writeData(jobs);
    return output(result, issue);
  }
  if (labels.includes("edit_role")) {
    const jobs = (await readData()).jobs;
    const result = handleEdit(jobs, fields);
    if (result.ok && !result.duplicate) await writeData(jobs);
    return output(result, issue);
  }
  // default: new_role
  const jobs = (await readData()).jobs;
  const result = handleNew(jobs, fields);
  if (result.ok && !result.duplicate && !result.removed) await writeData(jobs);
  return output(result, issue);
}

function output(summary, issue) {
  const out = process.env.GITHUB_OUTPUT;
  const job = summary.job;
  // Always emit company/title so downstream steps (issue rename, junk-guard)
  // never see empty values. When no job object exists (error/duplicate/etc.)
  // fall back to the issue title so the run stays identifiable.
  const kind = summary.kind
    || (summary.error ? "error" : "")
    || (summary.removed ? "removed" : "")
    || (summary.bulk ? "bulk" : "")
    || (summary.duplicate ? "duplicate" : "")
    || (summary.ok ? "other" : "error");
  const title = summary.title ?? (job?.title ?? issue?.title ?? "");
  const company = summary.company ?? (job?.company ?? "");

  if (out) {
    const lines = [
      `ok=${summary.ok}`,
      `duplicate=${summary.duplicate ? "true" : "false"}`,
      `removed=${summary.removed ? "true" : "false"}`,
      `bulk=${summary.bulk ? "true" : "false"}`,
      `kind=${kind}`,
      `issue_number=${(issue && issue.number) || ""}`,
      `title=${title}`,
      `company=${company}`,
      `summary=${summary.summary || ""}`,
    ];
    appendFileSync(process.env.GITHUB_OUTPUT, lines.join("\n") + "\n");
  }
  console.log(JSON.stringify({ ...summary, issueNumber: issue && issue.number, kind }, null, 2));
}

main().catch((err) => {
  output({ ok: false, error: err.message }, null);
  process.exit(1);
});