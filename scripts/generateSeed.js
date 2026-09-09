import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seedJobs } from "./seed.js";
import { hashJobId } from "./feed.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_FILE = path.join(ROOT, "data", "jobs.json");

// Writes the bootstrap dataset to data/jobs.json (the single source of truth
// that the build + contribution workflow operate on). Existing entries that
// are NOT part of the curated seed (e.g. contributor submissions) are kept.

async function main() {
  const seen = new Set(seedJobs.map((j) => j.id));
  let existing = { jobs: [] };

  try {
    existing = JSON.parse(await readFile(DATA_FILE, "utf8"));
  } catch {
    // First run: no data file yet.
  }

  const extras = (Array.isArray(existing.jobs) ? existing.jobs : []).filter((j) => {
    const id = j?.id ?? hashJobId(j?.applyLink ?? "", j?.title ?? "");
    return !seen.has(id);
  });

  const merged = [...seedJobs, ...extras];
  await mkdir(path.dirname(DATA_FILE), { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify({ jobs: merged }, null, 2) + "\n");

  console.log(
    `Wrote data/jobs.json with ${merged.length} entries (${seedJobs.length} seed + ${extras.length} existing).`,
  );
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});