# Lab Ledger — MIT Critical Data

A single-page dashboard for tracking every paper in the lab — what stage it's
at, which journal/conference it's currently with, and its full submission
history (so a rejection-and-resubmission is visible, not overwritten).

No login, no build step, nothing to install to view it.

## Structure

| File | Purpose |
|---|---|
| `index.html` | The whole site, including the inline "Edit" flow on each card. One file, no framework, no build step. |
| `data.json` | The real data the site reads: from the spreadsheet, from inline edits, and from Issue Form fallback edits — see below. |
| `data.sample.json` | Fixture data (8 papers) covering every UI state, for local testing. |
| `export_data.py` | Regenerates `data.json` from `Lab_Papers_Dashboard.xlsx`, reconciling with any edits already applied via the site or the Issue Form. |
| `Lab_Papers_Dashboard.xlsx` | Source of truth for bulk edits. Papers Tracker + Submissions Log + Team Directory. |
| `assets/mit-critical-data-logo.svg`, `assets/favicon.ico` | Brand assets, pulled from criticaldata.mit.edu. |
| `change-log.json` | Audit trail of every change applied via the site or the Issue Form, independent of GitHub's own history. |
| `scripts/status_logic.py` | The rules that compute a paper's status badge (⚪ Needs Status, 🔵 Reviewing, etc.) from its raw fields. |
| `scripts/export_team_emails.py` | Extracts authorized-editor emails from the spreadsheet into a local-only file — never committed. See "Worker setup" below. |
| `scripts/generate_issue_template.py`, `scripts/apply_update.py` | The Issue Form fallback pipeline — see "The Issue Form fallback" below. |
| `.github/` | The Issue Form fallback's template + Actions. |
| `worker/` | The Cloudflare Worker behind the inline "Edit" button: email verification, session tokens, and committing changes to `data.json`. See "The inline edit pipeline" below. |

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

Click **Edit** on any paper's card on the dashboard itself. That's it — no
GitHub account, no spreadsheet, nothing outside the website.

1. Click **Edit** on the paper's card.
2. First time in a browser session, you'll be asked for your lab email.
   Enter it and a 6-digit code arrives by email within a few seconds.
3. Enter the code. You're now verified for the next couple of hours — no
   need to repeat this for other edits in the same session.
4. Change whatever's relevant — Stage, Priority, Owner, or log a new
   submission / decision — and click **Save changes**.

The dashboard updates within a few seconds. If two people happen to edit the
same paper at almost the same moment, the second save gets a clear "someone
else just updated this, please refresh and try again" message instead of
silently overwriting the first — refreshing and re-saving works fine.

