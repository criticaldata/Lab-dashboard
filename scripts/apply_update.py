#!/usr/bin/env python3
"""Apply a lab member's "update-request" issue to data.json.

Run by .github/workflows/update-request.yml whenever an issue is opened
with the "update-request" label (which the Issue Form in
.github/ISSUE_TEMPLATE/update-paper.yml applies automatically).

Security model — read this before changing anything below:
  - Org membership is checked HERE, server-side, inside the Action, using a
    dedicated fine-grained PAT (`ORG_READ_PAT`) that has read-only access to
    org membership and nothing else. The issue author's claim of being a
    lab member is never trusted — only this API call decides.
  - The PAT is read from an environment variable (a GitHub Actions secret)
    and is never logged, echoed, or written to any file.
  - Non-members get a polite rejection comment and the issue is closed
    without touching data.json, change-log.json, or git history.
  - The commit to main uses the default GITHUB_TOKEN (already scoped to
    just this repo by GitHub), not the org PAT — the org PAT is never used
    for anything other than the membership GET request.

Exit codes: 0 for every handled outcome (member update applied, non-member
rejected, malformed request rejected). Non-zero only when something
unexpected happened (e.g. the membership check itself couldn't be
completed) — that's meant to make the Action run show as failed so a human
notices, since in that case the issue is deliberately left open rather than
guessed at either way.
"""
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from status_logic import derive_status  # noqa: E402

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_JSON = os.path.join(REPO_ROOT, "data.json")
CHANGE_LOG = os.path.join(REPO_ROOT, "change-log.json")
UNCHANGED = "— leave unchanged —"
API = "https://api.github.com"


