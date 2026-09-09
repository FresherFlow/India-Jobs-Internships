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
      const checked = items.find((l) => /^[-*]\s*\[x\]/i.test(l));
      const first = items.find((l) => /^[-*]\s*/.test(l));
      fields[label] = (checked || first || "").replace(/^[-*]\s*(\[.\])?\s*/i, "");
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
    if (fields[l] && String(fields[l]).trim()) return String(fields[l]).trim();
  }
  return "";
}

function toLocations(raw) {
  if (!raw) return ["Multiple locations"];
  return raw
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Job vs internship comes from the TITLE text alone: contains "intern" ->
// INTERNSHIP, contains "walk-in"/"walk in" -> WALKIN, else JOB.
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
  const website = get(fields, "Company website", "Company website (optional)");
  const active = get(fields, "Is this posting currently accepting applications?", "Is the posting currently accepting applications?");

  if (!applyLink || !company || !title) {
    return null;
  }

  return {
    id: hashJobId(applyLink, title),
    title,
    company,
    type: typeFromTitle(title),
    status: String(active).toLowerCase().startsWith("n") ? "EXPIRED" : "PUBLISHED",
    locations: toLocations(location),
    workMode: "ONSITE",
    applyLink,
    ...(website ? { companyWebsite: String(website).trim() } : {}),
    dateAdded: today,
    tags: [],
    requiredSkills: [],
    allowedPassoutYears: [],
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
    return { ok: true, duplicate: true };
  }
  jobs.push(job);
  return { ok: true, duplicate: false, job };
}

function handleEdit(jobs, fields) {
  const applyLink = get(fields, "Link to Job Posting");
  if (!applyLink) return { ok: false, error: "Missing Link to Job Posting." };

  const index = jobs.findIndex((j) => j.applyLink === applyLink);
  if (index === -1) return { ok: false, error: `No job found with URL ${applyLink}` };

  const remove = get(fields, "Permanently remove this job from the list?");
  if (String(remove).toLowerCase().startsWith("yes")) {
    jobs.splice(index, 1);
    return { ok: true, duplicate: false, removed: true };
  }

  const j = jobs[index];
  const company = get(fields, "Company Name");
  const title = get(fields, "Job Title");
  const location = get(fields, "Location");
  const website = get(fields, "Company website", "Company website (optional)");
  const active = get(fields, "Is this posting currently accepting applications?", "Is the posting currently accepting applications?");

  if (company) j.company = company;
  if (title) {
    j.title = title;
    j.type = typeFromTitle(title);
  }
  if (location) j.locations = toLocations(location);
  if (website) j.companyWebsite = String(website).trim();
  if (active) j.status = String(active).toLowerCase().startsWith("n") ? "EXPIRED" : "PUBLISHED";
  j.id = hashJobId(j.applyLink, j.title);
  return { ok: true, duplicate: false, job: j };
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
  const labels = (issue.labels || []).map((l) => String(l.name || "").toLowerCase());

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
  if (out) {
    const lines = [
      `ok=${summary.ok}`,
      `duplicate=${summary.duplicate ? "true" : "false"}`,
      `removed=${summary.removed ? "true" : "false"}`,
      `bulk=${summary.bulk ? "true" : "false"}`,
      `issue_number=${(issue && issue.number) || ""}`,
      `title=${summary.job ? summary.job.title : ""}`,
      `company=${summary.job ? summary.job.company : ""}`,
      `summary=${summary.summary || ""}`,
    ];
    appendFileSync(process.env.GITHUB_OUTPUT, lines.join("\n") + "\n");
  }
  console.log(JSON.stringify({ ...summary, issueNumber: issue && issue.number }, null, 2));
}

main().catch((err) => {
  output({ ok: false, error: err.message }, null);
  process.exit(1);
});