If your email isn't recognized, nothing obviously "fails" — you'd just never
receive a code. (This is deliberate: the form can't be used to check who is
or isn't in the system.) If you believe you should have access, ask whoever
maintains the spreadsheet to add your email to the Team Directory sheet.

### The Issue Form fallback

There's also a GitHub Issue Form at **[Request a paper update](https://github.com/criticaldata/Lab-dashboard/issues/new?template=update-paper.yml)**,
kept as a technical fallback for maintainers with GitHub access — useful if
the inline edit pipeline (Cloudflare Worker / email service) ever has an
outage. It works the same way it always has: pick a paper, fill in only
what changed, submit; a GitHub Action checks you're a member of the
`criticaldata` GitHub org and applies the change the same way. Not intended
to be advertised lab-wide — the inline Edit button above is the primary
path for everyone.

## Updating the site after editing the spreadsheet

Use the inline **Edit** button (or the Issue Form fallback) for everyday,
one-paper-at-a-time updates. Use the spreadsheet for bulk edits (re-triaging
priorities across many papers at once) or adding a batch of new papers —
then regenerate the site's data:

```bash
python3 export_data.py Lab_Papers_Dashboard.xlsx
git add data.json
git commit -m "Update paper statuses"
git push
```

GitHub Pages redeploys automatically within a minute or two of the push.

All three paths — inline edits, the Issue Form, and the spreadsheet — write
to the same `data.json`, so `export_data.py` reconciles them automatically:
if a paper was edited through the site or the Issue Form more recently than
the spreadsheet file was last saved, re-running `export_data.py` **keeps
those values** for that paper instead of silently overwriting them with
older spreadsheet data — it prints a note telling you which papers it
preserved, so you know to update the spreadsheet to match if you want the
change to stick there too. Once the spreadsheet catches up (saved after the
edit was applied), it becomes the source of truth for that paper again
automatically.

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

To test the inline Edit flow locally against a Worker running elsewhere
(staging, or `wrangler dev`), open
`http://localhost:8000/?worker=https://your-worker-url`. Without that
parameter, the page uses whatever's hardcoded in `index.html` as
`WORKER_URL` (a placeholder until you deploy — see below), and the Edit
button shows a friendly "unavailable" message rather than trying a real
request.

## The inline edit pipeline

Clicking **Edit** on the dashboard talks to a small Cloudflare Worker — the
only part of this system that holds real secrets. Nothing about how the
dashboard *loads* (`data.json` served straight from GitHub Pages) depends on
the Worker at all; if it's down, misconfigured, or you haven't deployed one
yet, the dashboard is still a fully working read-only view. Only the Edit
button's flow is affected.

```
Browser                          Cloudflare Worker                 GitHub
--------                         -----------------                 ------
"Edit" clicked
  → email entered        →  POST /request-code
                              checks TEAM_EMAILS (Worker secret)
                              sends a 6-digit code via Resend  →  (email inbox)
  → code entered          →  POST /verify-code
                              checks the code, issues a
                              short-lived signed session token
  → fields filled in,
    "Save changes"        →  POST /apply-update
                              re-checks TEAM_EMAILS
                              reads data.json fresh (Contents API)  →  GitHub
                              applies the change, recomputes status
                              writes data.json + change-log.json    →  GitHub
                              (commit lands, GitHub Pages redeploys)
```

Why a Worker and not, say, a Google Form + Sheet: everything stays on one
platform (GitHub Pages + Cloudflare + email) the lab already needs to
understand, the whole flow is a few small files you can read start to
finish, and there's no dependency on Google Workspace access/permissions
for a lab that may not standardize on it. The tradeoff is that a Worker
needs the one-time setup below, whereas a Google Form has none — but that
setup is a single `wrangler deploy`, done once.

### Worker setup (one-time, by whoever administers the lab's infrastructure)

You'll need three things: a free Cloudflare account, a free
[Resend](https://resend.com) account (for sending the verification codes),
and Node.js installed locally to run `wrangler` (Cloudflare's CLI).

**1. Install Wrangler and log in**

```bash
cd worker
npm install
npx wrangler login    # opens a browser to authorize against your Cloudflare account
```

**2. Create the KV namespace** (stores one-time codes and rate-limit counters)

```bash
npx wrangler kv namespace create CODES
```

This prints an `id`. Open `worker/wrangler.toml` and paste it in place of
`REPLACE_WITH_YOUR_KV_NAMESPACE_ID`. Also replace
`REPLACE_WITH_YOUR_CLOUDFLARE_ACCOUNT_ID` with your account ID (`npx
wrangler whoami`, or any page of the Cloudflare dashboard sidebar).

**3. Generate a repo-scoped GitHub token for commits**

GitHub → Settings → Developer settings → Personal access tokens →
Fine-grained tokens → Generate new token.
- Repository access: **Only select repositories** → `Lab-dashboard`
- Repository permissions → **Contents: Read and write** (needed to read and
  commit `data.json`/`change-log.json`)
- Everything else: no access

This is a **different token** from `ORG_READ_PAT` used by the Issue Form
fallback — that one only reads org membership and can't touch repo
contents; this one only touches this repo's contents and knows nothing
about org membership. Keep them separate; neither needs the other's scope.

**4. Get a Resend API key**

Sign up at resend.com (free tier: 100 emails/day, 3000/month — plenty for a
lab). Dashboard → API Keys → Create API Key. The default sending address
`onboarding@resend.dev` works immediately with no setup for testing; for
real lab-wide use, verify your own domain in Resend and update `EMAIL_FROM`
in `worker/wrangler.toml`.

**5. Generate a JWT signing secret**

Any sufficiently random string, e.g.:

```bash
openssl rand -base64 32
```

**6. Set the three Worker secrets** (never go in `wrangler.toml` or any
committed file — see "Security notes" below)

```bash
cd worker
npx wrangler secret put GITHUB_COMMIT_TOKEN     # paste the token from step 3
npx wrangler secret put RESEND_API_KEY          # paste the key from step 4
npx wrangler secret put JWT_SECRET              # paste the random string from step 5
```

**7. Set the authorized-email list**

```bash
cd ..
python3 scripts/export_team_emails.py Lab_Papers_Dashboard.xlsx
cd worker
npx wrangler secret put TEAM_EMAILS
# paste the contents of ../team-emails.local.json, Enter, then Ctrl+D (Ctrl+Z on Windows)
```

Re-run both commands whenever the Team Directory sheet's Email column
changes (someone joins/leaves the lab). This is the one piece of the
pipeline that isn't fully automatic from the spreadsheet — see "Security
notes" below for why.

**8. Deploy**

```bash
npx wrangler deploy
```

This prints your Worker's URL, something like
`https://lab-ledger-updates.your-subdomain.workers.dev`. Open `index.html`,
find the line `var WORKER_URL = "https://lab-ledger-updates.YOUR-SUBDOMAIN.workers.dev";`
near the bottom of the `<script>` block, replace it with your real URL,
commit, and push.

**9. Verify `ALLOWED_ORIGIN`**

`worker/wrangler.toml`'s `ALLOWED_ORIGIN` should already be
`https://criticaldata.github.io` — the Worker rejects requests from any
other origin outright (see "Security notes"). Only change this if the site
is served from somewhere else.

## Security notes (inline edit pipeline)

- **`GITHUB_COMMIT_TOKEN`**, **`RESEND_API_KEY`**, and **`JWT_SECRET`**
  exist only as Cloudflare Worker secrets (`wrangler secret put`) — never in
  `wrangler.toml`, never in any committed file, never sent to the browser.
- **`TEAM_EMAILS`** (the authorized-editor list) is *also* a Worker secret,
  not a file in this public repo — see "public vs. private" reasoning
  below. It's generated locally from the spreadsheet by
  `scripts/export_team_emails.py` into a gitignored file, then pasted into
  the secret by hand; it never touches git history.
- **`/request-code` cannot be used to enumerate who's authorized.** Every
  call gets the identical response (`{"ok":true,"message":"If that's a
  recognized lab email, a code has been sent."}`) whether the email is on
  the list, isn't, or the caller is rate-limited — verified directly in
  `worker/test/run.js` by asserting byte-identical responses for an
  authorized and an unauthorized email. Only whether an email actually gets
  sent differs, which is invisible to the caller. Even a failure from the
  email provider itself is swallowed rather than surfaced, since "delivery
  failed" would itself leak "that address exists."
- **`/apply-update` re-checks the authorized-email list on every call**,
  not just at verification time — a session token from someone since
  removed from the Team Directory stops working immediately, even though
  it's cryptographically still a valid, unexpired JWT for its full 2-hour
  window.
- **Session tokens live in `sessionStorage`, not `localStorage`** — they
  clear when the browser tab closes rather than persisting on a shared or
  public computer.
- **CORS is locked to `ALLOWED_ORIGIN` exactly** (`https://criticaldata.github.io`)
  for all three endpoints — a request from any other origin gets a hard 403,
  not just a response the browser happens to block client-side.
- **Concurrent edits can't silently clobber each other.** `/apply-update`
  reads `data.json` fresh from GitHub immediately before writing and writes
  back using that exact commit SHA; GitHub's Contents API itself rejects
  the write with a 409 if that SHA is no longer current (someone else
  committed in between — another inline edit, an Issue Form update, or a
  spreadsheet push), and the Worker turns that into a clear "someone else
  just updated this, please refresh and try again" response rather than a
  silent overwrite.
- **Why `TEAM_EMAILS` is a Worker secret and not a repo file:** this repo is
  public. A public, machine-readable list of the lab's real email addresses
  is a mild but real spam/scraping exposure that the names already visible
  in the Team Directory don't carry. For a team this size, embedding the
  list as a secret (one manual `wrangler secret put` when the roster
  changes) was judged a better tradeoff than either publishing real emails
  or adding a private Gist and a second token scope just to avoid one
  manual step.

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
