# Lab Ledger - MIT Critical Data

A single-page dashboard for tracking every paper in the lab — what stage it's
at, which journal/conference it's currently with, and its full submission
history (so a rejection-and-resubmission is visible, not overwritten).

No login, no build step, nothing to install to view it.

## Structure

| File | Purpose |
|---|---|
| `index.html` | The internal dashboard: KPIs (including an "Open to New Members" count), a single search box that matches title/owner/venue/notes (there's no separate owner dropdown — it didn't scale past a handful of names), the paper detail view, and demo-mode inline editing/create/delete. Requires no login today, but shows full internal detail (deadlines, drafts, meeting links, notes) — see "Project Discovery" below for why that matters. One file, no framework, no build step. |
| `discover.html` | The **public-safe** project-browsing page for prospective members. Reads only `data.public.json` — never `data.json`. See "Project Discovery" below. |
| `data.json` | The real data `index.html` reads, generated from the spreadsheet. Contains everything — safe only for lab members. |
| `data.public.json` | An explicit-allowlist export for `discover.html`, generated alongside `data.json`. Safe to share with anyone — see "Project Discovery" below for exactly why. |
| `data.sample.json`, `data.sample.public.json` | Fixture data (20 papers, 13 of them open to new members, spanning ML/policy-ethics/clinical-data/writing-heavy projects) covering every UI state, for local testing/demos of both pages. |
| `export_data.py` | Regenerates `data.json` **and** `data.public.json` from `Lab_Papers_Dashboard.xlsx`, reconciling `data.json` with any edits already applied via the Issue Form fallback. |
| `Lab_Papers_Dashboard.xlsx` | Source of truth for bulk edits. Papers Tracker + Submissions Log + Team Directory. |
| `assets/mit-critical-data-logo.svg`, `assets/favicon.ico` | Brand assets, pulled from criticaldata.mit.edu. |
| `change-log.json` | Audit trail of every change applied via the Issue Form, independent of GitHub's own history. |
| `scripts/status_logic.py` | The rules that compute a paper's status badge (⚪ Needs Status, 🔵 Reviewing, etc.) from its raw fields. Also ported inline into `index.html`'s script for demo-mode edits — see the comment there. |
| `scripts/export_team_emails.py` | Extracts authorized-editor emails from the spreadsheet into a local-only file. Only relevant if the paused Worker pipeline is ever resumed — see below. |
| `scripts/generate_issue_template.py`, `scripts/apply_update.py` | The Issue Form fallback pipeline — see "The Issue Form fallback" below. |
| `.github/` | The Issue Form fallback's template + Actions. |
| `worker-phase2-paused/` | A Cloudflare Worker (email-OTP auth + committing edits to `data.json`) that's built and tested but **not currently live** — parked, not deleted. See its own README and "Future: real authentication" below. |
| `test/` | Playwright + Node test suite covering `index.html`, `discover.html`, and the `data.public.json` security allowlist. See `test/README.md`. |

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
click **Edit** inside it to change anything, add a **+ New Project**, or
delete one.

**Right now, editing, creating, and deleting are all open to anyone viewing
the site, and every change is saved to that browser's `localStorage`
only** — never to `data.json`, never to the shared repo, never seen by
anyone else. A banner across the top of the page says so at all times. This
is intentional: the real auth pipeline (email verification + committing to
the shared repo) is built but paused — see "Future: real authentication"
below — and today's priority was a demo that works reliably in front of an
audience with zero external services that could fail mid-demo. It's also
why delete isn't a real delete: `data.json` is shared and unauthenticated,
so a real delete-on-click would let any visitor permanently remove a real
paper for the whole lab. Deleting a real paper here only hides it in that
browser's `localStorage` (a tombstone) — `data.json` itself is never
touched, and "Reset demo data" brings it right back.

What demo mode does:

- First time you edit, create, or delete in a browser tab, you're asked for
  your name (free text, not verified — cosmetic attribution only, shown
  next to the change so a room full of people editing different papers can
  tell whose edit is whose). It's remembered for the rest of that browser
  session.
- Edited papers show an **"Edited (demo)"** flag on their card and a note in
  their detail view ("Edited in this demo session by \_\_\_").
- **+ New Project** (top of the dashboard) opens a blank version of the same
  form used for editing — only Title is required. The new paper gets an ID
  in the same `P0xx` scheme as the real data (continuing from the highest
  existing number) and shows a **"New (not yet shared)"** flag on its card.
- Inside a paper's edit view, **Delete this project…** asks for confirmation
  before doing anything (no single-click delete). Deleting a paper you
  created locally removes it outright; deleting a real, `data.json`-sourced
  paper only hides it in this browser (see above).
- All of this persists across a page refresh (it's in `localStorage`, which
  survives reloads — unlike the session name, which is in `sessionStorage`
  and clears when the tab closes).
- **Reset demo data** (top banner) clears everything — edits, added papers,
  and hidden/deleted papers — back to the original `data.json`/
  `data.sample.json`. Use this between demo runs. Both this and the delete
  confirmation use the app's own styled confirm dialog, not the browser's
  native `confirm()` popup — and every action that changes something
  (saved, created, deleted, reset) shows a small toast so it's never silent.
