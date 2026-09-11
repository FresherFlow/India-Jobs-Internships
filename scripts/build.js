import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildFeed, jobsToMarkdownTable, fmtDate } from "./feed.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_FILE = path.join(ROOT, "data", "jobs.json");

// ---------------------------------------------------------------------------
// 1. Load the single source of truth (data/jobs.json) and build the feed.
//    Contributor submissions land in data/jobs.json via the "approved" issue
//    workflow; later FresherFlow/quarry pipeline data can be merged here too.
// ---------------------------------------------------------------------------
async function loadFeed() {
  const raw = JSON.parse(await readFile(DATA_FILE, "utf8"));
  if (!Array.isArray(raw.jobs)) {
    throw new Error(`Expected data/jobs.json to be { jobs: [...] }`);
  }
  return buildFeed(raw.jobs);
}

// ---------------------------------------------------------------------------
// 2. Bake the feed into docs/index.html so GitHub Pages serves everything
//    from the one committed JSON (data/jobs.json). There is no jobs.json
//    file in docs/ — the only JSON in the repo is data/jobs.json.
// ---------------------------------------------------------------------------
async function writeSite(feed) {
  const siteFile = path.join(ROOT, "docs", "index.html");
  let html = await readFile(siteFile, "utf8");
  const injected = `<script>window.__FEED__ = ${JSON.stringify(feed)};</script>`;
  if (html.includes("<!--FEED-->")) {
    html = html.replace(/<!--FEED-->[\s\S]*?<!--\/FEED-->/, `  <!--FEED-->${injected}  <!--/FEED-->`);
  } else {
    html = html.replace("</head>", `  <!--FEED-->${injected}  <!--/FEED-->\n</head>`);
  }
  await writeFile(siteFile, html);
}

// ---------------------------------------------------------------------------
// 3. Render the README: ONE chronological list ("Latest Roles", newest
//    first by the hidden addedAt clock). Job vs Internship is shown per
//    row, not split into sections — the site filters handle narrowing.
// ---------------------------------------------------------------------------
async function writeReadme(feed) {
  // Dead rows stay in data/jobs.json (history) but never display.
  const open = feed.jobs.filter((j) => j.status !== "EXPIRED");
  const expired = feed.jobs.filter((j) => j.status === "EXPIRED");
  const jobs = open.filter((j) => j.type !== "INTERNSHIP").length;
  const internships = open.filter((j) => j.type === "INTERNSHIP").length;
  const updated = fmtDate(feed.lastUpdated).replace(/ /g, "_");

  const readme = `# India Jobs and Internships

![Jobs](https://img.shields.io/badge/Jobs-${jobs}-2E7D32) ![Internships](https://img.shields.io/badge/Internships-${internships}-E86A1C) ![Updated](https://img.shields.io/badge/Updated-${updated}-777777) [![Site](https://img.shields.io/badge/Site-live-2E7D32)](https://fresherflow.github.io/India-Jobs-Internships/) [![Data](https://img.shields.io/badge/Data-json-4A3BAA)](https://github.com/FresherFlow/India-Jobs-Internships/blob/main/data/jobs.json) [![Contribute](https://img.shields.io/badge/Contribute-add_a_role-E86A1C)](https://github.com/FresherFlow/India-Jobs-Internships/issues/new?template=new_role.yaml)

**Live site: https://fresherflow.github.io/India-Jobs-Internships/**

Entry-level software, tech, product, and quant jobs for new graduates across **India**. Every role links to a real, specific posting — no invented URLs. Roles come from the FresherFlow discovery pipeline plus community submissions, refreshed daily.

See [CONTRIBUTING.md](./CONTRIBUTING.md) to add or edit roles.

---

## 🆕 Latest Roles

${jobsToMarkdownTable(open)}

---

<details>
<summary><b>🔒 Closed roles (${expired.length})</b> <small>— click to expand</small></summary>

<small>These postings are no longer accepting applications but are kept for reference and possible re-openings.</small>

${jobsToMarkdownTable(expired)}

</details>
`;

  await writeFile(path.join(ROOT, "README.md"), readme);
}

// ---------------------------------------------------------------------------
async function main() {
  const feed = await loadFeed();

  await writeSite(feed);
  await writeReadme(feed);

  console.log(`Generated ${feed.count} roles`);
  console.log(`  Jobs: ${feed.jobs.filter((j) => j.type !== "INTERNSHIP").length}`);
  console.log(`  Internships: ${feed.jobs.filter((j) => j.type === "INTERNSHIP").length}`);
}

main().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});