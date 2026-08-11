// Pure logic for merging an inline-edit request into a paper object — no
// network/KV/git I/O here, so it's directly unit-testable. Mirrors the
// field-merging rules in scripts/apply_update.py's main(), adapted from
// parsed Issue-Form markdown fields to a structured JSON request body
// (the browser sends real JSON now, so there's no markdown to parse).
import { deriveStatus } from "./status_logic.js";

function validIsoDate(s) {
  if (!s || typeof s !== "string") return false;
  const d = new Date(s.slice(0, 10) + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(s);
}

/**
 * @param paper   The paper object from data.json (mutated in place AND returned).
 * @param req     { stage?, priority?, owner?, newSubmission?: {venue, submittedDate, decision?, decisionDate?, notes?},
 *                  decisionUpdate?: {decision, decisionDate?, notes?}, notes? }
 * @param email   Verified requester email, for the audit marker.
 * @param now     Date object (injectable for tests).
 * @returns { paper, changes, submissionAdded, warnings } — changes/warnings
 *          are empty when nothing valid was submitted, which the caller
 *          should treat as "nothing to commit."
 */
export function applyChangesToPaper(paper, req, email, now) {
  const changes = {};
  const warnings = [];

  const maybeSet = (key, value) => {
    if (value !== undefined && value !== null && value !== "" && value !== paper[key]) {
      changes[key] = { from: paper[key] ?? null, to: value };
      paper[key] = value;
    }
  };
  maybeSet("stage", req.stage);
  maybeSet("priority", req.priority);
  maybeSet("owner", req.owner);

  let submissionAdded = null;

  if (req.newSubmission && req.newSubmission.venue) {
    const { venue, submittedDate, decision, decisionDate, notes } = req.newSubmission;
    if (!validIsoDate(submittedDate)) {
      warnings.push(
        "New Submission Venue was set but Submitted Date was missing or not in YYYY-MM-DD format, so no new submission attempt was logged."
      );
    } else {
      const nextAttempt = (paper.attempts || 0) + 1;
      const entry = {
        attempt: nextAttempt,
        venue,
        submittedDate,
        responseDeadline: null,
        decision: decision || null,
        decisionDate: validIsoDate(decisionDate) ? decisionDate : null,
        notes: notes || null,
      };
      paper.submissions = paper.submissions || [];
      paper.submissions.push(entry);
      paper.attempts = nextAttempt;
      paper.currentVenue = venue;
      paper.latestDecision = decision || null;
      submissionAdded = entry;
      changes.submissions = { added: entry };
    }
  } else if (req.decisionUpdate && req.decisionUpdate.decision) {
    const { decision, decisionDate, notes } = req.decisionUpdate;
    const subs = paper.submissions || [];
    if (subs.length === 0) {
      warnings.push(
        "A Decision was set but this paper has no logged submissions to apply it to, and no New Submission Venue was given, so the decision was not recorded."
      );
    } else {
      const latest = subs[subs.length - 1];
      latest.decision = decision;
      if (validIsoDate(decisionDate)) latest.decisionDate = decisionDate;
      if (notes) latest.notes = notes;
      paper.latestDecision = decision;
      changes.latestDecision = { to: decision };
    }
  } else if (req.notes) {
    changes.notes = { from: paper.notes ?? null, to: req.notes };
    paper.notes = req.notes;
  }

  if (Object.keys(changes).length === 0) {
    return { paper, changes, submissionAdded: null, warnings };
  }

  const newStatus = deriveStatus(paper.stage, paper.attempts, paper.latestDecision, paper.deadline, paper.publishedDate, now);
  if (newStatus !== paper.status) {
    changes.status = { from: paper.status, to: newStatus };
    paper.status = newStatus;
  }

  const nowIso = now.toISOString();
  paper.lastUpdated = nowIso.slice(0, 10);
  paper.updatedViaEmail = { email, at: nowIso };

  return { paper, changes, submissionAdded, warnings };
}
