# Health Records (BSA health form, insurance card, immunizations)

**Status:** Planning — decisions answered 2026-11-12; prototypes need the changes listed below, then build
**Parked:** 2026-08-20 · **Reopened:** 2026-11-12 (Patrick: "enable parents to upload the BSA medical health records,
health insurance cards, immunization records … parents and adult leaders would be able to access it on demand … print
out in bulk to fill up our binder before campouts")
**Priority:** High — Patrick asked for it next.

## Overview

Families upload, for each scout and each adult who goes on outings, the BSA Annual Health and Medical Record (Parts
A/B, and Part C when a trip needs it), a health insurance card (front and back) and an immunization record. Files are
**encrypted by the site, then stored in a private Bunny storage zone**; they are only ever served back through the
site to an authorized person — no public URL, no CDN, no shareable link. Parents see their own household's. A few
named leaders (new capability `health_forms.view`) open one person's records on a phone at an event, and before a
campout an admin view shows every attendee's status, reminds families who are missing something, and prints the whole
medical binder as one PDF.

## Problem / Opportunity

Forms live only on paper with the health officer. Trip leaders can't reach them away from home base, families
re-submit every year, and assembling the binder before each campout is manual. Online storage closes those gaps, but
these are minors' medical records and insurance IDs: the access design matters more than the screens.

**This reverses an on-the-record decision.** `20260713000000_demographics.sql:15-16`: medical content "deliberately
NOT tracked — health form dates only, the forms themselves stay on paper." Patrick asked for this directly
(2026-11-12); record it as a DECISIONS entry when the plan activates.

## Decisions so far (Patrick, 2026-11-12)

- **Storage: Bunny**, not Supabase Storage — cost (about $1/month vs Pro at $25 if the project is on free).
  Conditions agreed in the same conversation, all required:
  1. A **separate storage zone with NO pull zone** — no public URL exists. Never the news/media zone.
  2. **Encrypt every file in the app before upload** (AES-256-GCM); Bunny only ever holds ciphertext.
  3. **Every read goes through the site:** permission check → fetch ciphertext by Storage API → decrypt → stream with
     `Cache-Control: no-store`. No signed links, no caching.
  4. **US storage region.** Its own access key, in Vercel only.
- Per-person documents for scouts AND adults; families upload for their household; a few named leaders view.

## Acceptance Criteria

- [ ] A verified parent (Tier 2 identity) can upload, replace, view and delete each document for each person in
      their household — scouts and adults — and nobody else's.
- [ ] Each document has a type and, for the BSA form, an expiry (12 months from the exam/sign date); status reads
      on file / expires soon / expired / missing.
- [ ] Only holders of `health_forms.view` can open another household's records; the capability is granted by name,
      excluded from the legacy auto-grant (`LEGACY_EXCLUDED`), and separate from `roster.manage`.
- [ ] Bunny holds only ciphertext; the storage zone has no pull zone; no URL to a health file exists anywhere.
- [ ] Every view, download and print writes an access-log row (who, whose, which document, when); the log is visible
      to `health_forms.view` holders, and a family can see who opened their own records.
- [ ] Before an event: the admin event view lists every attendee's status, flags anything missing or expiring before
      the trip, emails the households concerned, and prints one PDF binder (cover sheet + one section per person).
- [ ] Retention runs automatically: a replaced file is deleted at once; expired files and a departed person's files
      are deleted on the schedule Patrick sets (Open Questions).
- [ ] `people.health_form_date` is no longer a second source of truth (derived from the BSA form record, or retired).

## Test Plan

- [ ] `Parent_CanUploadHealthDocument_ForOwnHouseholdMember()`
- [ ] `Parent_CannotUploadOrView_ForAnotherHousehold()`
- [ ] `Parent_CanReplaceDocument_AndOldCiphertextIsDeleted()`
- [ ] `Parent_CanDeleteDocument_AndItIsGoneFromBunny()`
- [ ] `Leader_CanViewRecords_WhenGrantedHealthFormsView()`
- [ ] `Leader_CannotViewRecords_WithoutCapability()` (finance.manage, roster.manage alone are refused)
- [ ] `LegacyLeaderSession_DoesNotInheritHealthFormsView()`
- [ ] `StoredObject_IsCiphertext_NotTheUploadedBytes()` — the bytes at Bunny don't contain the file's magic number
- [ ] `Decrypt_FailsClosed_OnTamperedCiphertext()` — GCM auth tag mismatch → refuse, no partial file
- [ ] `Decrypt_Refuses_CiphertextMovedToAnotherDocumentRow()` — the document id is the AAD
- [ ] `TripLeader_CanView_AttendeesFromSevenDaysBefore_ToTwoDaysAfter()` / `TripLeader_IsRefused_OutsideTheWindow()`
- [ ] `TripLeader_IsRefused_ForSomeoneNotOnTheirEvent()`
- [ ] `Scout_CannotView_OwnRecords()` (parents only)
- [ ] `Expiry_IsTwelveMonths_FromTheLaterSignatureDate()`
- [ ] `Complete_RequiresBsaFormInsuranceAndAReview_PartCOnlyWhenTheEventNeedsIt()`
- [ ] `ReplacingADocument_ClearsTheReview()`
- [ ] `Family_SeesWhoOpenedTheirRecords()`
- [ ] `Retention_ErasesAScoutsRecords_NinetyDaysAfterInactive()`
- [ ] `Read_IsRefused_WhenTheAccessLogInsertFails()` — log first, fail closed
- [ ] `ProductionWithoutKeyOrBunnyEnv_Throws_NeverFallsBackToMemory()`
- [ ] `Upload_DeletesTheObject_WhenTheRowInsertFails()` + `RetentionSweep_DeletesOrphanObjects()`
- [ ] `HealthFileResponse_IsNoStore_AndAttachmentOrInline()` — headers on the streaming route
- [ ] `EveryRead_WritesAccessLogRow()` (view, download, binder print — one row per person per print)
- [ ] `Status_IsExpired_AfterTwelveMonths()` / `Status_IsExpiresSoon_BeforeEventDate()`
- [ ] `Binder_IncludesEveryAttendee_FlagsMissingOnCoverSheet()`
- [ ] `RemindFamilies_EmailsOnlyHouseholdsWithMissingOrExpiring()`
- [ ] `Upload_RejectsWrongTypeOrOversize_InPlace()`
- [ ] `Retention_DeletesExpiredAndDepartedOnSchedule()`

## Technical Approach

**Storage + crypto (`lib/health-files.ts`, server-only; tech-lead review 2026-11-12: GO with these changes).**
- Env: `HEALTH_BUNNY_ZONE`, `HEALTH_BUNNY_PASSWORD` (the zone's password — Bunny's `AccessKey` header takes the zone
  password, not the account key; use the zone's read-only password on the read path), `HEALTH_BUNNY_HOST` (regional
  endpoint, `ny.` or `la.storage.bunnycdn.com`; geo-replication off or US-only), and `HEALTH_FILES_KEYS`
  (a keyring, `"1:<base64 32 bytes>,2:…"`). Separate from the existing `BUNNY_*` media vars on purpose.
- **Reuse nothing from `bunny-storage.ts`** (its config requires a pull zone and returns CDN URLs; its HEAD-loop
  naming isn't needed for UUID paths). Three small functions: `put`, `get`, `delete` (404 on delete = success).
- **Envelope encryption with `node:crypto`** in a `runtime = 'nodejs'` route — no library. A fresh data key per file
  encrypts the bytes (AES-256-GCM); the data key is wrapped with the master key (also AES-256-GCM). The **document id
  is the AAD** for both, so one person's ciphertext can't be swapped into another's row. Each row stores
  `key_version` + the wrapped key; the blob carries a `version|iv|tag` header. Rotation = re-wrap data keys.
- **Decrypt by buffering and verifying the tag before sending a byte** (files ≤ ~5 MB; a streaming decrypt would
  release unauthenticated plaintext).
- **Key custody:** two offline copies of the master key (Patrick's password manager + one more); Vercel secrets are
  write-only. Lose it and every file is unreadable. The nightly prod dump carries only wrapped keys.
- **Fail loud:** the `memory` storage adapter (tests, local dev) is selectable only when `NODE_ENV !== 'production'`;
  in production a missing/short key or missing Bunny env throws on first use — never a silent fallback.
- **Reads:** route handler `/api/health-files/[id]`, permission check → **write the access-log row first (refuse if
  it fails)** → fetch → decrypt → respond `Cache-Control: no-store, private`, `Content-Disposition` inline or
  attachment, `X-Content-Type-Options: nosniff`. `next.config.ts` headers add no-store, no-referrer and noindex for
  `/api/health-files/*`, `/member/health-forms/*` and `/health/*` (same pattern as `/i/`); mind
  `staleTimes.dynamic: 30` caching those pages client-side.
- **Uploads:** a Server Action, one file per call. The phone resizes photos first —
  `createImageBitmap(file, { imageOrientation: 'from-image' })` → canvas → JPEG, ≤ 2400 px long edge, ≤ 3 MB —
  which also strips EXIF/GPS. Safari decodes HEIC into the canvas, so iPhones are covered; HEIC arriving any other
  way is refused. The server re-checks magic bytes and size. Vercel's ~4.5 MB request body limit stands (the 15 MB
  `serverActions.bodySizeLimit` doesn't lift it — worth checking the news uploads against it separately); a PDF over
  ~3.5 MB is refused in place with "photograph each page instead". **Order: PUT to Bunny, then insert the row; if the
  insert fails, DELETE the object.** No chunked upload (it would need staging storage), no direct-to-Bunny (it would
  bypass encryption).

**Data (one migration).**
- `health_documents(id, person_id, kind ('bsa_ab','bsa_c','insurance','immunization'), page int, object_path,
  key_version, wrapped_key, content_type, bytes, uploaded_by_person_id, uploaded_at, effective_on date,
  expires_on date)` + `<col>_from_1900` CHECKs; **partial unique index on (person_id, kind, page)**. No
  `replaced_at` / `deleted_at`: the row is deleted when its ciphertext is.
- `health_access_log(id, viewer_person_id, person_id, kind, document_id (no FK), action ('upload','replace',
  'delete','view','download','print'), event_id null, at)` — **separate from `audit_log`** (area CHECK, different
  audience and retention); snapshots person + kind so it survives file deletion.
- `health_forms.view` added to the capability CHECK, `CAPABILITIES` and `LEGACY_EXCLUDED`.
- `people.health_form_date`: **kept, no trigger** (paper-only people still need it, and a parent-typed date isn't
  verified). An upload writes it through `write-person-demographics` when the new date is later.
- Service-role only, RLS on, no policies (supabase-security-posture).

**Screens** — Jenna's spec (2026-11-12), prototyped by Brad in `prototypes/health-records/`:
- Statuses everywhere: **On file · Expires soon** (≤60 days, or before the trip) **· Expired · Missing**, as badges.
1. **Parent, `/member/health-forms`** — the existing "Soon" Health forms card on /member goes live with one line per
   person ("Ben: on file · expires Mar 4, '27"). Household list (first person with a problem expanded) → each
   document; Add / Replace in a Drawer (Take photo / Choose file or PDF, pages as thumbnails, + Add another page,
   card Front/Back slots, "Date the doctor signed" → "Good until …"); View; Remove with a confirm. Replace keeps the
   old file until the new one saves. "Things we should know" is typed by the family (from
   `people.things_we_should_know`) and labelled as such. An event sign-up shows a one-line Notice per person
   missing or expiring before the trip, linking here — never blocks sign-up.
2. **Leader on a phone, `/health`** — verified sign-in + `health_forms.view`; search first, This trip · Everyone;
   one person: what the family told us, emergency contact (Call / Text), documents with View; "Viewing is logged."
   as plain text (no confirm mid-incident); no offline cache by design — the paper binder is the fallback.
3. **Admin** — event workbench **Medical** tab (beside Money; holders only): summary line, All · Needs attention,
   DataTable·Card + person panel (the Scout Accounts pattern), **Remind families (n)** (two-step email preview),
   **Print binder** (primary): cover sheet with counts and the missing list, scouts A–Z then adults A–Z, a stub
   page for anyone missing; logged. A troop-wide **Health forms** tab on the Roster (All · Missing · Expiring ·
   Expired, worst first). A **Health** column on /admin/access. An **access log** (append-only, read-only).

**Binder printing (tech-lead: per person, assembled in the browser).** One function building a whole-event binder
holds every page in memory (`pdf-lib` has no streaming output). Instead a route returns **one person's merged PDF**
(a header page drawn in `pdf-lib`, then each decrypted document — JPEGs via `embedJpg`, no recompression) and logs
one `print` row per person; the browser fetches each and concatenates them with `pdf-lib`, adds the cover sheet
(counts, missing list), and downloads. A password-protected or unreadable PDF becomes a "could not merge — print
separately" page and is flagged on the cover. Library: the maintained fork `@cantoo/pdf-lib` (upstream `pdf-lib`
is unmaintained since 2021). `@react-pdf/renderer` is not used here.

**Retention job** — daily (Vercel cron or the existing noon task): expired documents past the grace period and
departed people's documents per the schedule, plus an **orphan sweep** (list the zone root, delete objects with no
row) for uploads whose insert failed after the PUT.

**Prototype first (riskiest):** the binder merge with real scans — 20 people of mixed iPhone photos plus a filled
BSA fillable PDF: memory, time, output size, and whether AcroForm field values survive `copyPages`. Second: the iOS
resize pipeline.

## Implementation Steps

1. Patrick answers the Open Questions; record the policy reversal + storage decision in DECISIONS.
2. Create the Bunny storage zone (US region, **no pull zone**) and the master key; add env vars to Vercel + local.
3. Migration (worktree, ship pattern): tables, capability, `health_form_date` handling.
4. `lib/health-files.ts` (crypto + Bunny adapter + memory adapter) with its tests first.
5. Upload / replace / delete actions (household-scoped) + the streaming route + access log.
6. Public parent screen; then the leader phone view; then the event sign-up prompt.
7. Admin Medical tab: status, Remind families, Print binder; troop-wide list; access log.
8. Retention job.
9. qa-lead security review (mandatory) + Jenna review of the built screens; Patrick tries it with one family.

## Patrick's answers (2026-11-12)

1. **Who can open records — a new security group, three ways in:**
   - **Named adult leaders** — the capability `health_forms.view`, granted by name (Access screen), troop-wide.
   - **The family** — parents and adult family members see their own household's records (household-scoped, no
     capability). Scouts never get access (answer 7).
   - **Leaders on a trip** — any adult leader signed up as attending an outing can open **that event's attendees'**
     records from **7 days before it starts until 2 days after it ends**. Computed at request time from the sign-up
     (status yes) and the event dates; no grant to remember or revoke. The leader `/health` view's "This trip" list
     is exactly this window.
   - Every way in is logged the same way; the log records which way (named / family / trip <event>).
