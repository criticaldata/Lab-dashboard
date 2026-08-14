# Parked, not deleted

This is the Cloudflare Worker auth pipeline (email one-time-code
verification → signed session → committing edits straight to `data.json`
via the GitHub Contents API). It's fully built and passed its offline test
suite (`worker/test/run.js` — 26 assertions across 11 scenarios, including
the unauthorized-email, expired/reused-code, and concurrent-write-conflict
cases), but the live Cloudflare setup (account, KV namespace, secrets,
`wrangler deploy`) hit enough friction that we're not debugging it under
demo deadline pressure.

**Why it's parked here instead of fixed or deleted:** the code itself was
never the problem — it's the one-time Cloudflare account/CLI setup, and
that's exactly the kind of external-dependency risk we didn't want anywhere
near a live demo. Rather than lose time debugging infrastructure during
prep, the dashboard's edit flow was switched to a zero-dependency
**demo mode** (localStorage only, no network calls to anything that needs
setup) for the immediate goal — see the main `README.md`.

**What supersedes this long-term:** the "Future: real authentication"
section in the main `README.md` documents a Supabase-based plan — built-in
email OTP instead of hand-rolled code-sending/rate-limiting/JWT logic, and
an authorized-members list lab admins manage through a normal dashboard
table instead of a Worker secret. That plan will likely replace this Worker
entirely rather than resume it, but the code stays here in case any of it
(the GitHub Contents API commit logic in particular) turns out to be
reusable.

**If you do come back to this:** the code and its test suite are unchanged
from when they were last verified working entirely offline (mocked KV,
mocked GitHub API, mocked email API — see `worker/test/run.js`). What
wasn't verified is the actual Cloudflare deploy — `wrangler login`, KV
namespace creation, secrets, `wrangler deploy` — start there. The setup
steps that were documented before pausing this are preserved in this
repo's git history (the README commit right before this one).