- **Copy my changes as JSON** (top banner) dumps exactly what's in
  `localStorage` — edits, newly added papers, and deleted paper IDs, as
  `{ edits, added, deleted }` — so real changes made during a demo aren't
  lost. A maintainer can hand-apply that JSON into the real `data.json`
  later (the `edits` portion is the same shape `apply_update.py` produces:
  `{ paperId: { fields, editedBy, editedAt } }`).

**None of this touches `discover.html`.** Papers created or deleted in demo
mode only ever change `index.html`'s `localStorage` — `discover.html` reads
a completely separate file, `data.public.json`, generated only by
`export_data.py` from the real spreadsheet. A project added here will never
appear there, and one hidden here is never actually removed from there,
until it goes through the real spreadsheet → `export_data.py` pipeline. The
demo banner and the New Project form both say so on-screen.

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

## Project Discovery (discover.html)

A separate, public-facing page at `discover.html` for prospective/new
members to browse projects that are looking for collaborators — no login,
safe to link from anywhere (lab website, a flyer, a recruiting email).

**This is real security, not the same "temporary" status as demo-mode
editing above — don't conflate the two.** Demo mode on `index.html` is
explicitly a placeholder waiting on real auth (see "Future: real
authentication"). `discover.html` is different in kind: it's safe **today**,
permanently, by construction, and doesn't need to wait for anything.

Why it's actually safe, not just hidden:

- `discover.html` has **no code path that ever fetches `data.json`** —
  check the one `fetch()` call in its script if you want to verify that
  yourself. It only ever loads `data.public.json`.
- `data.public.json` is generated by `export_data.py` from an **explicit
  allowlist** (`PUBLIC_PAPER_FIELDS` in `export_data.py`) — every field on
  a public paper object is a deliberate inclusion. This matters because an
  allowlist fails safe: if someone adds a new sensitive field to `data.json`
  later (say, a grant number or a co-author's private contact info) and
  forgets this file exists, that field simply isn't on `data.public.json`
  — nothing has to be remembered to keep it out. A denylist ("export
  everything except these fields") would fail the opposite way: forget to
  add the new sensitive field to the exclusion list, and it leaks silently.
- Papers are filtered **server-side, at export time** — only
  `openToNewMembers: true` papers are ever written to `data.public.json` at
  all. `discover.html`'s JS never sees the closed ones to accidentally
  expose; they're not in the file it downloads.
- A public paper object is exactly: `id`, `title`, `abstract`, `tags`,
  `skillsNeeded`, `stage` (a plain-language label like "In progress
  (drafting)" — deliberately coarser than the internal emoji status badge,
  which can say things like "Needs Attention" that read badly out of
  context), `openToNewMembers`, and `contact` (`{name, email}`). Nothing
  else — venue, deadline, notes, meeting links, draft links, resources,
  submission history, priority, and full names are never read by the
  function that builds this file, so there's nothing to accidentally leak.
- **Contact info never exposes a personal email by accident.** A paper's
  `contact.email` is the owner's real address only if their Team Directory
  row has `Public Contact OK` explicitly set; otherwise (the default for
  every current team member) it's a generic shared lab inbox
  (`GENERIC_LAB_EMAIL` in `export_data.py` — a placeholder right now,
  update it to your lab's real shared address).
- **This is automatically enforced, not just true today.**
  `test/test_public_allowlist.js` loads `data.public.json` and
  `data.sample.public.json` and asserts every paper object has *exactly*
  the allowed key set — plus a belt-and-suspenders check that the raw JSON
  text never contains any of the specifically named sensitive field names.
  `test/test_discover.js` separately asserts the page makes zero network
  requests to `data.json`. If a future change to `export_data.py` or
  `discover.html` ever widens what's exposed here, these tests fail — see
  `test/README.md` for how to run them.

**New fields driving this** (see "New fields not yet in the spreadsheet"
below for the exact columns to add): `abstract` (2-3 sentence plain-language
summary — real papers get one only once the spreadsheet has one; nothing
was fabricated), `tags`, `skillsNeeded`, and `openToNewMembers` (a project
only appears on `discover.html` once this is explicitly set `true` —
nothing is open by default). `openToNewMembers` also drives a small
"🤝 Open to new members" badge and its own KPI card on `index.html` itself,
so lab members can see at a glance which projects are recruiting without
needing to visit the public page.

**Matching is intentionally basic today:** weighted keyword overlap between
what someone types and each project's title/tags/skillsNeeded/abstract,
sorted best-match-first — the page says so on-screen ("Basic keyword
matching for now — this will become an AI-powered recommendation soon"). A
tag or skill hit counts for more than the same word merely appearing inside
the abstract (a tag match is a much stronger "this is what you want" signal
than an incidental word in a sentence), and matching is word-boundary aware
rather than raw substring search — a short token like "AI" only counts
against a whole word, not a random word that happens to contain those two
letters (an earlier substring-only version of this matched "AI" inside
"cl**ai**ms", surfacing an unrelated paper for every AI query). A query
that matches nothing still shows every open project rather than an empty
page, and says so ("No close matches for '…' — showing all N open
projects"); a query that's entirely stopwords or too short to search on
gets its own plain-language explanation instead of silently falling back.
A real AI-matching agent representing the PI is a planned future upgrade,
not built here; today's version needs no ML, no API key, nothing that can
fail in front of an audience.

Try it locally: `http://localhost:8000/discover.html?data=data.sample.public.json`
(the real `data.public.json` is empty until the spreadsheet has at least one
paper marked `Open to New Members` — see below).

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

## New fields not yet in the spreadsheet

`data.json` now carries several new fields per paper that `export_data.py`
reads from sheets/columns that **don't exist yet** in
`Lab_Papers_Dashboard.xlsx`:

| Field | Source | Shape |
|---|---|---|
| `nextMeeting` | New "📅 Meetings Log" sheet, soonest future row | `{ date, link }` or `null` |
| `pastMeetings` | Same sheet, everything else, most recent first | `[{ date, link, notes }, …]` |
| `currentDraftLink` | New "Current Draft Link" column on Papers Tracker | URL string or `null` |
| `resources` | New "🔗 Resources" sheet | `[{ label, url }, …]` |
| `abstract` | New "Abstract" column on Papers Tracker | 2-3 sentence string or `null` |
| `tags` | New "Tags" column, comma-separated | `["clinical ML", "causal inference"]` |
| `skillsNeeded` | New "Skills Needed" column, comma-separated | `["Python", "writing"]` |
| `openToNewMembers` | New "Open to New Members" column (Yes/No) | boolean, defaults `false` |

The last four feed `discover.html` (see "Project Discovery" above) —
`openToNewMembers` in particular is the switch that puts a paper on that
public page at all, so it defaults to `false`/hidden until someone
explicitly opts a project in.

**Why the spreadsheet itself wasn't touched:** `Lab_Papers_Dashboard.xlsx`
has hand-configured conditional formatting and dropdown validation.
Round-tripping it through openpyxl (load → save) to add these
programmatically was tested first and confirmed to **drop
`xl/sharedStrings.xml` and `docProps/custom.xml`, and openpyxl's own load
warnings say the conditional-formatting extension gets stripped on save** —
real risk of visibly breaking the spreadsheet's formatting. Adding the new
sheets/columns by hand in Excel/Google Sheets is safe and takes a few
minutes; mutating the binary programmatically wasn't worth that risk for
this. `export_data.py` is defensive either way — with everything absent (as
now), every paper just gets `nextMeeting: null, pastMeetings: [],
currentDraftLink: null, resources: [], abstract: null, tags: [],
skillsNeeded: [], openToNewMembers: false` — no crash, no data loss, and
(because of that last default) nothing shows up on `discover.html` either.

**"📅 Meetings Log" sheet** (mirror the existing "📨 Submissions Log"
pattern — one row per meeting, joined by paper title):

| Paper | Date/Time | Link | Notes |
|---|---|---|---|

**"🔗 Resources" sheet** (one row per resource):

| Paper | Label | URL |
|---|---|---|

**Papers Tracker**: add five columns — `Current Draft Link`, `Abstract`,
`Tags`, `Skills Needed`, `Open to New Members`.

**Team Directory**: add one column, `Public Contact OK` (Yes/No) — controls
whether a paper's public contact on `discover.html` shows that owner's real
email or falls back to the generic lab inbox. See "Project Discovery" above.

`data.sample.json`'s 20 fixture papers already have realistic example values
across every field above (13 of the 20 marked `openToNewMembers: true`,
spanning ML-heavy, policy/ethics-heavy, clinical-data-heavy, and
writing-heavy projects so `discover.html`'s search demos convincingly
across different typed interests; the rest show the full range of
meeting/draft/resource/multi-attempt-submission states) — open it or demo
with `?data=data.sample.json` (and
`discover.html?data=data.sample.public.json`) to see the full range without
touching the real spreadsheet or real data.

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

To demo/preview with fake fixture data (`data.sample.json`, 20 papers
covering every status, all four new fields populated) instead of the real
`data.json`, open `http://localhost:8000/?data=data.sample.json`.

## Future: real authentication

Demo mode (above) is a deliberate placeholder, not a security oversight —
worth saying explicitly since "anyone can edit, saved locally" would be a
real problem if it were the permanent design. Two real options exist:

**Already built, currently paused:** `worker-phase2-paused/` is a complete
Cloudflare Worker doing email one-time-code verification, signed session
tokens, and committing straight to `data.json` via the GitHub Contents API
— fully covered by an offline test suite (`worker/test/run.js`, 32
assertions across 11 scenarios, including the unauthorized-email,
expired/reused-code, and concurrent-edit-conflict cases — run it yourself
with `node worker-phase2-paused/worker/test/run.js`, no setup needed, it's
fully self-mocked). It hit Cloudflare account/CLI setup friction that
wasn't worth debugging under demo deadline pressure; the code itself was
never the problem. See `worker-phase2-paused/README.md`.

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
