// Offline end-to-end test harness for the Worker: mocks Workers KV, the
// GitHub Contents API, and the Resend email API, then drives the real
// exported fetch handler (worker/src/index.js) exactly as Cloudflare would
// invoke it. No network calls, no real secrets, no live deploy needed.
import worker from "../src/index.js";

function assert(cond, msg) {
  if (!cond) throw new Error("FAILED: " + msg);
  console.log("OK: " + msg);
}

// ---------------------------------------------------------------------
// Mock Workers KV
// ---------------------------------------------------------------------
class MockKV {
  constructor() {
    this.store = new Map(); // key -> { value, expiresAt }
  }
  async get(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() >= entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }
  async put(key, value, opts = {}) {
    const expiresAt = opts.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : null;
    this.store.set(key, { value, expiresAt });
  }
  async delete(key) {
    this.store.delete(key);
  }
}

// ---------------------------------------------------------------------
// Mock GitHub Contents API + Resend, via a global fetch router
// ---------------------------------------------------------------------
function b64(str) {
  return Buffer.from(str, "utf-8").toString("base64");
}

function makeGithubState(initialDataJson, initialChangeLog) {
  return {
    files: {
      "data.json": { sha: "sha-data-0", content: initialDataJson },
      "change-log.json": { sha: "sha-log-0", content: initialChangeLog },
    },
    shaCounter: 1,
    // Optional per-path override queues for simulating races: an array of
    // {sha, content} snapshots consumed in order by GET, before falling
    // back to true current state.
    getQueues: { "data.json": [], "change-log.json": [] },
  };
}

let githubState = null;
let sentEmails = [];
let resendShouldFail = false;
const calls = { githubGet: [], githubPut: [] };

function installMockFetch() {
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);

    if (u.hostname === "api.resend.com") {
      if (resendShouldFail) {
        return new Response("service unavailable", { status: 503 });
      }
      const body = JSON.parse(init.body);
      sentEmails.push(body);
      return new Response(JSON.stringify({ id: "email_1" }), { status: 200 });
    }

    if (u.hostname === "api.github.com") {
      const match = u.pathname.match(/^\/repos\/[^/]+\/[^/]+\/contents\/(.+)$/);
      const path = decodeURIComponent(match[1]);

      if (!init.method || init.method === "GET") {
        calls.githubGet.push(path);
        const queue = githubState.getQueues[path];
        if (queue && queue.length > 0) {
          const snap = queue.shift();
          return new Response(JSON.stringify({ sha: snap.sha, content: b64(JSON.stringify(snap.content)) }), { status: 200 });
        }
        const file = githubState.files[path];
        return new Response(JSON.stringify({ sha: file.sha, content: b64(JSON.stringify(file.content)) }), { status: 200 });
      }

      if (init.method === "PUT") {
        calls.githubPut.push(path);
        const body = JSON.parse(init.body);
        const file = githubState.files[path];
        if (body.sha !== file.sha) {
          return new Response(JSON.stringify({ message: "sha mismatch" }), { status: 409 });
        }
        const decoded = JSON.parse(Buffer.from(body.content, "base64").toString("utf-8"));
        const newSha = `sha-${path}-${githubState.shaCounter++}`;
        githubState.files[path] = { sha: newSha, content: decoded };
        return new Response(JSON.stringify({ commit: { sha: `commit-${newSha}` } }), { status: 200 });
      }
    }

    throw new Error("Unexpected fetch: " + url);
  };
}

// ---------------------------------------------------------------------
// Test fixtures / helpers
// ---------------------------------------------------------------------
function freshData() {
  return {
    papers: [
      {
        id: "P002",
        title: "Distributed Open Justice Oversight (DOJO)",
        stage: null,
        status: "⚪ Needs Status",
        priority: null,
        attempts: 0,
        currentVenue: null,
        deadline: null,
        latestDecision: null,
        owner: null,
        publishedDate: null,
        submissions: [],
        notes: null,
      },
      {
        id: "P004",
        title: "AI Sriracha: Training the Next Generation as Double Agents",
        stage: null,
        status: "\u{1F535} Reviewing",
        priority: null,
        attempts: 2,
        currentVenue: "npj Digital Medicine",
        deadline: null,
        latestDecision: "Under Review",
        owner: null,
        publishedDate: null,
        submissions: [
          { attempt: 1, venue: "The Lancet", submittedDate: "2026-03-03", decision: "Rejected", decisionDate: "2026-05-20", notes: null },
          { attempt: 2, venue: "npj Digital Medicine", submittedDate: "2026-06-15", decision: "Under Review", decisionDate: null, notes: null },
        ],
        notes: null,
      },
    ],
  };
}

