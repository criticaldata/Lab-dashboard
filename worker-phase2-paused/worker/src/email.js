// Sends the one-time verification code via Resend (resend.com). Picked over
// SendGrid for a simpler, single-fetch-call HTTP API with no SDK needed —
// consistent with keeping the Worker dependency-free. Free tier (100
// emails/day, 3000/month) comfortably covers a small lab's usage.
//
// EMAIL_FROM defaults to Resend's shared sandbox address
// (onboarding@resend.dev), which works immediately with zero setup but is
// rate-limited and only deliverable to your own verified Resend account
// email while testing. For real lab-wide use, verify your own sending
// domain in the Resend dashboard and change EMAIL_FROM in wrangler.toml —
// see README.md's Worker setup section.
export async function sendVerificationCode(env, email, code) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: email,
      subject: "Your Lab Ledger verification code",
      text: `Your verification code is ${code}. It expires in 10 minutes. If you didn't request this, you can safely ignore this email.`,
      html:
        `<p>Your Lab Ledger verification code is:</p>` +
        `<p style="font-size:28px;font-weight:700;letter-spacing:0.15em;font-family:monospace">${code}</p>` +
        `<p>It expires in 10 minutes. If you didn't request this, you can safely ignore this email.</p>`,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Resend send failed: HTTP ${res.status} ${text}`);
  }
}
