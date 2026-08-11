"""Shared status-badge derivation logic.

Mirrors the auto-calculated Status column in Lab_Papers_Dashboard.xlsx (see
the workbook's "Legend & Color Key" sheet for the source rules).
export_data.py does NOT use this — it reads the spreadsheet's own
precomputed Status text directly, since Excel already ran the formula.

This module exists for updates applied via the GitHub Issue Form / Action
pipeline (apply_update.py), where there is no spreadsheet formula to
consult, so the badge has to be computed from the raw Stage / Attempts /
Decision / Deadline / Published fields instead. The output strings must
stay byte-for-byte identical to the ones the spreadsheet produces, because
index.html's badge coloring and the "Needs Status" grouping both key off
substring matches (e.g. `status.indexOf("Overdue")`).
"""
from datetime import date

WAITING_STAGES = {"Idea", "On Hold", "Withdrawn"}

STATUS_PUBLISHED = "⚪ Published"
STATUS_COMPLETED = "⚪ Completed"
STATUS_CLOSED = "\U0001F534 Closed — resubmit?"
STATUS_NEEDS_ATTENTION = "\U0001F7E1 Needs Attention"
STATUS_WAITING = "\U0001F7E0 Waiting"
STATUS_OVERDUE = "\U0001F534 Overdue"
STATUS_REVIEWING = "\U0001F535 Reviewing"
STATUS_ON_TRACK = "\U0001F7E2 On Track"
STATUS_NEEDS_STATUS = "⚪ Needs Status"


def days_left(deadline_iso, today=None):
    """Days between `today` and an ISO date string (negative = past)."""
    if not deadline_iso:
        return None
    today = today or date.today()
    d = date.fromisoformat(deadline_iso[:10])
    return (d - today).days


def derive_status(stage, attempts, latest_decision, deadline_iso, published_date, today=None):
    """Recompute the Status badge from raw fields, per the workbook's rules.

    Order matters — these branches mirror the priority a human reading the
    Legend sheet top-to-bottom would apply (most-resolved state first).
    """
    if published_date:
        return STATUS_PUBLISHED
    if latest_decision == "Accepted":
        return STATUS_COMPLETED
    if latest_decision == "Rejected":
        return STATUS_CLOSED

    dleft = days_left(deadline_iso, today)

    if latest_decision == "Revise & Resubmit" or (dleft is not None and 0 <= dleft <= 14):
        return STATUS_NEEDS_ATTENTION

    if dleft is not None and dleft < 0:
        return STATUS_OVERDUE

    if stage in WAITING_STAGES:
        return STATUS_WAITING

    if (attempts or 0) > 0 or stage == "Internal Review":
        return STATUS_REVIEWING

    if stage == "Drafting":
        return STATUS_ON_TRACK

    return STATUS_NEEDS_STATUS
