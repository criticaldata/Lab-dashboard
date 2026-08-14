# Lab Ledger — MIT Critical Data

A single-page dashboard for tracking every paper in the lab — what stage it's
at, which journal/conference it's currently with, and its full submission
history (so a rejection-and-resubmission is visible, not overwritten).

No login, no build step, nothing to install to view it.

## Structure

| File | Purpose |
|---|---|
| `index.html` | The whole site: KPIs, search, the paper detail view, and demo-mode inline editing. One file, no framework, no build step. |
| `data.json` | The real data the site reads, generated from the spreadsheet. |
| `data.sample.json` | Fixture data (8 papers) covering every UI state, for local testing/demos. |
| `export_data.py` | Regenerates `data.json` from `Lab_Papers_Dashboard.xlsx`, reconciling with any edits already applied via the Issue Form fallback. |
| `Lab_Papers_Dashboard.xlsx` | Source of truth for bulk edits. Papers Tracker + Submissions Log + Team Directory. |
| `assets/mit-critical-data-logo.svg`, `assets/favicon.ico` | Brand assets, pulled from criticaldata.mit.edu. |
| `change-log.json` | Audit trail of every change applied via the Issue Form, independent of GitHub's own history. |
| `scripts/status_logic.py` | The rules that compute a paper's status badge (⚪ Needs Status, 🔵 Reviewing, etc.) from its raw fields. Also ported inline into `index.html`'s script for demo-mode edits — see the comment there. |
| `scripts/export_team_emails.py` | Extracts authorized-editor emails from the spreadsheet into a local-only file. Only relevant if the paused Worker pipeline is ever resumed — see below. |
| `scripts/generate_issue_template.py`, `scripts/apply_update.py` | The Issue Form fallback pipeline — see "The Issue Form fallback" below. |
| `.github/` | The Issue Form fallback's template + Actions. |
| `worker-phase2-paused/` | A Cloudflare Worker (email-OTP auth + committing edits to `data.json`) that's built and tested but **not currently live** — parked, not deleted. See its own README and "Future: real authentication" below. |

## Data flow

```
Lab_Papers_Dashboard.xlsx  →  export_data.py  →  data.json  →  index.html
     (people edit this)         (one command)      (site reads this)
```

The spreadsheet is where the lab enters information. The site's `data.json`
load never writes anything back to the spreadsheet or the repo — see "Demo
mode" below for how inline edits actually get persisted right now.

Each paper can be sent to multiple journals/conferences over time. Instead
of overwriting a paper's venue/deadline on every attempt, each attempt is
logged separately in the spreadsheet's Submissions Log and exported into
that paper's `submissions` array, so a rejection followed by a resubmission
is fully visible on the paper's timeline rather than lost.

## Demo mode

Click a paper's **title** to open its detail view — full meta, next/past
meetings, current draft link, resources, and submission history — then
click **Edit** inside it to change anything.

**Right now, editing is open to anyone viewing the site, and every change is
saved to that browser's `localStorage` only** — never to `data.json`, never
to the shared repo, never seen by anyone else. A banner across the top of
the page says so at all times. This is intentional: the real auth pipeline
(email verification + committing to the shared repo) is built but paused —
see "Future: real authentication" below — and today's priority was a demo
that works reliably in front of an audience with zero external services
that could fail mid-demo.

What demo mode does:

- First time you edit in a browser tab, you're asked for your name (free
  text, not verified — cosmetic attribution only, shown next to the change
  so a room full of people editing different papers can tell whose edit is
  whose). It's remembered for the rest of that browser session.
- Edited papers show an **"Edited (demo)"** flag on their card and a note in
  their detail view ("Edited in this demo session by \_\_\_").
- Edits persist across a page refresh (they're in `localStorage`, which
  survives reloads — unlike the session name, which is in `sessionStorage`
  and clears when the tab closes).
- **Reset demo data** (top banner) clears everything back to the original
  `data.json`/`data.sample.json` — use this between demo runs.
- **Copy my changes as JSON** (top banner) dumps exactly what's in
  `localStorage` so real edits made during a demo aren't lost — a
  maintainer can hand-apply that JSON into the real `data.json` later. It's
  the same shape `apply_update.py` produces (`{ paperId: { fields, editedBy,
  editedAt } }`), so it's not a one-off format.

To demo against the safe fixture data instead of real lab papers, open
`index.html?data=data.sample.json` (see "Viewing this locally" below).

### The Issue Form fallback

There's also a GitHub Issue Form at **[Request a paper update](https://github.com/criticaldata/Lab-dashboard/issues/new?template=update-paper.yml)**,
a technical, GitHub-account-requiring path for maintainers that actually
commits to the shared `data.json` (unlike demo mode above). It checks the
submitter is a member of the `criticaldata` GitHub org and applies the
change via a GitHub Action. Useful today as the only path that persists a
real change beyond one browser; not something to hand to non-technical lab
members.

## Updating the site after editing the spreadsheet

Use the spreadsheet for bulk edits (re-triaging priorities across many
papers at once) or adding a batch of new papers, then regenerate the site's
data:

```bash
python3 export_data.py Lab_Papers_Dashboard.xlsx
git add data.json
git commit -m "Update paper statuses"
git push
```

GitHub Pages redeploys automatically within a minute or two of the push.

`export_data.py` reconciles against any changes already applied through the
Issue Form fallback: if a paper was edited that way more recently than the
spreadsheet file was last saved, re-running `export_data.py` **keeps those
values** instead of silently overwriting them with older spreadsheet data,
and prints a note telling you which papers it preserved. (Demo-mode edits
never reach `data.json` at all — see "Demo mode" above — so there's nothing
for this script to reconcile there; use "Copy my changes as JSON" to carry
them over by hand if a demo produced edits worth keeping.)

