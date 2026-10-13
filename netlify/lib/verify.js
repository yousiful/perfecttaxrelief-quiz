/**
 * Phone verification helpers shared by submit-lead and verify-phone.
 * Stateless: the code never leaves the server in clear text. The browser gets a
 * signed token (contactId, expiry, resend count, HMAC of the code) and sends it
 * back with whatever the visitor typed.
 */
const crypto = require('crypto');

const GHL_BASE_URL = 'https://services.leadconnectorhq.com';
const TTL_MS = 10 * 60 * 1000;
const MAX_SENDS = 3;

const secret = () => process.env.GHL_PIT_TOKEN || '';
const sign = (data) => crypto.createHmac('sha256', secret()).update(data).digest('base64url');

function makeToken(contactId, code, sends) {
  const body = Buffer.from(JSON.stringify({ c: contactId, e: Date.now() + TTL_MS, n: sends })).toString('base64url');
  return `${body}.${sign(body + '|' + code)}.${sign(body)}`;
}

// Returns the token's data only if we signed it, so a forged token can't make us text anyone.
function readToken(token) {
  const [body, , envMac] = String(token || '').split('.');
  if (!body || !envMac || sign(body) !== envMac) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString());
  } catch {
    return null;
  }
}

function checkCode(token, code) {
  const [body, mac] = String(token || '').split('.');
  const data = readToken(token);
  if (!data || !mac || Date.now() > data.e) return { ok: false, expired: !!data };
  const expected = sign(body + '|' + String(code || '').replace(/\D/g, ''));
  const ok = expected.length === mac.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(mac));
  return { ok, contactId: data.c };
}

async function sendCode(contactId, sends) {
  const code = String(crypto.randomInt(100000, 1000000));
  const resp = await fetch(`${GHL_BASE_URL}/conversations/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret()}`,
      Version: '2021-04-15',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'SMS',
      contactId,
      message: `Perfect Tax Relief: your verification code is ${code}. It expires in 10 minutes.`,
    }),
  });
  if (!resp.ok) {
    console.error('[verify] SMS send failed', resp.status, await resp.text());
    return null;
  }
  return makeToken(contactId, code, sends);
}

async function tagVerified(contactId) {
  const resp = await fetch(`${GHL_BASE_URL}/contacts/${contactId}/tags`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret()}`,
      Version: '2021-07-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ tags: ['phone verified'] }),
  });
  if (!resp.ok) console.error('[verify] tag failed', resp.status, await resp.text());
}

module.exports = { sendCode, checkCode, readToken, tagVerified, MAX_SENDS };
