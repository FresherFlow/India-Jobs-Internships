import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeJob, hashJobId } from "./feed.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_FILE = path.join(ROOT, "data", "jobs.json");

// Validates data/jobs.json (the single source of truth) before it is built:
// required fields present, schema normalizes cleanly, and no duplicate ids.
// Exit code 1 on any problem so CI can block bad contributions.

async function main() {
  const raw = JSON.parse(await readFile(DATA_FILE, "utf8"));
  if (!Array.isArray(raw.jobs)) {
    throw new Error("data/jobs.json must be { jobs: [...] }");
  }

  const errors = [];
  const seen = new Set();

  for (let i = 0; i < raw.jobs.length; i++) {
    const r = raw.jobs[i];
    const line = `jobs[${i}]`;

    if (!r?.title) errors.push(`${line}: missing title`);
    if (!r?.company) errors.push(`${line}: missing company`);
    if (!r?.applyLink) errors.push(`${line}: missing applyLink`);
    if (!Array.isArray(r?.locations) || r.locations.length === 0)
      errors.push(`${line}: locations must be a non-empty array`);

    const job = normalizeJob(r);
    if (!job) {
      errors.push(`${line}: does not normalize to a valid job`);
      continue;
    }

    const id = r.id ?? hashJobId(r.applyLink, r.title);
    if (seen.has(id)) errors.push(`${line}: duplicate id ${id}`);
    seen.add(id);
  }

  if (errors.length > 0) {
    console.error(`Validation failed on data/jobs.json (${errors.length} issue(s)):`);
    for (const e of errors) console.error("  - " + e);
    process.exit(1);
  }

  console.log(`Validation passed: ${raw.jobs.length} job(s) OK.`);
}

main().catch((err) => {
  console.error("Validation failed:", err.message);
  process.exit(1);
});