def api_request(url, token, method="GET", body=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    req.add_header("User-Agent", "lab-ledger-update-bot")
    if body is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            parsed = json.loads(raw) if raw else None
        except json.JSONDecodeError:
            parsed = None
        return e.code, parsed


def is_org_member(org, username, org_pat):
    status, _ = api_request(f"{API}/orgs/{org}/members/{username}", org_pat)
    if status == 204:
        return True
    if status == 404:
        return False
    return None  # ambiguous — do not guess


def post_comment(repo, issue_number, token, body):
    api_request(f"{API}/repos/{repo}/issues/{issue_number}/comments", token,
                method="POST", body={"body": body})


def close_issue(repo, issue_number, token, reason):
    api_request(f"{API}/repos/{repo}/issues/{issue_number}", token,
                method="PATCH", body={"state": "closed", "state_reason": reason})


def parse_issue_body(body):
    """Issue Forms render each field as '### Label\\n\\nvalue\\n\\n'."""
    fields = {}
    for part in re.split(r"\n### ", "\n" + body.strip()):
        part = part.strip()
        if not part:
            continue
        label, _, value = part.partition("\n")
        value = value.strip()
        if value == "_No response_":
            value = ""
        fields[label.strip()] = value
    return fields


def extract_paper_id(paper_field_value):
    m = re.match(r"\s*(P\d+)\s*—", paper_field_value)
    return m.group(1) if m else None


def git(*args):
    subprocess.run(["git", *args], cwd=REPO_ROOT, check=True)


def main():
    org = os.environ.get("LAB_ORG", "criticaldata")
    repo = os.environ["GITHUB_REPOSITORY"]
    issue_number = os.environ["ISSUE_NUMBER"]
    issue_author = os.environ["ISSUE_AUTHOR"]
    issue_body = os.environ.get("ISSUE_BODY", "")
    issue_url = f"https://github.com/{repo}/issues/{issue_number}"
    github_token = os.environ["GITHUB_TOKEN"]
    org_pat = os.environ["ORG_READ_PAT"]

    member = is_org_member(org, issue_author, org_pat)

    if member is None:
        post_comment(repo, issue_number, github_token,
            f"⚠️ Couldn't verify @{issue_author}'s membership in `{org}` right now "
            "(the GitHub API call itself failed or returned an unexpected response). "
            "No changes were applied. Leaving this open for a maintainer to check "
            "manually — this is not a rejection.")
        print("Membership check was ambiguous; left issue open. Failing the run for visibility.")
        sys.exit(1)

    if not member:
        post_comment(repo, issue_number, github_token,
            f"Thanks for the update request! I couldn't apply this automatically "
            f"because @{issue_author} isn't currently listed as a member of the "
            f"`{org}` GitHub org, so I can't verify this is a lab member submitting "
            "it. If you *are* part of the lab, ask whoever manages the GitHub org "
            "to add you, then resubmit this form. No changes were made.")
        close_issue(repo, issue_number, github_token, "not_planned")
        print(f"{issue_author} is not an org member. Rejected, no changes applied.")
        return

    fields = parse_issue_body(issue_body)
    warnings = []

    paper_value = fields.get("Paper", "")
    paper_id = extract_paper_id(paper_value)
    if not paper_id:
        post_comment(repo, issue_number, github_token,
            "Couldn't tell which paper this was for — the Paper field didn't match "
            "the expected `P### — Title` format. No changes were applied. Please "
            "open a new request and pick a paper from the dropdown.")
        close_issue(repo, issue_number, github_token, "not_planned")
        return

    with open(DATA_JSON, encoding="utf-8") as f:
        data = json.load(f)

    paper = next((p for p in data["papers"] if p["id"] == paper_id), None)
    if paper is None:
        post_comment(repo, issue_number, github_token,
            f"Couldn't find paper `{paper_id}` in data.json — it may have been "
            "removed or renumbered since this form was generated. No changes were "
            "applied. Please open a new request from a fresh copy of the form.")
        close_issue(repo, issue_number, github_token, "not_planned")
        return

    changes = {}

    def maybe_set(field_label, key):
        val = fields.get(field_label, "")
        if val and val != UNCHANGED and val != paper.get(key):
            changes[key] = {"from": paper.get(key), "to": val}
            paper[key] = val

    maybe_set("Stage", "stage")
    maybe_set("Priority", "priority")
    maybe_set("Owner", "owner")

    new_venue = fields.get("New Submission Venue", "")
    submitted_date = fields.get("Submitted Date", "")
    decision = fields.get("Decision", "")
    decision = "" if decision == UNCHANGED else decision
    decision_date = fields.get("Decision Date", "")
    notes = fields.get("Notes", "")

    submission_added = None

    def valid_iso_date(s):
        try:
            date.fromisoformat(s[:10])
            return True
        except (ValueError, TypeError):
            return False

    if new_venue:
        if not valid_iso_date(submitted_date):
            warnings.append(
                "New Submission Venue was set but Submitted Date was missing or "
                "not in YYYY-MM-DD format, so no new submission attempt was logged."
            )
        else:
            next_attempt = (paper.get("attempts") or 0) + 1
            entry = {
                "attempt": next_attempt,
                "venue": new_venue,
                "submittedDate": submitted_date,
                "responseDeadline": None,
                "decision": decision or None,
                "decisionDate": decision_date if valid_iso_date(decision_date) else None,
                "notes": notes or None,
            }
            paper.setdefault("submissions", []).append(entry)
            paper["attempts"] = next_attempt
            paper["currentVenue"] = new_venue
            paper["latestDecision"] = decision or None
            submission_added = entry
            changes["submissions"] = {"added": entry}
    elif decision:
        subs = paper.get("submissions") or []
        if not subs:
            warnings.append(
                "A Decision was set but this paper has no logged submissions to "
                "apply it to, and no New Submission Venue was given, so the "
                "decision was not recorded."
            )
        else:
            latest = subs[-1]
            latest["decision"] = decision
            if valid_iso_date(decision_date):
                latest["decisionDate"] = decision_date
            if notes:
                latest["notes"] = notes
            paper["latestDecision"] = decision
            changes["latestDecision"] = {"to": decision}
    elif notes:
        changes["notes"] = {"from": paper.get("notes"), "to": notes}
        paper["notes"] = notes

    if not changes:
        post_comment(repo, issue_number, github_token,
            "Nothing to apply — every field was left on \"" + UNCHANGED + "\" or blank. "
            "No changes were made. " + (" ".join(warnings) if warnings else ""))
        close_issue(repo, issue_number, github_token, "not_planned")
        return

    new_status = derive_status(
        paper.get("stage"), paper.get("attempts"),
        paper.get("latestDecision"), paper.get("deadline"), paper.get("publishedDate"),
    )
    if new_status != paper.get("status"):
        changes["status"] = {"from": paper.get("status"), "to": new_status}
        paper["status"] = new_status

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    paper["lastUpdated"] = now[:10]
    paper["updatedViaIssue"] = {"issueNumber": int(issue_number), "at": now}

    with open(DATA_JSON, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")

    log_entry = {
        "timestamp": now,
        "issueNumber": int(issue_number),
        "issueUrl": issue_url,
        "author": issue_author,
        "paperId": paper_id,
        "paperTitle": paper["title"],
        "changes": changes,
        "warnings": warnings,
    }
    change_log = []
    if os.path.exists(CHANGE_LOG):
        with open(CHANGE_LOG, encoding="utf-8") as f:
            change_log = json.load(f)
    change_log.append(log_entry)
    with open(CHANGE_LOG, "w", encoding="utf-8") as f:
        json.dump(change_log, f, ensure_ascii=False, indent=2)
        f.write("\n")

    summary_lines = [f"- **{k}**: {v.get('from')!r} → {v.get('to')!r}" if "from" in v else f"- **{k}**: → {v.get('to')!r}"
                      for k, v in changes.items() if k != "submissions"]
    if submission_added:
        summary_lines.append(
            f"- **New submission logged**: attempt {submission_added['attempt']} — "
            f"{submission_added['venue']} (submitted {submission_added['submittedDate']})"
        )

    git("config", "user.name", "lab-ledger-bot")
    git("config", "user.email", "actions@users.noreply.github.com")
    git("add", "data.json", "change-log.json")
    git("commit", "-m", f"Update {paper_id} via #{issue_number}\n\n" + "\n".join(summary_lines))
    git("push")

    comment = (
        f"✅ Applied to **{paper['title']}**:\n\n" + "\n".join(summary_lines) +
        "\n\nThanks for keeping the tracker current!"
    )
    if warnings:
        comment += "\n\n**Note:** " + " ".join(warnings)
    post_comment(repo, issue_number, github_token, comment)
    close_issue(repo, issue_number, github_token, "completed")
    print(f"Applied update to {paper_id} from issue #{issue_number}.")


if __name__ == "__main__":
    main()
