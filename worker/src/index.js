// Lab Ledger inline-edit Worker.
//
// Three endpoints, all POST, all CORS-locked to env.ALLOWED_ORIGIN:
//   /request-code  { email }                -> always a generic "sent if valid" response
//   /verify-code   { email, code }          -> { token } on success
//   /apply-update  { token, paperId, ... }  -> applies the edit, commits, returns a summary
//
// Security invariants (see README.md's "Security notes" for the full
// writeup) — every one of these is exercised by worker/test/run.js:
//   - /request-code NEVER reveals whether an email is on the authorized
//     list: identical response body/status whether it is, isn't, or the
//     caller is rate-limited. Only whether an email actually gets sent
//     differs, and that's invisible to the client.
//   - The authorized-email list (env.TEAM_EMAILS) lives only as a Worker
//     secret — never in the repo, never sent to the browser.
//   - /apply-update re-checks the JWT's email against the authorized list
//     on every call — a session token from someone since removed from the
//     roster stops working immediately, it isn't trusted for its full
//     2-hour lifetime regardless.
//   - GITHUB_COMMIT_TOKEN, RESEND_API_KEY, and JWT_SECRET are Worker
//     secrets only; none of them are ever included in a response.
import { checkAndIncrement } from "./ratelimit.js";
import { sendVerificationCode } from "./email.js";
import { signJwt, verifyJwt } from "./jwt.js";
import { getJsonFile, putJsonFile } from "./github.js";
import { applyChangesToPaper } from "./apply_changes.js";

const CODE_TTL_SECONDS = 600; // 10 minutes
const MAX_CODE_ATTEMPTS = 5;
const SESSION_TTL_SECONDS = 2 * 60 * 60; // 2 hours
const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_SECONDS = 15 * 60;

function json(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  if (origin && origin === env.ALLOWED_ORIGIN) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      Vary: "Origin",
    };
  }
  return {};
}

function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function authorizedEmails(env) {
  try {
    const list = JSON.parse(env.TEAM_EMAILS || "[]");
    return new Set(list.map((e) => String(e).trim().toLowerCase()));
  } catch {
    return new Set();
  }
}

function generateCode() {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const n = new DataView(bytes.buffer).getUint32(0) % 1000000;
  return String(n).padStart(6, "0");
}

async function handleRequestCode(request, env) {
  const body = await request.json().catch(() => ({}));
  const email = normalizeEmail(body.email);
  const generic = { ok: true, message: "If that's a recognized lab email, a verification code has been sent." };

  if (!email || !email.includes("@")) return json(200, generic);

  // Always consume rate-limit budget, whether or not the email is on the
  // list — an attacker probing arbitrary addresses should see identical
  // behavior to a real member who's just being rate-limited.
  const underLimit = await checkAndIncrement(env.CODES, email, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_SECONDS);
  if (!underLimit) return json(200, generic);

  const allowed = authorizedEmails(env);
  if (!allowed.has(email)) return json(200, generic);

  const code = generateCode();
  const expiresAt = Date.now() + CODE_TTL_SECONDS * 1000;
  await env.CODES.put(`code:${email}`, JSON.stringify({ code, attempts: 0, expiresAt }), {
    expirationTtl: CODE_TTL_SECONDS,
  });

  try {
    await sendVerificationCode(env, email, code);
  } catch (err) {
    // Deliberately swallowed: surfacing "email send failed" to the client
    // would tell a prober "that address exists but delivery broke," which
    // still leaks list membership. Logged for the Worker operator instead.
    console.error("sendVerificationCode failed:", err);
  }

  return json(200, generic);
}

async function handleVerifyCode(request, env) {
  const body = await request.json().catch(() => ({}));
  const email = normalizeEmail(body.email);
  const submittedCode = typeof body.code === "string" ? body.code.trim() : "";
  const invalid = { ok: false, error: "That code is invalid or has expired. Request a new one." };

  if (!email || !submittedCode) return json(400, invalid);

  const key = `code:${email}`;
  const raw = await env.CODES.get(key);
  if (!raw) return json(400, invalid);

  let entry;
  try {
    entry = JSON.parse(raw);
  } catch {
    await env.CODES.delete(key);
    return json(400, invalid);
  }

  if (Date.now() >= entry.expiresAt) {
    await env.CODES.delete(key);
    return json(400, invalid);
  }

  if (submittedCode !== entry.code) {
    entry.attempts = (entry.attempts || 0) + 1;
    if (entry.attempts >= MAX_CODE_ATTEMPTS) {
      await env.CODES.delete(key);
    } else {
      const remainingTtl = Math.max(1, Math.floor((entry.expiresAt - Date.now()) / 1000));
      await env.CODES.put(key, JSON.stringify(entry), { expirationTtl: remainingTtl });
    }
    return json(400, invalid);
  }

  // One-time use: burn the code immediately on success.
  await env.CODES.delete(key);

  const allowed = authorizedEmails(env);
  if (!allowed.has(email)) return json(400, invalid);

  const now = Math.floor(Date.now() / 1000);
  const token = await signJwt({ email, iat: now, exp: now + SESSION_TTL_SECONDS }, env.JWT_SECRET);
  return json(200, { ok: true, token, expiresIn: SESSION_TTL_SECONDS });
}

