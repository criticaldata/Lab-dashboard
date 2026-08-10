# Lab Ledger — MIT Critical Data

A single-page dashboard for tracking every paper in the lab — what stage it's
at, which journal/conference it's currently with, and its full submission
history (so a rejection-and-resubmission is visible, not overwritten).

No login, no build step, nothing to install to view it.

## What's in here

- **`index.html`** — the whole site. One file, no framework, no build step.
- **`data.json`** — the data the site reads. Regenerated from the spreadsheet.
- **`export_data.py`** — regenerates `data.json` from the Excel tracker.
- **`assets/mit-critical-data-logo.svg`** — the real MIT Critical Data logo
  (pulled from the lab's own site source), used in the header.
- **`assets/favicon.ico`** — matching browser-tab icon.
- **`Lab_Papers_Dashboard.xlsx`** — the source-of-truth spreadsheet (Papers
  Tracker + Submissions Log + Team Directory). This stays the place where
  people *enter* data; the website is where people *read* it.
