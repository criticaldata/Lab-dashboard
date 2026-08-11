#!/usr/bin/env python3
"""Extract the authorized-editor email list from Lab_Papers_Dashboard.xlsx.

This intentionally does NOT write into the repo. The dashboard's repo is
public, and a public, machine-readable list of the lab's real email
addresses is a real (if mild) spam/scraping exposure that the rest of the
Team Directory display doesn't carry. Instead, this writes a *local-only*
file (team-emails.local.json, gitignored) that you paste into a Cloudflare
Worker secret by hand:

    python3 scripts/export_team_emails.py
    cd worker
    wrangler secret put TEAM_EMAILS
    # paste the contents of team-emails.local.json when prompted, Enter, Ctrl+D

Re-run this (and re-run the wrangler command) whenever someone joins or
leaves the lab and the Team Directory sheet's Email column changes — see
README.md's "Worker setup" section for the full one-time setup and this
one-line-command update flow.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from export_data import sheet_rows, TEAM_SHEET, TEAM_HEADER_ROW  # noqa: E402

try:
    import openpyxl
except ImportError:
    sys.exit("Missing dependency: run `pip install openpyxl` first.")

OUT_PATH = "team-emails.local.json"


def main():
    xlsx_path = sys.argv[1] if len(sys.argv) > 1 else "Lab_Papers_Dashboard.xlsx"
    wb = openpyxl.load_workbook(xlsx_path, data_only=True)

    emails = []
    skipped_no_email = []
    for row in sheet_rows(wb[TEAM_SHEET], TEAM_HEADER_ROW):
        name = row.get("Name")
        if not name or not row.get("Role"):
            continue
        email = row.get("Email")
        if email:
            emails.append(email.strip().lower())
        else:
            skipped_no_email.append(name)

    emails = sorted(set(emails))

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(emails, f, indent=2)
        f.write("\n")

    print(f"Wrote {OUT_PATH}: {len(emails)} email(s) — this file is gitignored, never commit it.")
    if skipped_no_email:
        print("Team members with no Email set in the spreadsheet (won't be able to edit inline):")
        for name in skipped_no_email:
            print(f"  - {name}")
    print("\nNext step:")
    print("  cd worker && wrangler secret put TEAM_EMAILS")
    print(f"  (paste the contents of {OUT_PATH} when prompted)")


if __name__ == "__main__":
    main()
