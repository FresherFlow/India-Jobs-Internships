import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildFeed, jobsToMarkdownTable } from "./feed.js";

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
// 3. Render the README: two sections only — Jobs and Internships, split by
//    the title text (see typeFromTitle). Newest-first HTML tables in the
//    SimplifyJobs style.
// ---------------------------------------------------------------------------
const SECTIONS = [
  { key: "jobs", emoji: "💼", heading: "Full-Time Roles", match: (j) => j.type !== "INTERNSHIP" },
  { key: "internships", emoji: "🎓", heading: "Internship Roles", match: (j) => j.type === "INTERNSHIP" },
];

async function writeReadme(feed) {
  const indexLines = SECTIONS.map((s) => {
    const n = feed.jobs.filter(s.match).length;
    if (n === 0) return "";
    return `${s.emoji} **[${s.heading}](#-${slug(s.heading)})** (${n})`;
  }).filter(Boolean);

  const sections = SECTIONS.map((s) => {
    const jobs = feed.jobs.filter(s.match);
    if (jobs.length === 0) return "";
    return (
      `## ${s.emoji} ${s.heading}\n\n` +
      `[Back to top](#india-jobs-and-internships)\n\n` +
      `${jobsToMarkdownTable(jobs)}\n\n` +
      `[Back to top](#india-jobs-and-internships)\n`
    );
  }).filter(Boolean);

  const readme = `# India Jobs and Internships

Entry-level software, tech, product, and quant jobs for new graduates across **India**. Every role links to a real, specific posting — no invented URLs. Roles come from the FresherFlow discovery pipeline plus community submissions, refreshed daily.

Structured JSON feed: [data/jobs.json](https://github.com/FresherFlow/India-Jobs-Internships/blob/main/data/jobs.json) · [filterable site](https://fresherflow.github.io/India-Jobs-Internships/)

**Contribute by submitting an [issue](https://github.com/FresherFlow/India-Jobs-Internships/issues/new/choose)! See the contribution guidelines [here](./CONTRIBUTING.md).**

---
### Browse ${feed.count} Roles

${indexLines.join("\n\n")}

---

${sections.join("\n---\n\n")}
`;

  await writeFile(path.join(ROOT, "README.md"), readme);
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

// ---------------------------------------------------------------------------
async function main() {
  const feed = await loadFeed();

  await writeSite(feed);
  await writeReadme(feed);

  console.log(`Generated ${feed.count} roles`);
  for (const s of SECTIONS) {
    console.log(`  ${s.heading}: ${feed.jobs.filter(s.match).length}`);
  }
}

main().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});