## New fields: meetings, draft link, resources — not yet in the spreadsheet

`data.json` now carries four new fields per paper, and `export_data.py`
reads them from two sheets that **don't exist yet** in
`Lab_Papers_Dashboard.xlsx`:

| Field | Source | Shape |
|---|---|---|
| `nextMeeting` | New "📅 Meetings Log" sheet, soonest future row | `{ date, link }` or `null` |
| `pastMeetings` | Same sheet, everything else, most recent first | `[{ date, link, notes }, …]` |
| `currentDraftLink` | New "Current Draft Link" column on Papers Tracker | URL string or `null` |
| `resources` | New "🔗 Resources" sheet | `[{ label, url }, …]` |

**Why the spreadsheet itself wasn't touched:** `Lab_Papers_Dashboard.xlsx`
has hand-configured conditional formatting and dropdown validation.
Round-tripping it through openpyxl (load → save) to add these
programmatically was tested first and confirmed to **drop
`xl/sharedStrings.xml` and `docProps/custom.xml`, and openpyxl's own load
warnings say the conditional-formatting extension gets stripped on save** —
real risk of visibly breaking the spreadsheet's formatting. Adding the new
sheet/column by hand in Excel/Google Sheets is safe and takes a couple of
minutes; mutating the binary programmatically wasn't worth that risk for
this. `export_data.py` is defensive either way — with the sheets absent (as
now), every paper just gets `nextMeeting: null, pastMeetings: [],
currentDraftLink: null, resources: []`, no crash, no data loss.

**"📅 Meetings Log" sheet** (mirror the existing "📨 Submissions Log"
pattern — one row per meeting, joined by paper title):

| Paper | Date/Time | Link | Notes |
|---|---|---|---|

**"🔗 Resources" sheet** (one row per resource):

| Paper | Label | URL |
|---|---|---|

**Papers Tracker**: add one column, `Current Draft Link`.

`data.sample.json`'s 8 fixture papers already have realistic example values
across all four fields (some with a next meeting and no past ones, some the
reverse, some with no draft link, varying resource counts) — open it or
demo with `?data=data.sample.json` to see the full range without touching
the real spreadsheet.

**One shape worth double-checking before it's locked in further:**
`resources` is intentionally free-form (`label` + `url`, no `type` field) so
it never needs a new field for a new kind of link — but that also means
there's no way to distinguish "Slack channel" from "dataset" programmatically
if you ever want to group or icon them differently in the UI. If that's
ever wanted, an optional `type` (e.g. `"slack"`, `"drive"`, `"dataset"`,
`"other"`) would be a cheap, backwards-compatible addition — flagging now
rather than after real resource data exists to migrate.

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

To demo/preview with fake fixture data (`data.sample.json`, 8 papers
covering every status, all four new fields populated) instead of the real
`data.json`, open `http://localhost:8000/?data=data.sample.json`.

## Future: real authentication

Demo mode (above) is a deliberate placeholder, not a security oversight —
worth saying explicitly since "anyone can edit, saved locally" would be a
real problem if it were the permanent design. Two real options exist:

**Already built, currently paused:** `worker-phase2-paused/` is a complete
Cloudflare Worker doing email one-time-code verification, signed session
tokens, and committing straight to `data.json` via the GitHub Contents API
— fully covered by an offline test suite (26 assertions, including the
unauthorized-email, expired/reused-code, and concurrent-edit-conflict
cases). It hit Cloudflare account/CLI setup friction that wasn't worth
debugging under demo deadline pressure; the code itself was never the
problem. See `worker-phase2-paused/README.md`.

**The likely long-term replacement: Supabase.** A hand-maintained email
allowlist (what the paused Worker uses, via a `TEAM_EMAILS` secret) doesn't
scale past a handful of people — every roster change is a manual
`wrangler secret put`. That's fine for a 4-person lab, not for a lab with
hundreds of members across a department. Supabase is a better fit for that
scale for two reasons:

1. **Built-in email OTP.** Supabase Auth already does exactly the
   verification flow the paused Worker hand-rolled (send a code, verify it,
   issue a session) — as a configured feature, not ~200 lines of custom
   code-generation/rate-limiting/JWT logic we'd otherwise have to keep
   correct and re-audit ourselves.
2. **A real admin UI for the roster.** Supabase gives you an
   `authorized_members` **table** lab admins manage through Supabase's own
   dashboard (add a row, remove a row) instead of regenerating and
   re-uploading a secret file every time someone joins or leaves.

Rough shape of that migration, for whenever it happens:

1. Create a Supabase project; enable email OTP in Supabase Auth.
2. Add an `authorized_members` table (email, name, role) that lab admins
   maintain directly — this replaces `TEAM_EMAILS` entirely.
3. Replace demo mode's `localStorage` writes in `index.html` with real
   Supabase-authenticated calls: sign in via Supabase Auth, then call a
   small server-side function (a Supabase Edge Function, playing the same
   role `apply-update` plays in the paused Worker) that re-validates the
   session against `authorized_members` and commits to `data.json` the
   same way `apply_update.py` already does today for the Issue Form path
   — read fresh, write with the current commit SHA, let GitHub's Contents
   API reject a stale write with 409 (the same race-condition handling
   already proven out in the paused Worker's `github.js`).
4. The Issue Form fallback and its GitHub-org-membership check can likely
   retire once this is live and reliable — two auth systems (GitHub org
   membership vs. an authorized-members table) staying in sync forever
   isn't worth maintaining once one of them is a strictly better fit.

This is intentionally not built yet. Today's demo mode gets a working,
zero-dependency demo in front of an audience; this section exists so the
"anyone can edit, only saved locally" state of things is never mistaken for
the finished design.

## Security notes (Issue Form fallback pipeline)

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
