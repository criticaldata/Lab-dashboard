#!/usr/bin/env python3
"""Regenerate .github/ISSUE_TEMPLATE/update-paper.yml from data.json.

The "Paper" field is a dropdown, and its options have to be the current
list of papers — so this script keeps that list in sync. Run it any time
data.json's paper list changes (new papers added, titles edited). The
"generate-issue-template" GitHub Action also runs it automatically after
every push that touches data.json, so this is a convenience for local use,
not something you strictly have to remember.

Usage: python3 scripts/generate_issue_template.py
"""
import json
import os
import sys

import yaml

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_JSON = os.path.join(REPO_ROOT, "data.json")
TEMPLATE_PATH = os.path.join(REPO_ROOT, ".github", "ISSUE_TEMPLATE", "update-paper.yml")

UNCHANGED = "— leave unchanged —"
MAX_TITLE_LEN = 90


def _str_presenter(dumper, data):
    if "\n" in data:
        return dumper.represent_scalar("tag:yaml.org,2002:str", data, style="|")
    return dumper.represent_scalar("tag:yaml.org,2002:str", data)


def paper_option(p):
    title = p["title"]
    if len(title) > MAX_TITLE_LEN:
        title = title[:MAX_TITLE_LEN].rstrip() + "…"
    # The "ID — " prefix is load-bearing: apply_update.py matches on the ID
    # segment before the first " — ", not the (possibly-truncated) title
    # text, so this must stay in sync with how that script parses it.
    return f"{p['id']} — {title}"


def build_template(data):
    papers = sorted(data.get("papers", []), key=lambda p: p["id"])
    team = sorted({m["name"] for m in data.get("team", []) if m.get("name")})

    paper_options = [paper_option(p) for p in papers]
    owner_options = [UNCHANGED] + team

    body = [
        {
            "type": "markdown",
            "attributes": {
                "value": (
                    "### Request a paper status update\n\n"
                    "Fill in only the fields you're changing — leave the rest on "
                    "\"" + UNCHANGED + "\". This is checked against the "
                    "`criticaldata` lab roster automatically; if you're a "
                    "recognized lab member, the change applies to the dashboard "
                    "within a minute or two and this issue closes itself with a "
                    "summary of what changed."
                )
            },
        },
        {
            "type": "dropdown",
            "id": "paper",
            "attributes": {
                "label": "Paper",
                "description": "Which paper are you updating?",
                "options": paper_options,
            },
            "validations": {"required": True},
        },
        {
            "type": "dropdown",
            "id": "stage",
            "attributes": {
                "label": "Stage",
                "description": (
                    "Only meaningful before a paper has been submitted anywhere "
                    "(Idea / Drafting / Internal Review / On Hold)."
                ),
                "options": [UNCHANGED, "Idea", "Drafting", "Internal Review", "On Hold"],
            },
            "validations": {"required": False},
        },
        {
            "type": "dropdown",
            "id": "priority",
            "attributes": {
                "label": "Priority",
                "options": [UNCHANGED, "High", "Medium", "Low"],
            },
            "validations": {"required": False},
        },
        {
            "type": "dropdown",
            "id": "owner",
            "attributes": {
                "label": "Owner",
                "options": owner_options,
            },
            "validations": {"required": False},
        },
        {
            "type": "input",
            "id": "new_venue",
            "attributes": {
                "label": "New Submission Venue",
                "description": (
                    "Fill this in ONLY if you're logging a brand-new submission "
                    "attempt (just sent it to a new journal/conference). Leave "
                    "blank if you're only updating the decision on the paper's "
                    "current venue."
                ),
                "placeholder": "e.g. Nature Medicine",
            },
            "validations": {"required": False},
        },
        {
            "type": "input",
            "id": "submitted_date",
            "attributes": {
                "label": "Submitted Date",
                "description": "Required if you filled in New Submission Venue. Format: YYYY-MM-DD.",
                "placeholder": "2026-08-11",
            },
            "validations": {"required": False},
        },
        {
            "type": "dropdown",
            "id": "decision",
            "attributes": {
                "label": "Decision",
                "description": (
                    "Did you hear back? Applies to New Submission Venue above if "
                    "you filled it in — otherwise applies to the paper's current venue."
                ),
                "options": [
                    UNCHANGED,
                    "Under Review",
                    "Revise & Resubmit",
                    "Accepted",
                    "Rejected",
                    "Withdrawn",
                ],
            },
            "validations": {"required": False},
        },
        {
            "type": "input",
            "id": "decision_date",
            "attributes": {
                "label": "Decision Date",
                "description": "Format: YYYY-MM-DD. Leave blank if there's no decision yet.",
                "placeholder": "2026-08-11",
            },
            "validations": {"required": False},
        },
        {
            "type": "textarea",
            "id": "notes",
            "attributes": {
                "label": "Notes",
                "description": (
                    "Attached to the submission above if you're logging a new one "
                    "or recording a decision; otherwise saved as a general note on "
                    "the paper."
                ),
            },
            "validations": {"required": False},
        },
    ]

    return {
        "name": "Update a paper's status",
        "description": "Request a change to a paper's stage, priority, owner, or log a new submission attempt.",
        "title": "[Update] ",
        "labels": ["update-request"],
        "body": body,
    }


def main():
    if not os.path.exists(DATA_JSON):
        sys.exit(f"Missing {DATA_JSON} — run export_data.py first.")

    with open(DATA_JSON, encoding="utf-8") as f:
        data = json.load(f)

    template = build_template(data)

    os.makedirs(os.path.dirname(TEMPLATE_PATH), exist_ok=True)

    yaml.add_representer(str, _str_presenter)
    header = (
        "# AUTO-GENERATED by scripts/generate_issue_template.py — do not hand-edit.\n"
        "# Regenerate with: python3 scripts/generate_issue_template.py\n"
        "# (Also regenerated automatically by the generate-issue-template Action\n"
        "# whenever data.json changes on main.)\n"
    )
    with open(TEMPLATE_PATH, "w", encoding="utf-8", newline="\n") as f:
        f.write(header)
        yaml.dump(template, f, allow_unicode=True, sort_keys=False, default_flow_style=False, width=1000)

    print(f"Wrote {TEMPLATE_PATH} with {len(data.get('papers', []))} paper options.")


if __name__ == "__main__":
    main()
