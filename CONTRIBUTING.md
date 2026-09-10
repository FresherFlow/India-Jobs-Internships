# Contributing

Thanks for helping find new grad (fresher) roles across India! The list is
community-maintained: any verified full-time role, internship, or walk-in
hiring fresh graduates is welcome.

## How to contribute

Open an issue from the **Choose a template** menu. All submissions work the
same way: a maintainer reviews them, adds the **`approved`** label, and a bot
updates `data/jobs.json`, regenerates the README, deploys the
site, and auto-closes your issue.

| Template | Use it when… |
|---|---|
| **Add New Role** | Submitting a new full-time role, internship, or walk-in. |
| **Edit Role** | Updating an existing role (location, title, skills, batches, accepting/not accepting) or permanently removing a fake/off-topic one. |
| **Bulk Mark Roles as Inactive** | Marking several postings as closed in one batch (one URL per line, must match our feed). |
| **New Feature Request** | Ideas to improve the repo or the site. |
| **Miscellaneous Issue** | Questions and other feedback. |

### Adding a new role

1. Open a new issue using the **Add New Role** template.
2. Fill in only the essentials:
   - **Link to Job Posting** — a real, working application/posting URL
   - **Company Name**
   - **Job Title** — this decides the section: titles containing "intern" go to Internships, everything else to Jobs
    - **Location** (separate cities with `|`, add `Remote` if applicable)
    - **Company website** (optional — used to show the company logo)
    - **Required Skills** (optional — comma-separated, e.g. `React, JavaScript`)
    - **Allowed Passout Years** (optional — e.g. `2027`)
    - **Currently accepting applications?**
3. A maintainer adds the **`approved`** label and the bot does the rest.

One submission per role, even if from the same company.

## What makes a good submission

- Prefer a **specific posting URL** over a generic careers page.
- Only add roles that are genuinely **fresh-grad / early-career friendly**.
- If a posting stops accepting applications, open an issue or edit and we'll mark it closed (🔒).

## Data details (for maintainers)

- `data/jobs.json` is the editable source of truth (the only tracked JSON in the repo).
- `node scripts/build.js` reads `data/jobs.json` and writes `README.md` plus the feed baked into `docs/index.html`. The only JSON file in the repo is `data/jobs.json`.
- `node scripts/validate.js` checks `data/jobs.json` for schema/duplicate errors (CI runs it on every push/PR that touches `data/jobs.json`).
- `node scripts/generateSeed.js` normalizes `data/jobs.json` (canonical data lives in `data/jobs.json`; no bootstrap rows are re-merged).
- All scripts live in `scripts/` as plain Node.js (ESM) with zero dependencies — no `npm install`, no `node_modules`, nothing to build.
- The JSON schema mirrors FresherFlow's real `Opportunity` type (`title`, `company`, `type`, `workMode`, `locations[]`, `applyLink`, ...) so the feed can be consumed by FresherFlow later.