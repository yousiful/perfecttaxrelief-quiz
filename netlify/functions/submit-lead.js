/**
 * submit-lead.js
 *
 * Receives the quiz + contact-form payload from index.html and upserts the
 * lead into GoHighLevel server-side, so the real PIT token never has to sit
 * in client-side JS (a client-side token could be read straight out of page
 * source and used to fully manage the GHL account).
 *
 * ====================== HOW TO CONNECT THIS ======================
 * 1. In the Netlify site's dashboard (Site settings -> Environment variables),
 *    set:
 *      GHL_PIT_TOKEN   = the location's Private Integration Token
 *      GHL_LOCATION_ID = the location ID for Perfect Tax Relief
 *
 * 2. In GoHighLevel, create custom fields on the Contact object matching the
 *    keys this function sends (see CUSTOM_FIELD_KEYS below) -- or edit
 *    CUSTOM_FIELD_KEYS to match whatever field keys already exist in that
 *    location. GHL's v2 API accepts custom fields addressed by `key`
 *    (fieldKey) for most text/single-line fields; if a field doesn't accept
 *    key-based addressing, you'll need its custom field ID instead (find via
 *    GET /locations/{locationId}/customFields) and reference it by `id`.
 *
 * 3. Build the actual notification/SMS/email/redirect behavior as GHL
 *    Workflows triggered off the tags this function applies:
 *      - Workflow A, trigger tag "qualified-10k-plus": notify sales team,
 *        send SMS + email confirmation, redirect/link to booking page.
 *      - Workflow B, trigger tag "under-10k": add to low-balance nurture,
 *        send the educational email/checklist, keep OUT of workflow A.
 *      - Any "urgent-*" tag: mark priority high / route to a fast-response
 *        list inside workflow A.
 *    This is the idiomatic way to do it in GHL (workflows own messaging/
 *    routing) rather than duplicating that logic here.
 *
 * Until the two env vars above are set, this function logs the payload and
 * returns success so the page's own flow (result screen, tracking) still
 * works end-to-end during development/demo.
 * =================================================================
 */

const GHL_BASE_URL = 'https://services.leadconnectorhq.com';
const GHL_API_VERSION = '2021-07-28';

// Maps our internal field names -> the GHL custom field `key` to send.
// Edit the right-hand values to match the real custom field keys once
// they're created in the Perfect Tax Relief GHL location.
const CUSTOM_FIELD_KEYS = {
  tax_issue: 'tax_issue',
  estimated_tax_debt: 'estimated_tax_debt',
  urgency_level: 'urgency_level',
  returns_filed_status: 'returns_filed_status',
  desired_outcome: 'desired_outcome',
  preferredContactTime: 'preferred_contact_time',
  state: 'lead_state',
  utm_source: 'utm_source',
  utm_medium: 'utm_medium',
  utm_campaign: 'utm_campaign',
  utm_content: 'utm_content',
  utm_term: 'utm_term',
  sourceUrl: 'quiz_source_url',
  completedAt: 'quiz_completed_at',
  priority: 'lead_priority',
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const {
    firstName, lastName, phone, email,
    preferredContactTime, state, answers = {}, tags = [],
    qualified, priority, utm = {}, sourceUrl, completedAt,
  } = payload;

  const token = process.env.GHL_PIT_TOKEN;
  const locationId = process.env.GHL_LOCATION_ID;

  if (!token || !locationId) {
    console.log('[submit-lead] GHL not configured yet -- logging payload only.', {
      firstName, lastName, phone, email, qualified, priority, tags, answers,
    });
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, ghlConnected: false, message: 'Logged only -- set GHL_PIT_TOKEN and GHL_LOCATION_ID to enable real CRM sync.' }),
    };
  }

  const customFields = Object.entries({
    ...answers,
    preferredContactTime,
    state,
    ...Object.fromEntries(Object.entries(utm).map(([k, v]) => [k, v])),
    sourceUrl,
    completedAt,
    priority,
  })
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => ({
      key: CUSTOM_FIELD_KEYS[key] || key,
      field_value: String(value),
    }));

  const ghlBody = {
    locationId,
    firstName,
    lastName,
    email,
    phone,
    tags,
    customFields,
    source: 'Tax Relief Route Finder Quiz',
  };

  try {
    const resp = await fetch(`${GHL_BASE_URL}/contacts/upsert`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Version: GHL_API_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(ghlBody),
    });

    const respText = await resp.text();
    if (!resp.ok) {
      console.error('[submit-lead] GHL upsert failed', resp.status, respText);
      // Still return 200 to the visitor -- a CRM hiccup should never block
      // them from seeing their result. The failure is logged for follow-up.
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, ghlConnected: true, ghlError: true, status: resp.status }),
      };
    }

    console.log('[submit-lead] GHL upsert succeeded for', email, 'tags:', tags);
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, ghlConnected: true }),
    };
  } catch (err) {
    console.error('[submit-lead] GHL request threw', err);
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, ghlConnected: true, ghlError: true, message: String(err) }),
    };
  }
};
