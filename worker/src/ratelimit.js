// Simple per-email rate limiter backed by Workers KV.
//
// KV is eventually consistent across edge locations (writes can take up to
// ~60s to propagate globally), so this read-then-increment is technically
// racy: a request hitting two different POPs within that window could both
// read the same starting count. For a hard security boundary you'd want
// Durable Objects instead (they serialize access per-object). We're using
// KV anyway because it's simpler to set up correctly (no DO class, no
// migrations) and the stakes here are low — worst case under a race is a
// legitimate lab member getting one or two extra codes emailed to them,
// not an authorization bypass, since the code itself is still random and
// still gated by the authorized-email check.
export async function checkAndIncrement(kv, email, maxRequests, windowSeconds) {
  const key = `ratelimit:${email.toLowerCase()}`;
  const raw = await kv.get(key);
  const count = raw ? parseInt(raw, 10) : 0;
  if (count >= maxRequests) return false;
  await kv.put(key, String(count + 1), { expirationTtl: windowSeconds });
  return true;
}
