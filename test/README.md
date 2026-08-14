# Tests

Browser/functional tests for `index.html` and `discover.html`, plus a
data-only test for `data.public.json`'s security allowlist.

## One-time setup

```bash
cd test
npm install
npx playwright install chromium
```

## Running

`test_public_allowlist.js` needs nothing but Node — it just reads the JSON
files directly:

```bash
node test/test_public_allowlist.js
```

Everything else drives a real browser against a locally served copy of the
site, so start a server first (from the repo root, in a separate terminal):

```bash
python3 -m http.server 8000
```

then, from the repo root:

```bash
node test/test_dashboard.js       # KPIs, search (incl. owner names), open-to-new-members badge/KPI, loading skeleton, submission history, mobile
node test/test_part1.js           # Needs Status collapse, last-updated field, print stylesheet
node test/test_demo_mode.js       # inline editing: every field type, persistence, reset, copy-as-JSON
node test/test_create_delete.js   # add/delete a project entirely in demo mode, real-paper hide vs. reset
node test/test_discover.js        # Project Discovery page: filtering, matching, mailto, network isolation
```

Or all of them at once: `npm test` from inside `test/` (with the server
already running).

Screenshots land in `test/screenshots/` (gitignored — regenerated each run,
not meant to be committed).

## What each one actually checks

- **`test_public_allowlist.js`** — the security-critical one. Asserts every
  paper object in `data.public.json` and `data.sample.public.json` has
  *exactly* the allowed key set, never a forbidden field, and that
  `openToNewMembers: false` papers never make it in at all. If someone
  widens what `export_data.py` writes to `data.public.json` later, this is
  what catches it.
- **`test_dashboard.js`** — the core internal dashboard: KPI counts
  (including the "Open to New Members" card and its per-card badge),
  clicking a KPI to filter, search (title/venue/notes and, since the old
  owner dropdown was removed, owner names too — case-insensitive, partial
  match), opening a paper's submission history, the loading skeleton before
  `data.json` resolves, mobile layout, the fixture-data mode, the
  fetch-failure error banner, and the `file://`-protocol trap this whole
  project started from.
- **`test_part1.js`** — the "Needs Status" collapsible section (counts are
  read from the page's own KPIs, not hardcoded, so this doesn't break as
  real papers are added), the per-card "Last updated" field, and the print
  stylesheet.
- **`test_demo_mode.js`** — the inline-editing flow end to end: every field
  type, logging a new submission attempt, refresh-persistence, the
  one-time name prompt, the toast that confirms a save, Reset demo data
  (now a custom confirm modal, not a native `confirm()`), Copy my changes
  as JSON, and the demo banner's visibility/non-blocking behavior, at
  desktop and mobile widths.
- **`test_create_delete.js`** — adding a project via "+ New Project" (ID
  generation, required-title validation, the "New (not yet shared)" flag,
  a toast confirming creation, refresh-persistence), deleting it outright
  vs. deleting a real data.json-sourced paper (hidden only — asserts the
  raw data.json file is untouched, and that a toast says so), the delete
  confirmation step (and that Cancel really cancels), Reset demo data
  restoring a hidden real paper, and that Copy my changes as JSON includes
  both an added paper and a deleted id.
- **`test_discover.js`** — the public Project Discovery page: only
  `openToNewMembers` papers appear, weighted keyword matching/sorting
  responds to what's typed (tag/skill hits outrank incidental abstract
  hits; confirms a short technical token like "AI" no longer false-matches
  inside an unrelated word like "cl-ai-ms"), the no-match and
  all-stopword-query messaging, the loading skeleton before
  `data.public.json` resolves, the "I'm interested" mailto link is
  correct, mobile layout, and — the other half of the security guarantee
  alongside the allowlist test — that the page makes zero network requests
  to `data.json`, ever.
