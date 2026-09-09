export const VALID_TYPES = ["JOB", "INTERNSHIP", "WALKIN"];
export const VALID_MODES = ["ONSITE", "HYBRID", "REMOTE"];

// ATS / job-platform detection from the application URL's host. Generic
// infrastructure mapping (platforms, not companies): company career sites
// and portals get no badge.
const ATS_PATTERNS = [
  [/greenhouse\.io/i, "Greenhouse"],
  [/lever\.co/i, "Lever"],
  [/myworkdayjobs\.com|myworkdaysite\.com/i, "Workday"],
  [/taleo\.net/i, "Taleo"],
  [/ashbyhq\.com/i, "Ashby"],
  [/keka\.com/i, "Keka"],
  [/eightfold\.ai/i, "Eightfold"],
  [/oraclecloud\.com/i, "Oracle HCM"],
  [/successfactors\./i, "SAP SuccessFactors"],
  [/workable\.com/i, "Workable"],
  [/bamboohr\.com/i, "BambooHR"],
  [/recruit\.zoho\.com/i, "Zoho Recruit"],
  [/icims\.com/i, "iCIMS"],
  [/jobvite\.com/i, "Jobvite"],
  [/smartrecruiters\.com/i, "SmartRecruiters"],
  [/applytojob\.com/i, "ApplyToJob"],
  [/wellfound\.com/i, "Wellfound"],
  [/internshala\.com/i, "Internshala"],
  [/unstop\.com/i, "Unstop"],
  [/ycombinator\.com/i, "YC Jobs"],
  [/cutshort\.io/i, "Cutshort"],
  [/naukri\.com/i, "Naukri"],
  [/hirist\.com/i, "Hirist"],
  [/instahyre\.com/i, "Instahyre"],
  [/peoplestrong\.com/i, "PeopleStrong"],
  [/ultipro\.com/i, "UKG"],
  [/talismatic\.com/i, "Talismatic"],
  [/screenloop\.com/i, "Screenloop"],
  [/dover\.com/i, "Dover"],
  [/gusto\.com/i, "Gusto"],
  [/linkedin\.com/i, "LinkedIn"],
  [/indeed\.com/i, "Indeed"],
  [/docs\.google\.com\/forms/i, "Google Form"],
];

/** Platform name for an application URL, or "" for company-owned sites. */
export function atsFor(applyLink) {
  const u = String(applyLink || "");
  for (const [re, name] of ATS_PATTERNS) if (re.test(u)) return name;
  return "";
}

// The repo is "Jobs + Internships" and that is the ONLY split. It comes
// from the title text alone: contains "intern" -> INTERNSHIP,
// contains "walk-in"/"walk in" -> WALKIN, everything else -> JOB.
// No role-family buckets, no contributor-picked categories, no maps.
export function typeFromTitle(title) {
  const t = String(title || "").toLowerCase();
  if (t.includes("intern")) return "INTERNSHIP";
  if (t.includes("walk-in") || t.includes("walk in")) return "WALKIN";
  return "JOB";
}

function is(value, set) {
  return typeof value === "string" && set.includes(value);
}

/** Normalize a raw row + derive the FresherFlow-style id from applyLink+title.
 *  The type comes from the title text alone (see typeFromTitle). */
export function normalizeJob(r, dateAdded) {
  if (!r.title || !r.company || !r.applyLink) return null;

  const type = typeFromTitle(r.title);
  const workMode = is(r.workMode, VALID_MODES) ? r.workMode : "ONSITE";
  const status = r.status === "EXPIRED" ? "EXPIRED" : "PUBLISHED";
  // Logo comes from the contributor-supplied company website only (Google's
  // free favicon service, no key, no stored files, no hardcoded map).
  // No website -> no logo -> the site shows a letter monogram instead.
  const website = typeof r.companyWebsite === "string" ? r.companyWebsite.trim().replace(/\/$/, "") : "";
  const logo = r.companyLogoUrl ?? (website ? `https://www.google.com/s2/favicons?domain=${website.replace(/^https?:\/\//, "").split("/")[0]}&sz=128` : "");
  const ats = r.ats ?? atsFor(r.applyLink);

  return {
    id: r.id ?? hashJobId(r.applyLink, r.title),
    title: r.title,
    company: r.company,
    type,
    status,
    locations: Array.isArray(r.locations)
      ? r.locations.map((s) => s.trim()).filter(Boolean)
      : (r.locations ?? ["Multiple locations"]),
    workMode,
    applyLink: r.applyLink,
    ...(r.sourceLink ? { sourceLink: r.sourceLink } : {}),
    dateAdded: r.dateAdded ?? dateAdded ?? new Date().toISOString().slice(0, 10),
    ...(r.postedAt ? { postedAt: r.postedAt } : {}),
    ...(r.expiresAt ? { expiresAt: r.expiresAt } : {}),
    tags: r.tags ?? [],
    ...(r.notesHighlights ? { notesHighlights: r.notesHighlights } : {}),
    ...(r.salaryRange ? { salaryRange: r.salaryRange } : {}),
    ...(r.salaryPeriod ? { salaryPeriod: r.salaryPeriod } : {}),
    requiredSkills: r.requiredSkills ?? [],
    allowedPassoutYears: r.allowedPassoutYears ?? [],
    ...(website ? { companyWebsite: r.companyWebsite } : {}),
    // Hidden ordering clock (exact creation second). Display keeps using
    // dateAdded ("09 Sep 26"); this field is never shown, only sorted on.
    ...(r.addedAt ? { addedAt: r.addedAt } : {}),
    // ATS badge, derived from the link host (never stored per-company).
    ...(ats ? { ats } : {}),
    ...(website ? { companyWebsite: r.companyWebsite } : {}),
    ...(logo ? { companyLogoUrl: logo } : {}),
  };
}

