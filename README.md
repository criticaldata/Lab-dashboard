# Lab Ledger — MIT Critical Data

A single-page dashboard for tracking every paper in the lab — what stage it's
at, which journal/conference it's currently with, and its full submission
history (so a rejection-and-resubmission is visible, not overwritten).

No login, no build step, nothing to install to view it.

## Structure

| File | Purpose |
|---|---|
| `index.html` | The whole site. One file, no framework, no build step. |
| `data.json` | The real data the site reads, generated from the spreadsheet (and partly from applied Issue Form updates — see below). |
| `data.sample.json` | Fixture data (8 papers) covering every UI state, for local testing. |
| `export_data.py` | Regenerates `data.json` from `Lab_Papers_Dashboard.xlsx`, reconciling with any Issue Form updates already applied. |
| `Lab_Papers_Dashboard.xlsx` | Source of truth for bulk edits. Papers Tracker + Submissions Log + Team Directory. |
| `assets/mit-critical-data-logo.svg`, `assets/favicon.ico` | Brand assets, pulled from criticaldata.mit.edu. |
| `change-log.json` | Audit trail of every change applied via the Issue Form, independent of GitHub's own issue history. |
| `scripts/status_logic.py` | The rules that compute a paper's status badge (⚪ Needs Status, 🔵 Reviewing, etc.) from its raw fields. |
| `scripts/generate_issue_template.py` | Regenerates the "Paper" dropdown in the Issue Form from `data.json`. |
| `scripts/apply_update.py` | Applies a submitted Issue Form request to `data.json`, after verifying lab membership. |
| `.github/ISSUE_TEMPLATE/update-paper.yml` | The "Request a paper update" form non-technical members fill in. |
| `.github/workflows/*.yml` | The Actions that run the two scripts above automatically. |

## Data flow

```
Lab_Papers_Dashboard.xlsx  →  export_data.py  →  data.json  →  index.html
     (people edit this)         (one command)      (site reads this)
```

The spreadsheet is where the lab enters information. The site never writes
anything back — it's a read-only view generated from that spreadsheet.

Each paper can be sent to multiple journals/conferences over time. Instead
of overwriting a paper's venue/deadline on every attempt, each attempt is
logged separately in the spreadsheet's Submissions Log and exported into
that paper's `submissions` array, so a rejection followed by a resubmission
is fully visible on the paper's timeline rather than lost.

## How to request a status update

You don't need to touch the spreadsheet, the website's code, or ask anyone
for help to update a paper.

1. Go to **[Request a paper update](https://github.com/criticaldata/Lab-dashboard/issues/new?template=update-paper.yml)**.
2. Pick the paper from the dropdown.
3. Fill in only what changed — a new stage, a new submission you just sent
   out, a decision you heard back on, whatever's relevant. Leave everything
   else set to "— leave unchanged —".
4. Submit it.

That's it. If you're a recognized lab member, the dashboard updates itself
within a minute or two and you'll get a comment on your request confirming
exactly what changed. If something's off (a typo in the paper name, a badly
formatted date), you'll get a comment explaining what to fix — nothing
breaks, and nothing gets applied by accident.

## Updating the site after editing the spreadsheet

Use the Issue Form above for everyday updates. Use the spreadsheet for bulk
edits (re-triaging priorities across many papers at once) or adding a batch
of new papers — then regenerate the site's data:

```bash
python3 export_data.py Lab_Papers_Dashboard.xlsx
git add data.json
git commit -m "Update paper statuses"
git push
```

GitHub Pages redeploys automatically within a minute or two of the push.

These two paths write to the same `data.json`, so `export_data.py`
reconciles them automatically: if a paper was updated through the Issue Form
more recently than the spreadsheet file was last saved, re-running
`export_data.py` **keeps the issue-applied values** for that paper instead
of silently overwriting them with older spreadsheet data — it prints a note
telling you which papers it preserved, so you know to update the spreadsheet
to match if you want the change to stick there too. Once the spreadsheet
catches up (saved after the issue was applied), it becomes the source of
truth for that paper again automatically.

## Deployment

Repo → **Settings → Pages** → Source: **Deploy from a branch** → Branch:
`main`, folder `/ (root)` → Save.

A private repo does not mean a private site — GitHub Pages URLs are publicly
reachable by default even from a private repo. If that matters for this
data, either add a password gate to `index.html`, or host on Vercel/Netlify
instead, both of which support real password protection on free tiers.

## Viewing this locally

**Never open `index.html` by double-clicking it.** That loads it as a
`file://` URL, and browsers block `fetch()` from reading local files under
that scheme for security reasons — the page will silently render nothing but
the header logo, with no on-screen explanation (the error only shows up in
the browser console). Always serve the folder over HTTP instead:

```bash
cd lab-ledger
python3 -m http.server 8000
# or: npx serve
```

Then open `http://localhost:8000/` in your browser. This is also exactly how
GitHub Pages serves it in production, so testing this way matches reality.

To preview the dashboard with fake fixture data (`data.sample.json`, 8 papers
covering every status) instead of the real `data.json`, open
`http://localhost:8000/?data=data.sample.json`.

## Security notes (Issue Form → Action → data.json pipeline)

- The Action that applies update requests (`.github/workflows/update-request.yml`,
  logic in `scripts/apply_update.py`) checks the submitter's `criticaldata`
  org membership **server-side**, via the GitHub API — it never trusts
  anything the client submitted about who they are.
- That check uses a dedicated secret, `ORG_READ_PAT`: a fine-grained personal
  access token scoped to **read-only organization "Members" permission and
  nothing else** — it can't read code, open PRs, or write anything. That's
  the minimum permission the membership-check API call requires, so that's
  all it gets. The commit-and-push step uses the workflow's own built-in
  `GITHUB_TOKEN` instead (already scoped to just this repo), never the org PAT.
- Non-members get a clear rejection comment and the issue is closed — no
  data changes, no silent failure either way.
- If the membership check itself fails (a GitHub API error, not a "no"), the
  issue is left **open** and the Action run is marked failed, rather than
  guessing. A maintainer needs to look at those.
- No token or secret is ever committed to the repo — `ORG_READ_PAT` and
  `GITHUB_TOKEN` only ever exist as GitHub Actions secrets.

### One-time setup (a repo admin needs to do this once)

1. Create a fine-grained PAT: **github.com → Settings → Developer settings →
   Personal access tokens → Fine-grained tokens → Generate new token.**
   - Resource owner: `criticaldata`
   - Repository access: **No access to any repositories** (this token is
     only for the org membership API, not repo contents)
   - Organization permissions → **Members: Read-only**
   - Everything else: no access
2. Add it to this repo as a secret: **Settings → Secrets and variables →
   Actions → New repository secret**, name it `ORG_READ_PAT`, paste the
   token value.
3. That's it — `GITHUB_TOKEN` is provided automatically by GitHub Actions
   for every workflow run, no setup needed.
