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

## Push this to github.com/criticaldata/Lab-dashboard

Open this folder in VS Code (Claude Code is already connected there) and ask
it to run:

```bash
cd lab-ledger        # or wherever you unzipped this
git init
git remote add origin https://github.com/criticaldata/Lab-dashboard.git
git add .
git commit -m "Initial Lab Ledger dashboard with MIT Critical Data branding"
git branch -M main
git push -u origin main
```

If the repo already has commits (a README, license, etc.), do this instead
so you don't blow away existing history:

```bash
git clone https://github.com/criticaldata/Lab-dashboard.git
# copy index.html, data.json, export_data.py, assets/, Lab_Papers_Dashboard.xlsx
# into the cloned folder, then:
cd Lab-dashboard
git add .
git commit -m "Add Lab Ledger dashboard with MIT Critical Data branding"
git push
```

Claude Code has your git credentials already — you can just say "push this
to github.com/criticaldata/Lab-dashboard" and let it run the right one of
the two flows above.

## Turn on GitHub Pages (one-time)

Repo → **Settings → Pages** → Source: **Deploy from a branch** → Branch:
`main`, folder `/ (root)` → Save. You'll get a URL like
`https://criticaldata.github.io/Lab-dashboard/`.

### Important: "private repo" ≠ "private website"
Keeping the *repo* private hides your code and spreadsheet from anyone
outside the `criticaldata` GitHub org. It does **not** make the *published
site* private — GitHub Pages URLs are publicly reachable by default even
from a private repo (on GitHub Free/Pro/Team). Three options, roughly in
order of effort:

1. **Do nothing extra.** The URL isn't linked anywhere public. Fine for
   low-sensitivity internal tracking (this data — titles, venues, deadlines —
   isn't sensitive in the way patient data would be).
2. **Add a simple shared-password gate** in `index.html` — ask Claude Code to
   add this if you want it. It's a deterrent, not real security, since the
   page source is visible to anyone with the URL.
3. **Host on Vercel or Netlify instead**, both of which have real
   password-protection on their free tiers — or use GitHub Pages via
   **GitHub Enterprise Cloud**, which supports genuinely private Pages sites.

## Updating the site after editing the spreadsheet

```bash
python3 export_data.py Lab_Papers_Dashboard.xlsx
git add data.json
git commit -m "Update paper statuses"
git push
```

GitHub Pages redeploys automatically within a minute or two. If Claude Code
is open in the repo, you can just say "regenerate data.json from the
spreadsheet and push it."

## About the branding

The logo and colors come directly from MIT Critical Data's own site
(`criticaldata.mit.edu`) — the MIT bar-mark with the cardinal red accent
(`#A31F34`), charcoal wordmark (`#333333`), on a clean white ground. The
rest of the interface (status badges, submission timeline) uses its own
distinct semantic colors — teal for "in review," amber for "needs
attention," green for "accepted" — so those stay readable and don't compete
with the brand red, which is reserved for primary actions and the "overdue"
signal.

## Using this with Claude Code

Since Claude is already connected in VS Code, you can ask it directly to:
- Push this to the repo (commands above)
- Add a person to the Team Directory and re-export
- Add a password gate, or move hosting to Vercel/Netlify
- Add a new field to a card (e.g. show "Final File" link)

Claude Code has your git credentials and terminal already, so it can do the
repo work in one step rather than you copy-pasting commands.