export function hashJobId(applyLink, title) {
  let h = 0;
  const s = applyLink + "\u0000" + title;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return "job_" + Math.abs(h).toString(36);
}

/** Build a deduplicated, validated feed from raw rows. */
export function buildFeed(rows) {
  const seen = new Map();

  for (const r of rows) {
    const job = normalizeJob(r);
    if (!job) continue;
    if (seen.has(job.id)) continue;
    seen.set(job.id, job);
  }

  const jobs = Array.from(seen.values());

  return {
    lastUpdated: new Date().toISOString(),
    count: jobs.length,
    jobs,
  };
}

/** Produce an HTML table (SimplifyJobs style) for one section.
 *  Newest first, `↳` for repeated companies, like the SimplifyJobs lists.
 *  No tags in the Role cell. */
export function jobsToMarkdownTable(jobs) {
  if (jobs.length === 0) {
    return "*No open roles in this category right now.*";
  }

  const stamp = (j) => j.addedAt ?? j.dateAdded ?? "";
  const sorted = jobs
    .slice()
    .sort((a, b) =>
      stamp(a) === stamp(b)
        ? a.company.localeCompare(b.company)
        : stamp(a) < stamp(b)
          ? 1
          : -1,
    );

  const thead =
    "<table style=\"width: 100%; border-collapse: collapse;\">\n" +
    "<thead>\n<tr>\n" +
    "<th style=\"width: 20%; min-width: 150px; padding: 8px; text-align: left; border-bottom: 2px solid #ddd;\">Company</th>\n" +
    "<th style=\"width: 30%; min-width: 250px; padding: 8px; text-align: left; border-bottom: 2px solid #ddd;\">Role</th>\n" +
    "<th style=\"width: 20%; min-width: 150px; padding: 8px; text-align: left; border-bottom: 2px solid #ddd;\">Location</th>\n" +
    "<th style=\"width: 15%; min-width: 120px; padding: 8px; text-align: center; border-bottom: 2px solid #ddd;\">Application</th>\n" +
    "<th style=\"width: 15%; min-width: 120px; padding: 8px; text-align: center; border-bottom: 2px solid #ddd;\">Added</th>\n" +
    "</tr>\n</thead>\n<tbody>\n";

  let prevCompany = "";
  const rows = sorted.map((job) => {
    const closed = job.status === "EXPIRED" ? " 🔒" : "";
    const companyCell =
      prevCompany === job.company ? "↳" : `<strong>${esc(job.company)}</strong>`;
    prevCompany = job.company;
    return (
      "<tr>\n" +
      `<td>${companyCell}</td>\n` +
      `<td>${esc(job.title)}${closed}</td>\n` +
      `<td>${fmtLocation(job.locations)}</td>\n` +
      `<td><a href="${esc(job.applyLink, true)}">Apply</a></td>\n` +
      `<td>${fmtDate(job.dateAdded)}</td>\n` +
      "</tr>\n"
    );
  });

  return thead + rows.join("") + "</tbody>\n</table>\n";
}

function esc(s, attr = false) {
  const out = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return attr ? out.replace(/"/g, "&quot;") : out;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09-09" -> "09 Sep 26". Anything else passes through untouched. */
export function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return iso || "";
  return `${m[3]} ${MONTHS[+m[2] - 1] || m[2]} ${m[1].slice(2)}`;
}

export function fmtLocation(locations) {
  if (!locations || locations.length === 0) return "Multiple locations";
  if (locations.length === 1 && locations[0] === "Multiple locations")
    return "Multiple locations";
  return locations.map((l) => esc(l)).join("<br>");
}