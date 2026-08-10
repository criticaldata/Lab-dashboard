# Lab Ledger — MIT Critical Data

A single-page dashboard for tracking every paper in the lab — what stage it's
at, which journal/conference it's currently with, and its full submission
history (so a rejection-and-resubmission is visible, not overwritten).

No login, no build step, nothing to install to view it.

## Structure

| File | Purpose |
|---|---|
| `index.html` | The whole site. One file, no framework, no build step. |
| `data.json` | The real data the site reads, generated from the spreadsheet. |
| `data.sample.json` | Fixture data (8 papers) covering every UI state, for local testing. |
| `export_data.py` | Regenerates `data.json` from `Lab_Papers_Dashboard.xlsx`. |
| `Lab_Papers_Dashboard.xlsx` | Source of truth. Papers Tracker + Submissions Log + Team Directory. |
| `assets/mit-critical-data-logo.svg`, `assets/favicon.ico` | Brand assets, pulled from criticaldata.mit.edu. |

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
that paper's `history` array, so a rejection followed by a resubmission is
fully visible on the paper's timeline rather than lost.

## Updating the site after editing the spreadsheet

```bash
python3 export_data.py Lab_Papers_Dashboard.xlsx
git add data.json
git commit -m "Update paper statuses"
git push
```

GitHub Pages redeploys automatically within a minute or two of the push.

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
