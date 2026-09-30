// Cloudflare Email Worker template — NOT deployed by this lane.
// Route alerts+*@<INBOUND_MAIL_DOMAIN> on ConstructHUB's own email domain here.
// Worker secret: INBOUND_MAIL_SECRET. Variable: CONSTRUCTHUB_ORIGIN (https URL).
// Forward original RFC822; the envelope recipient is authoritative (forwarded To often stays Gmail).
export default {
  async email(message, env) {
    if (message.rawSize > 262144) {
      message.setReject('Provider alert exceeds 256 KiB');
      return;
    }
    const origin = new URL(env.CONSTRUCTHUB_ORIGIN);
    if (origin.protocol !== 'https:') throw new Error('HTTPS origin required');
    const raw = await new Response(message.raw).arrayBuffer();
    const response = await fetch(new URL('/api/inbound-mail', origin), {
      method: 'POST', redirect: 'error',
      headers: {
        'content-type': 'message/rfc822',
        'x-inbound-mail-secret': env.INBOUND_MAIL_SECRET,
        'x-inbound-mail-to': message.to,
      },
      body: raw,
    });
    if (!response.ok) throw new Error('ConstructHUB ingestion unavailable');
    // Never log raw, sender, headers, secret, response body, confirmation code or URL.
  },
};
