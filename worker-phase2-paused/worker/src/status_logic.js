// Ported from scripts/status_logic.py — Cloudflare Workers run pure V8
// JavaScript (no subprocess, no Python runtime available inside a request),
// so "call out to the existing Python" isn't an option here; this is a
// deliberate line-for-line port, not a reimplementation from scratch.
//
// KEEP THIS IN SYNC with scripts/status_logic.py. worker/test/run.js cross-
// validates both against the same fixtures on every offline test run
// specifically to catch drift between the two — if you change the rules in
// one, the test will fail until you change the other too.
//
// Output strings must stay byte-for-byte identical to the Python version's,
// because index.html's badge coloring and "Needs Status" grouping both key
// off substring matches (e.g. `status.indexOf("Overdue")`).

const WAITING_STAGES = new Set(["Idea", "On Hold", "Withdrawn"]);

export const STATUS_PUBLISHED = "⚪ Published";
export const STATUS_COMPLETED = "⚪ Completed";
export const STATUS_CLOSED = "\u{1F534} Closed — resubmit?";
export const STATUS_NEEDS_ATTENTION = "\u{1F7E1} Needs Attention";
export const STATUS_WAITING = "\u{1F7E0} Waiting";
export const STATUS_OVERDUE = "\u{1F534} Overdue";
export const STATUS_REVIEWING = "\u{1F535} Reviewing";
export const STATUS_ON_TRACK = "\u{1F7E2} On Track";
export const STATUS_NEEDS_STATUS = "⚪ Needs Status";

/** Days between `today` and an ISO date string (negative = past). Mirrors
 * status_logic.py's days_left(). */
export function daysLeft(deadlineIso, today) {
  if (!deadlineIso) return null;
  const t = today || new Date();
  const todayUtc = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
  const d = new Date(deadlineIso.slice(0, 10) + "T00:00:00Z");
  const deadlineUtc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((deadlineUtc - todayUtc) / 86400000);
}

/** Recompute the Status badge from raw fields. Mirrors status_logic.py's
 * derive_status() branch-for-branch, including the priority order. */
export function deriveStatus(stage, attempts, latestDecision, deadlineIso, publishedDate, today) {
  if (publishedDate) return STATUS_PUBLISHED;
  if (latestDecision === "Accepted") return STATUS_COMPLETED;
  if (latestDecision === "Rejected") return STATUS_CLOSED;

  const dleft = daysLeft(deadlineIso, today);

  if (latestDecision === "Revise & Resubmit" || (dleft !== null && dleft >= 0 && dleft <= 14)) {
    return STATUS_NEEDS_ATTENTION;
  }

  if (dleft !== null && dleft < 0) return STATUS_OVERDUE;

  if (WAITING_STAGES.has(stage)) return STATUS_WAITING;

  if ((attempts || 0) > 0 || stage === "Internal Review") return STATUS_REVIEWING;

  if (stage === "Drafting") return STATUS_ON_TRACK;

  return STATUS_NEEDS_STATUS;
}