2. **The 12 months start from the later of the parent's and the doctor's signature dates** (usually days apart). The
   upload asks for both dates where the form has both; `effective_on` = the later one; `expires_on` = +12 months.
3. **What "complete" means:**
   - **Base:** the BSA form (Parts A+B) and the insurance card (front and back).
   - **Part C** is also required when the event's sign-up has `needs_ahmr_c` (summer camp, high adventure — the flag
     already exists on `event_signups`). Otherwise Part C is "not needed".
   - **Immunizations:** about half the time they are on the BSA form, not a separate file. So a person is
     **Complete only when an authorized adult has reviewed the records and ticked "Reviewed — complete"** (who and
     when are stored). Uploading or replacing any document clears the review, so it is re-checked. Until reviewed,
     a person with every required file reads **"Ready for review"**.
4. **Allergies and "things we should know"** are shown only to the group in 1 — no wider "emergency view".
5. **Keep the insurance card photos.**
6. **Retention:** a scout's records are erased **90 days after they are marked inactive** (the retention job reads
   the date they went inactive). Expired documents stay until replaced (an expired form still shows history to the
   reviewer) — revisit if that holds too much.
7. **Parents only** — scouts 13+ don't see their records or get reminders.
8. **Families see who opened their records** — a "Who opened these" list on the parent screen, from the access log.
9. **The printed binder is kept by the health officer** — nothing for the site to do.