async function handleApplyUpdate(request, env) {
  const body = await request.json().catch(() => ({}));
  const payload = await verifyJwt(body.token, env.JWT_SECRET);
  if (!payload) {
    return json(401, { ok: false, error: "Your session expired or is invalid — please verify your email again." });
  }

  // Don't trust a 2-hour-old token forever: re-confirm the email is still
  // on the roster on every single apply, not just at verify-code time.
  const allowed = authorizedEmails(env);
  if (!allowed.has(payload.email)) {
    return json(403, { ok: false, error: "This email is no longer a recognized lab member. No changes were applied." });
  }

  const paperId = body.paperId;
  if (!paperId) return json(400, { ok: false, error: "Missing paperId." });

  let data, sha;
  try {
    ({ content: data, sha } = await getJsonFile(env.GITHUB_REPO, "data.json", env.GITHUB_COMMIT_TOKEN, env.GITHUB_BRANCH));
  } catch (err) {
    console.error("Failed to read data.json:", err);
    return json(502, { ok: false, error: "Couldn't reach the dashboard's data right now. Please try again shortly." });
  }

  const paper = (data.papers || []).find((p) => p.id === paperId);
  if (!paper) return json(404, { ok: false, error: "Couldn't find that paper — try refreshing the page." });

  const { changes, submissionAdded, warnings } = applyChangesToPaper(paper, body, payload.email, new Date());
  if (Object.keys(changes).length === 0) {
    return json(400, { ok: false, error: "Nothing to update — every field was empty or unchanged.", warnings });
  }

  const commitMessage = `Update ${paperId} via inline edit (${payload.email})`;
  const committer = { name: "lab-ledger-bot", email: "actions@users.noreply.github.com" };

  const putResult = await putJsonFile(env.GITHUB_REPO, "data.json", env.GITHUB_COMMIT_TOKEN, env.GITHUB_BRANCH, data, sha, commitMessage, committer);

  if (!putResult.ok) {
    if (putResult.conflict) {
      // This is the race-condition guard the spec asked for: we read
      // data.json's sha immediately above, right before writing, and
      // GitHub itself rejects the write if that sha is no longer current
      // (someone else committed in between) — no client-side "sha when the
      // form opened" bookkeeping needed, and it protects against ANY
      // concurrent writer (another inline edit, the Issue Form pipeline,
      // or a spreadsheet-driven export_data.py push), not just a second
      // inline edit.
      return json(409, { ok: false, conflict: true, error: "Someone else just updated this paper. Please refresh and try again." });
    }
    console.error("GitHub write failed:", putResult.status, putResult.json);
    return json(502, { ok: false, error: "Couldn't save the change right now. Please try again shortly." });
  }

  // Audit log is best-effort: the primary update already succeeded and is
  // reported as such even if this second write hiccups.
  let logWarning = null;
  try {
    const { content: log, sha: logSha } = await getJsonFile(env.GITHUB_REPO, "change-log.json", env.GITHUB_COMMIT_TOKEN, env.GITHUB_BRANCH);
    const entry = {
      timestamp: new Date().toISOString(),
      source: "inline-edit",
      author: payload.email,
      paperId,
      paperTitle: paper.title,
      changes,
      warnings,
    };
    const newLog = Array.isArray(log) ? [...log, entry] : [entry];
    const logPut = await putJsonFile(env.GITHUB_REPO, "change-log.json", env.GITHUB_COMMIT_TOKEN, env.GITHUB_BRANCH, newLog, logSha, `Log update to ${paperId} (${payload.email})`, committer);
    if (!logPut.ok) logWarning = "The change was applied, but logging it to change-log.json failed.";
  } catch (err) {
    console.error("change-log.json update failed:", err);
    logWarning = "The change was applied, but logging it to change-log.json failed.";
  }

  const summary = Object.entries(changes)
    .filter(([k]) => k !== "submissions")
    .map(([k, v]) => ("from" in v ? `${k}: ${v.from ?? "(none)"} → ${v.to}` : `${k}: → ${v.to}`));
  if (submissionAdded) {
    summary.push(`New submission logged: attempt ${submissionAdded.attempt} — ${submissionAdded.venue} (submitted ${submissionAdded.submittedDate})`);
  }

  const allWarnings = [...warnings, ...(logWarning ? [logWarning] : [])];
  return json(200, { ok: true, summary, warnings: allWarnings });
}

const ROUTES = {
  "/request-code": handleRequestCode,
  "/verify-code": handleVerifyCode,
  "/apply-update": handleApplyUpdate,
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const handler = ROUTES[url.pathname];
    if (!handler || request.method !== "POST") {
      return json(404, { ok: false, error: "Not found." }, cors);
    }

    // Reject cross-origin browser requests outright rather than silently
    // omitting CORS headers — a request with an Origin header that isn't
    // our GitHub Pages origin gets a hard 403, not just a response the
    // browser happens to block client-side.
    const origin = request.headers.get("Origin");
    if (origin && origin !== env.ALLOWED_ORIGIN) {
      return json(403, { ok: false, error: "Origin not allowed." });
    }

    try {
      const res = await handler(request, env);
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    } catch (err) {
      console.error(`Unhandled error in ${url.pathname}:`, err);
      return json(500, { ok: false, error: "Something went wrong. Please try again, or contact a maintainer." }, cors);
    }
  },
};
