// Minimal HS256 JWT sign/verify using the standard Web Crypto API
// (crypto.subtle), which Cloudflare Workers implement natively. Deliberately
// hand-rolled instead of pulling in an npm JWT library — the whole thing is
// ~40 lines, and it keeps the Worker dependency-free (no bundler surprises,
// `wrangler deploy` ships exactly the files in src/).

function toBase64Url(bytes) {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(b64url) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(b64url.length + ((4 - (b64url.length % 4)) % 4), "=");
  const str = atob(b64);
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  return bytes;
}

function textToBase64Url(text) {
  return toBase64Url(new TextEncoder().encode(text));
}

async function importKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

/** Sign {email, iat, exp} (and any extra claims) into a compact HS256 JWT. */
export async function signJwt(payload, secret) {
  const header = { alg: "HS256", typ: "JWT" };
  const signingInput = textToBase64Url(JSON.stringify(header)) + "." + textToBase64Url(JSON.stringify(payload));
  const key = await importKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput));
  return signingInput + "." + toBase64Url(new Uint8Array(sig));
}

/** Verify signature + expiry. Returns the decoded payload, or null if the
 * token is malformed, tampered with, or expired. Never throws. */
export async function verifyJwt(token, secret) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(fromBase64Url(payloadB64)));
  } catch {
    return null;
  }

  const key = await importKey(secret);
  const signingInput = headerB64 + "." + payloadB64;
  let valid;
  try {
    valid = await crypto.subtle.verify("HMAC", key, fromBase64Url(sigB64), new TextEncoder().encode(signingInput));
  } catch {
    return null;
  }
  if (!valid) return null;

  if (typeof payload.exp !== "number" || Date.now() / 1000 >= payload.exp) return null;

  return payload;
}
