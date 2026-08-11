// Reads/writes repo files via the GitHub Contents API, using a repo-scoped
// PAT that lives only in Worker secrets (GITHUB_COMMIT_TOKEN) — see
// README.md for exactly what scope it needs (Contents: read+write on this
// one repo, nothing else).

const API = "https://api.github.com";

function b64EncodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function b64DecodeUtf8(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function ghFetch(url, token, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "lab-ledger-updates-worker",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON response body — leave json as null, callers check res.status
  }
  return { status: res.status, json };
}

/** GET a JSON file's parsed content + its current blob sha (needed to write
 * back without clobbering someone else's concurrent commit). */
export async function getJsonFile(repo, path, token, branch) {
  const url = `${API}/repos/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`;
  const { status, json } = await ghFetch(url, token);
  if (status !== 200) {
    throw new Error(`GitHub GET ${path} failed: HTTP ${status} ${JSON.stringify(json)}`);
  }
  const content = JSON.parse(b64DecodeUtf8(json.content.replace(/\n/g, "")));
  return { content, sha: json.sha };
}

/** PUT updated JSON content back, using the sha read immediately before
 * this call (the caller is expected to have just called getJsonFile).
 *
 * Returns {ok: true} on success, or {ok: false, conflict: true} if GitHub
 * rejected the write because `sha` is stale (someone else committed to this
 * file in between — GitHub's Contents API enforces this natively, which is
 * exactly the optimistic-concurrency check we need for the race-condition
 * requirement: read fresh, write with that sha, let GitHub itself reject a
 * stale write with 409/422 rather than trying to track "did the SHA change
 * since the form was opened" ourselves on the client).
 */
export async function putJsonFile(repo, path, token, branch, content, sha, message, committer) {
  const body = {
    message,
    content: b64EncodeUtf8(JSON.stringify(content, null, 2) + "\n"),
    sha,
    branch,
    committer,
  };
  const { status, json } = await ghFetch(`${API}/repos/${repo}/contents/${encodeURIComponent(path)}`, token, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  if (status === 200 || status === 201) return { ok: true, commitSha: json.commit && json.commit.sha };
  if (status === 409 || status === 422) return { ok: false, conflict: true, status, json };
  return { ok: false, conflict: false, status, json };
}
