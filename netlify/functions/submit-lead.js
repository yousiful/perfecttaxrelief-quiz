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
 * 2. Custom fields are addressed by ID (CUSTOM_FIELD_IDS below); IDs come from
 *    GET /locations/{locationId}/customFields.
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

// Internal field name -> GHL custom field ID ("Quiz - ..." fields in the PTR location).
const CUSTOM_FIELD_IDS = {
  tax_issue: '2Wmb65r9INtFBVmAkMno',
  estimated_tax_debt: 'DZJaZ70hkqZXVWdMvgZW',
  urgency_level: '5kngGqhh6HqDwscodrPx',
  returns_filed_status: 'Hx0JP364iJNGyZycEnnf',
  desired_outcome: 'tjx6CbZNz9ofkJ4OvVCc',
  preferredContactTime: 'PRFgtOk6XLtIug2LrZOs',
  state: 'FgdJ4KlJCnmToxpxG5CN',
  utm_source: 'lZHYJJx2i1RmHKh2yli6',
  utm_medium: '681ToQXCSGbvOAgGlKF6',
  utm_campaign: 'Lnv8scnePSlFuRRazfoD',
  utm_content: 'rFkiY14dw81RuX7Q9Boz',
  utm_term: 'u604ivVIAGUEcLAE0PE7',
  sourceUrl: 'qrQQUSQp2x27SpuAhffQ',
  completedAt: 'W4CtTtYOsq1mNM5qlOqb',
  priority: '0mz2V3EKlg64ZsO3rAhS',
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
    .filter(([key, value]) => CUSTOM_FIELD_IDS[key] && value !== undefined && value !== null && value !== '')
    .map(([key, value]) => ({
      id: CUSTOM_FIELD_IDS[key],
      field_value: String(value),
    }));

  const ghlBody = {
    locationId,
    firstName,
    lastName,
    email,
    phone,
    state: state || undefined,
    // One tag only; qualification/urgency details go in the note below.
    tags: ['Survey filled'],
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

    const contactId = JSON.parse(respText)?.contact?.id;
    if (contactId) {
      const noteLines = [
        'Tax Relief Quiz submission',
        `Best time to contact: ${preferredContactTime || 'Not given'}`,
        `State: ${state || 'Not given'}`,
        `Qualified ($10k+): ${qualified ? 'Yes' : 'No'}`,
        `Priority: ${priority || 'normal'}`,
        ...Object.entries(answers).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`),
        tags.length ? `Flags: ${tags.join(', ')}` : '',
      ].filter(Boolean);
      const noteResp = await fetch(`${GHL_BASE_URL}/contacts/${contactId}/notes`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Version: GHL_API_VERSION,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body: noteLines.join('\n') }),
      });
      if (!noteResp.ok) console.error('[submit-lead] note failed', noteResp.status, await noteResp.text());
    }

    console.log('[submit-lead] GHL upsert succeeded for', email);
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
