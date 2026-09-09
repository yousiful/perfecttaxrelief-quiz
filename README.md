# Perfect Tax Relief — Tax Relief Route Finder

A mobile-first, single-page interactive quiz funnel for Perfect Tax Relief. Built as a
dependency-light static page (no build step, no framework) so it loads fast for paid
Meta traffic, plus one Netlify Function that safely bridges to GoHighLevel.

## What's here

- `index.html` — the entire funnel: trust bar, hero, 5-question quiz, loading screen,
  contact capture, and both result branches (qualified / under-$10k), plus the
  exit-intent modal and sticky mobile CTA.
- `netlify/functions/submit-lead.js` — receives the lead payload and upserts it into
  GoHighLevel server-side. The real GHL token never touches the browser.
- `netlify.toml` — Netlify config (static publish + the function).

## Already wired up

- **Meta Pixel**: uses the real, already-live Perfect Tax Relief pixel
  (`1520095023224222`) — the same one running on the account's other funnels.
- **Tracking events**: `PageView`, `QuizStarted`, `QuestionAnswered`, `QuizCompleted`,
  `LeadSubmitted`, `QualifiedLead`, `Under10kLead`, `CalendarBooked`, `ClickToCall` all
  fire via `trackEvent()` in `index.html`. Where one of these maps to a real Meta
  standard event this account already tracks, it fires that too:
  `LeadSubmitted` → also fires `Lead`; a qualified result → also fires
  `CompleteRegistration`; booking → also fires `Schedule`.
- **Client-side tag logic**: `computeTags()` in `index.html` reproduces the exact tag
  rules from the spec (`tax-assessment-completed`, `qualified-10k-plus` / `under-10k`,
  `urgent-garnishment`, `urgent-bank-levy`, `urgent-tax-action`, `unfiled-returns`) and
  sends them in the payload to the function.

## To connect it live

1. **Deploy** (already done if you're reading this from the live Netlify URL — see
   the deploy notes below). To redeploy after edits: `git push`, Netlify auto-builds
   from `main`.

2. **Point a domain at it** (optional): add a custom domain in the Netlify site's
   Domain settings, or set up a redirect from wherever this needs to live
   (e.g. `go.perfecttaxrelief.com/quiz`).

3. **Connect GoHighLevel** — in the Netlify site's Environment Variables, set:
   - `GHL_PIT_TOKEN` — the Private Integration Token for this location
   - `GHL_LOCATION_ID` — the GHL location ID for Perfect Tax Relief

   Until both are set, `submit-lead.js` just logs the payload (visible in the
   function's logs) and returns success, so the page still fully works end to end.

4. **Create the custom fields in GHL** referenced in
   `netlify/functions/submit-lead.js`'s `CUSTOM_FIELD_KEYS` map (or edit that map to
   match field keys that already exist): `tax_issue`, `estimated_tax_debt`,
   `urgency_level`, `returns_filed_status`, `desired_outcome`,
   `preferred_contact_time`, `lead_state`, the five `utm_*` fields,
   `quiz_source_url`, `quiz_completed_at`, `lead_priority`.

5. **Build the two GHL Workflows** that actually do the notification / SMS / email /
   routing work (this is the normal, idiomatic way to do it in GHL — the function's
   job is only to get the contact + tags into GHL correctly):
   - **Trigger: tag `qualified-10k-plus` added** → notify the sales team with the
     contact's full quiz answers, send an immediate SMS confirmation, send an
     immediate email confirmation, and get them to a calendar/booking link. If any
     `urgent-*` tag is also present, mark/route as high priority.
   - **Trigger: tag `under-10k` added** → add to a low-balance nurture sequence, send
     the educational email or checklist. Keep this list separate from the qualified
     workflow above.

6. **Edit these placeholders in `index.html`** before sending real traffic:
   - `CONFIG.bookingUrl` — real GHL calendar/booking link (currently a placeholder).
   - `CONFIG.paymentOptionsUrl` / `CONFIG.checklistUrl` — real destination pages for
     the low-balance result buttons.
   - The phone number `(888) 222-8814` appears in the trust bar, the `tel:` links,
     and the qualified result screen — confirm it's the real number to use here.
   - The consent paragraph in the contact form (`.consent-text`) is marked
     `EDITABLE` — swap in Perfect Tax Relief's actual approved TCPA / legal
     disclosure copy and real Terms/Privacy links.

## Compliance notes baked into the copy

- Nothing on the page claims the quiz determines eligibility or guarantees an
  outcome. Language throughout uses "may be a fit," "may qualify," "a specialist can
  review your situation."
- The under-$10k result never uses "disqualified" or "you do not qualify."
- The consent disclosure sits directly under the submit button, matches
  TCPA-style language, and is explicitly marked as a placeholder for the real
  legal team's approved text.

## Local preview

No build step — just open `index.html` in a browser, or serve the folder with any
static server (`npx serve .`) if you want the Netlify Function to also respond
locally, use `netlify dev` from this directory.