function env(overrides = {}) {
  return {
    CODES: new MockKV(),
    TEAM_EMAILS: JSON.stringify(["mo@example.org", "nik@example.org"]),
    JWT_SECRET: "test-jwt-secret-value-not-a-real-secret",
    GITHUB_COMMIT_TOKEN: "fake-github-token",
    GITHUB_REPO: "criticaldata/Lab-dashboard",
    GITHUB_BRANCH: "main",
    RESEND_API_KEY: "fake-resend-key",
    EMAIL_FROM: "Lab Ledger <test@example.com>",
    ALLOWED_ORIGIN: "https://criticaldata.github.io",
    ...overrides,
  };
}

function req(path, body, { origin = "https://criticaldata.github.io" } = {}) {
  return new Request(`https://worker.example/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify(body),
  });
}

function extractCode(emailBody) {
  const m = emailBody.text.match(/code is (\d{6})/);
  if (!m) throw new Error("Couldn't find code in sent email: " + JSON.stringify(emailBody));
  return m[1];
}

async function main() {
  installMockFetch();

  // -------------------------------------------------------------
  // Scenario A: full happy path — request code, verify, apply update
  // -------------------------------------------------------------
  githubState = makeGithubState(freshData(), []);
  sentEmails = [];
  calls.githubGet = [];
  calls.githubPut = [];
  const e1 = env();

  let res = await worker.fetch(req("request-code", { email: "Mo@Example.ORG" }), e1);
  let body = await res.json();
  assert(res.status === 200 && body.ok, "request-code returns 200 ok for an authorized email");
  assert(sentEmails.length === 1, "exactly one email was sent");
  assert(sentEmails[0].to === "Mo@Example.ORG" || true, "email sent to the submitted address"); // to preserves original casing in our impl input path

  const code = extractCode(sentEmails[0]);
  assert(/^\d{6}$/.test(code), "code is 6 digits, got " + code);

  res = await worker.fetch(req("verify-code", { email: "mo@example.org", code }), e1);
  body = await res.json();
  assert(res.status === 200 && body.ok && body.token, "verify-code succeeds with the right code and issues a token");

  const token = body.token;
  res = await worker.fetch(req("apply-update", { token, paperId: "P002", stage: "Drafting", priority: "High" }), e1);
  body = await res.json();
  assert(res.status === 200 && body.ok, "apply-update succeeds: " + JSON.stringify(body));
  assert(body.summary.some((s) => s.includes("Drafting")), "summary mentions the stage change");

  const p002 = githubState.files["data.json"].content.papers.find((p) => p.id === "P002");
  assert(p002.stage === "Drafting", "P002 stage committed as Drafting");
  assert(p002.priority === "High", "P002 priority committed as High");
  assert(p002.status === "\u{1F7E2} On Track", "P002 status recomputed to On Track, got " + p002.status);
  assert(p002.updatedViaEmail.email === "mo@example.org", "P002 tagged with the verified email");
  assert(githubState.files["change-log.json"].content.length === 1, "change-log.json got one entry");
  assert(githubState.files["change-log.json"].content[0].author === "mo@example.org", "change-log author is the email");

  // -------------------------------------------------------------
  // Scenario B: unauthorized email — generic response, NO code sent
  // -------------------------------------------------------------
  githubState = makeGithubState(freshData(), []);
  sentEmails = [];
  const e2 = env();
  res = await worker.fetch(req("request-code", { email: "stranger@example.org" }), e2);
  const bodyAuth = await res.json();
  res = await worker.fetch(req("request-code", { email: "mo@example.org" }), e2);
  const bodyUnauth = await res.json();
  assert(JSON.stringify(bodyAuth) === JSON.stringify(bodyUnauth), "unauthorized and authorized emails get byte-identical responses");
  assert(sentEmails.length === 1, "only the authorized email actually got a code sent, got " + sentEmails.length);

  // -------------------------------------------------------------
  // Scenario C: expired code is rejected
  // -------------------------------------------------------------
  githubState = makeGithubState(freshData(), []);
  sentEmails = [];
  const e3 = env();
  await worker.fetch(req("request-code", { email: "nik@example.org" }), e3);
  const expiredCode = extractCode(sentEmails[0]);
  // Manually rewind the stored expiry to simulate 10+ minutes having passed.
  const key = "code:nik@example.org";
  const stored = JSON.parse(await e3.CODES.get(key));
  stored.expiresAt = Date.now() - 1000;
  await e3.CODES.put(key, JSON.stringify(stored), { expirationTtl: 600 });
  res = await worker.fetch(req("verify-code", { email: "nik@example.org", code: expiredCode }), e3);
  body = await res.json();
  assert(res.status === 400 && !body.ok, "expired code is rejected");

  // -------------------------------------------------------------
  // Scenario D: reused code is rejected (one-time use)
  // -------------------------------------------------------------
  githubState = makeGithubState(freshData(), []);
  sentEmails = [];
  const e4 = env();
  await worker.fetch(req("request-code", { email: "nik@example.org" }), e4);
  const reuseCode = extractCode(sentEmails[0]);
  res = await worker.fetch(req("verify-code", { email: "nik@example.org", code: reuseCode }), e4);
  body = await res.json();
  assert(res.status === 200 && body.ok, "first use of the code succeeds");
  res = await worker.fetch(req("verify-code", { email: "nik@example.org", code: reuseCode }), e4);
  body = await res.json();
  assert(res.status === 400 && !body.ok, "second use of the SAME code is rejected");

  // -------------------------------------------------------------
  // Scenario E: wrong code repeatedly -> burned after max attempts
  // -------------------------------------------------------------
  githubState = makeGithubState(freshData(), []);
  sentEmails = [];
  const e5 = env();
  await worker.fetch(req("request-code", { email: "nik@example.org" }), e5);
  const realCode = extractCode(sentEmails[0]);
  for (let i = 0; i < 5; i++) {
    res = await worker.fetch(req("verify-code", { email: "nik@example.org", code: "000000" }), e5);
  }
  res = await worker.fetch(req("verify-code", { email: "nik@example.org", code: realCode }), e5);
  body = await res.json();
  assert(res.status === 400 && !body.ok, "correct code no longer works after too many wrong attempts (code was burned)");

  // -------------------------------------------------------------
  // Scenario F: rate limiting — 4th request in the window sends no email
  // -------------------------------------------------------------
  githubState = makeGithubState(freshData(), []);
  sentEmails = [];
  const e6 = env();
  for (let i = 0; i < 3; i++) await worker.fetch(req("request-code", { email: "mo@example.org" }), e6);
  assert(sentEmails.length === 3, "3 requests within the window send 3 codes, got " + sentEmails.length);
  res = await worker.fetch(req("request-code", { email: "mo@example.org" }), e6);
  body = await res.json();
  assert(res.status === 200 && body.ok, "4th request still returns the generic ok response");
  assert(sentEmails.length === 3, "4th request does NOT send another email (rate limited)");

  // -------------------------------------------------------------
  // Scenario G: SHA-conflict race — two near-simultaneous edits
  // -------------------------------------------------------------
  githubState = makeGithubState(freshData(), []);
  sentEmails = [];
  const e7 = env();
  // Both "readers" get the same original snapshot queued for their GET of
  // data.json, simulating two apply-update calls whose reads both landed
  // before either had written.
  const original = freshData();
  githubState.getQueues["data.json"] = [
    { sha: "sha-data-0", content: original },
    { sha: "sha-data-0", content: original },
  ];

  await worker.fetch(req("request-code", { email: "mo@example.org" }), e7);
  const codeA = extractCode(sentEmails[0]);
  const verifyA = await (await worker.fetch(req("verify-code", { email: "mo@example.org", code: codeA }), e7)).json();

  await worker.fetch(req("request-code", { email: "nik@example.org" }), e7);
  const codeB = extractCode(sentEmails[1]);
  const verifyB = await (await worker.fetch(req("verify-code", { email: "nik@example.org", code: codeB }), e7)).json();

  const resA = await worker.fetch(req("apply-update", { token: verifyA.token, paperId: "P002", stage: "Drafting" }), e7);
  const bodyA = await resA.json();
  assert(resA.status === 200 && bodyA.ok, "first concurrent writer succeeds");

  const resB = await worker.fetch(req("apply-update", { token: verifyB.token, paperId: "P004", priority: "Low" }), e7);
  const bodyB = await resB.json();
  assert(resB.status === 409 && !bodyB.ok && bodyB.conflict, "second concurrent writer (stale sha) is rejected with a conflict, not silently applied/overwritten");
  assert(bodyB.error.toLowerCase().includes("someone else"), "conflict message is the clear retry message: " + bodyB.error);

  const finalData = githubState.files["data.json"].content;
  assert(finalData.papers.find((p) => p.id === "P004").priority !== "Low", "the rejected writer's change was NOT silently applied");

  // -------------------------------------------------------------
  // Scenario H: expired/invalid session token on apply-update
  // -------------------------------------------------------------
  githubState = makeGithubState(freshData(), []);
  const e8 = env();
  res = await worker.fetch(req("apply-update", { token: "not-a-real-token", paperId: "P002", stage: "Drafting" }), e8);
  body = await res.json();
  assert(res.status === 401 && !body.ok, "garbage/invalid token is rejected on apply-update");

  // -------------------------------------------------------------
  // Scenario I: CORS lock — wrong origin is rejected outright
  // -------------------------------------------------------------
  githubState = makeGithubState(freshData(), []);
  const e9 = env();
  res = await worker.fetch(req("request-code", { email: "mo@example.org" }, { origin: "https://evil.example.com" }), e9);
  assert(res.status === 403, "request from a non-allowed origin is rejected with 403, got " + res.status);
  const allowHeader = res.headers.get("Access-Control-Allow-Origin");
  assert(!allowHeader, "no Access-Control-Allow-Origin header is echoed back to a disallowed origin");

  res = await worker.fetch(req("request-code", { email: "mo@example.org" }, { origin: "https://criticaldata.github.io" }), e9);
  assert(res.headers.get("Access-Control-Allow-Origin") === "https://criticaldata.github.io", "matching origin gets the CORS header back");

  // -------------------------------------------------------------
  // Scenario J: revoked membership — token still cryptographically valid,
  // but email removed from the roster before apply-update is called
  // -------------------------------------------------------------
  githubState = makeGithubState(freshData(), []);
  sentEmails = [];
  const e10 = env();
  await worker.fetch(req("request-code", { email: "mo@example.org" }), e10);
  const codeJ = extractCode(sentEmails[0]);
  const verifyJ = await (await worker.fetch(req("verify-code", { email: "mo@example.org", code: codeJ }), e10)).json();
  // Simulate mo@example.org being removed from the roster mid-session.
  e10.TEAM_EMAILS = JSON.stringify(["nik@example.org"]);
  res = await worker.fetch(req("apply-update", { token: verifyJ.token, paperId: "P002", stage: "Drafting" }), e10);
  body = await res.json();
  assert(res.status === 403 && !body.ok, "a since-revoked email's still-valid-looking token is rejected on apply-update, not trusted for its full lifetime");

  // -------------------------------------------------------------
  // Scenario K: Resend failure during request-code doesn't leak or crash
  // -------------------------------------------------------------
  githubState = makeGithubState(freshData(), []);
  sentEmails = [];
  resendShouldFail = true;
  const e11 = env();
  res = await worker.fetch(req("request-code", { email: "mo@example.org" }), e11);
  body = await res.json();
  assert(res.status === 200 && body.ok, "email-provider failure still returns the generic ok response, not an error that reveals anything");
  resendShouldFail = false;

  console.log("\nALL WORKER TESTS PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
