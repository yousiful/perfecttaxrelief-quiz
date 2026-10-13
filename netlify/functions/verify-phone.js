/**
 * verify-phone.js
 *
 * POST { token, code }            -> { ok } and tags the contact "phone verified"
 * POST { token, action: 'resend' } -> { ok, token } with a fresh code texted
 */
const { sendCode, checkCode, readToken, tagVerified, MAX_SENDS } = require('../lib/verify');

const json = (statusCode, body) => ({ statusCode, body: JSON.stringify(body) });

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  let p;
  try {
    p = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { ok: false });
  }

  if (p.action === 'resend') {
    const data = readToken(p.token);
    // Resends allowed only for a token we issued that is less than 30 minutes past its expiry.
    if (!data || !data.c || data.n >= MAX_SENDS || Date.now() > data.e + 30 * 60 * 1000) {
      return json(200, { ok: false, reason: 'limit' });
    }
    const token = await sendCode(data.c, data.n + 1);
    return json(200, token ? { ok: true, token } : { ok: false });
  }

  const r = checkCode(p.token, p.code);
  if (!r.ok) return json(200, { ok: false, reason: r.expired ? 'expired' : 'wrong' });
  await tagVerified(r.contactId);
  return json(200, { ok: true });
};