## Open Questions

- [ ] Names for the named-leader group (`health_forms.view`) at launch — the health officer, Scoutmaster, …?
- [ ] "Adult leader" for the trip window: anyone in the leaders table (has sign-off initials or a leader role) who is
      signed up as attending, or any adult attending with current YPT? (Recommend: leaders table + attending.)
- [ ] An adult who leaves the troop (no longer in a household, or marked inactive): same 90 days?
- [ ] Is the Supabase project on Pro already? (Doesn't change the Bunny decision; only noted.)

## Prototype changes these answers need

- A "Reviewed — complete" checkbox in the admin person panel and the leader view, with "Ready for review" status.
- Part C shown as required only on events with `needs_ahmr_c`; two signature dates on the BSA form upload.
- A "Who opened these" list on the parent screen.
- The leader view's This trip list limited to the 7-days-before / 2-days-after window, with a note when outside it.

## Notes

- 2026-08-20 design (troop79-specialist + qa-lead) recommended a private Supabase bucket and rejected Bunny because
  the existing Bunny zone is a public pull zone. The 2026-11-12 Bunny decision answers that with a separate zone
  with no pull zone plus app-side encryption; the access-control, capability, audit and retention parts of the
  August design carry over unchanged.
- Precedents: `lib/receipt-media.ts` + `20260818210000_receipt_media_bucket.sql` (private per-person documents),
  `lib/bunny-storage.ts` (Storage API calls — reuse the request code, not its config or pull-zone URLs),
  `20260816120000_person_capabilities.sql`, `lib/admin-actor.ts` `LEGACY_EXCLUDED`, `login_events` (lightweight log),
  `meeting-plan-pdf` (@react-pdf/renderer setup), `attention-items.ts` (expiring forms on the admin dashboard).
- Related: `Plans/Family-Identity-Auth.md` (Tier 2 identity gates the family side).
