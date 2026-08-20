# Health Forms Upload

**Status:** Parked
**Parked:** 2026-08-20
**Priority:** Medium — one of the remaining Members "Soon" cards (campout payments, registration,
health forms, wreath sale), not blocking anything live today.

## Overview

Let families upload BSA Annual Health and Medical Record (AHMR) forms so a scoped subset of adult
leaders (trip leaders / first-aid-certified — not the full leader roster) can view them securely
online, replacing the current paper-only process. Design investigated 2026-08-20 against the actual
codebase (troop79-specialist + qa-lead in parallel) before any code was written — nothing below is
built yet.

## Problem / Opportunity

Health forms currently exist only on paper with the health officer (per the explicit decision below).
That's a real access gap for trip leaders who need the form away from home base (campouts, high
adventure) and a manual burden on families re-submitting annually. An online upload closes both gaps
— but the data is sensitive enough (medical conditions, medications, insurance, emergency contacts)
that the access-control design matters more than the UI.

**This reverses a prior, on-the-record decision.** `next-app/supabase/migrations/20260713000000_demographics.sql:15-16`
states medical conditions/allergies are "deliberately NOT tracked — health form dates only, the forms
themselves stay on paper with the health officer." Building this feature is a deliberate policy
change, not an incidental side effect — worth Patrick explicitly signing off on before work starts,
separate from the technical design below.

## Current Architecture (facts gathered 2026-08-20, troop79-specialist)

- **Auth tiers are live today:** Tier 0 Public → Tier 1 `FAMILY_PASSWORD` (`t79_family_session`) →
  Tier 2/2-S verified per-person identity (`t79_identity`, adult or scout, via email/SMS challenge,
  `identity-session.ts`) → Tier 3 Leader (`t79_leader_session`, `LEADER_PASSWORD`, "NOT real
  authentication"). Tier 2 is shipped (Phases 0–2 of `Plans/Family-Identity-Auth.md`) and already
  named in that plan as the intended gate for "future health/permission surfaces"
  (`Family-Identity-Auth.md:14-15, 544-545`, decision D-054).
  Phase 3 (leader-issued codes, revoke UI, SMS/Twilio) is **not built** — doesn't block this feature,
  since families already reach Tier 2 today, but worth knowing before promising leader-side identity
  tooling as part of this work.
- **`person_capabilities`** (`20260816120000_person_capabilities.sql`) is the live, reusable
  permission-grant table — one row per `(person_id, capability)`, service-role-only, zero RLS
  policies (the "D-051 pattern"). Current vocabulary includes `finance.manage`/`finance.view`, added
  the same way a new `health_forms.view` capability would be added — and deliberately excluded from
  the legacy `LEADER_PASSWORD` auto-grant (`admin-actor.ts` `LEGACY_EXCLUDED` set) because a new
  sensitive surface shouldn't inherit blanket access. Same exclusion applies here.
- **Two storage mechanisms exist and only one is safe for this:** Bunny CDN (`bunny-storage.ts`) is a
  public pull-zone — anything uploaded gets a publicly fetchable URL regardless of any app-level
  `visibility` flag. Supabase Storage private buckets (`proof-media`, `receipt-media`) are the proven
  pattern — `public: false`, zero `storage.objects` policies, access only via short-lived signed URLs
  generated server-side. Both bucket header comments state explicitly: "a public URL for this bucket
  must never exist." Health forms must use this pattern, never Bunny.
- **Closest existing template end-to-end:** `reimbursement_requests` / `receipt-media.ts` /
  `20260818210000_receipt_media_bucket.sql` (finance workspace) — per-person sensitive document,
  private-bucket path column, capability-gated read/write, signed-URL-only viewing. Closer than the
  Resource Library schema, which is public-visibility-oriented.
- **`people.health_form_date`** (`20260817120000_people_ypt_health_notes.sql:31`) already exists as a
  bare completion-date flag, no file attached. Decide whether this feature extends that field's
  meaning or supersedes it with the new metadata table — don't leave two sources of truth.
- **`people.things_we_should_know`** (same migration, line 32) is an existing free-text
  "medical-adjacent" field, already called out as the strongest argument for requiring Tier 2 identity
  (D-054). Relevant precedent, not necessarily reused directly.

## Recommended Design (qa-lead, 2026-08-20)

Reuse the proven private-bucket + capability pattern; don't invent a new one.

1. **Storage** — new bucket `health-forms`, `public: false`, zero `storage.objects` RLS policies,
   copy `20260818210000_receipt_media_bucket.sql` structurally. MIME allowlist (PDF + common image
   types), ~10MB cap. Path convention `{person_id}/{timestamp}-{random}.{ext}` — no names in the
   storage key. Reads only via server-generated signed URLs, 5–10 min TTL, never cached, never
   emailed. **No Bunny CDN involvement.**
2. **Access control** — new capability `health_forms.view` on `person_capabilities`, granted by name
   via the existing admin capabilities screen, excluded from the legacy `LEADER_PASSWORD` auto-grant.
   **Do not reuse `roster.manage`** — contact/demographics access and medical-form access are
   deliberately different subsets of leaders. Families' own upload/replace is not a capability — it's
   ordinary household-scoped access enforced server-side, same pattern as scout-account/reimbursements.
3. **Metadata** — new `health_forms` table: `person_id`, `storage_path`, `uploaded_at`, `uploaded_by`,
   `expires_at`, `content_type`. Resolve the relationship to `people.health_form_date` (extend vs.
   supersede) before writing the migration.
4. **Retention** — AHMR is valid ~1 year (high-adventure parts often require ≤13 months
   pre-trek). Compute `expires_at` at upload. Surface expiring/expired forms via the existing
   `attention-items.ts` dashboard pattern rather than new UI. Re-upload deletes the prior storage
   object synchronously — latest-only, no version history. Don't auto-delete on expiry; flag instead.
5. **Audit trail** — `health_form_access_log(id, viewer_person_id, health_form_id, created_at)`, one
   row per signed-URL issuance, mirroring the existing lightweight `login_events` table. Zero RLS,
   admin-client-only. Purpose is answerability ("who's seen my kid's form"), not compliance logging.
6. **Explicitly out of scope at this size:** client-side encryption, per-object ACLs, a dedicated KMS,
   version history, separate secrets manager. Supabase's default AES-256-at-rest + TLS covers the
   actual threat model for a 30-family volunteer-run site.

## Acceptance Criteria

- [ ] Family can upload/replace their own scout's or their own (adult) AHMR form while signed in at
      Tier 2; upload is rejected for any household that isn't theirs.
- [ ] Only people holding `health_forms.view` can view/download a form; the capability is granted
      individually, never inherited from `LEADER_PASSWORD` or `roster.manage`.
- [ ] No health-form file is ever reachable by a public/unauthenticated URL, including via CDN cache.
- [ ] Every signed-URL issuance is logged with viewer + form + timestamp.
- [ ] Expiring/expired forms surface as an attention item; nothing is silently purged.
- [ ] Re-upload removes the previous stored file — only the latest form is retained.

## Test Plan

- [ ] `Family_CanUploadHealthForm_ForOwnHousehold()`
- [ ] `Family_CannotUploadHealthForm_ForOtherHousehold()`
- [ ] `Leader_CanViewHealthForm_WhenGrantedCapability()`
- [ ] `Leader_CannotViewHealthForm_WithoutCapability()`
- [ ] `LeaderPasswordSession_DoesNotInheritHealthFormsView()` — legacy-exclusion regression, mirrors
      the existing `finance.manage`/`finance.view` exclusion test
- [ ] `SignedUrl_ExpiresAfterTtl()`
- [ ] `Reupload_DeletesPriorStorageObject()`
- [ ] `ExpiringForm_SurfacesInAttentionItems()`
- [ ] `ViewAccess_WritesAuditLogRow()`

## Technical Approach

See "Recommended Design" above. Migration order: capability + bucket + metadata table + audit table
first (schema/infra), then `lib/health-forms.ts` (mirrors `lib/receipt-media.ts`), then server actions
for upload/view, then admin capability-grant wiring, then attention-items integration.

## Implementation Steps

1. Confirm with Patrick that reversing the "no medical content in the system" decision
   (`20260713000000_demographics.sql`) is intentional policy, not just a UI convenience.
2. Migration: `health-forms` storage bucket (copy `20260818210000_receipt_media_bucket.sql` pattern).
3. Migration: `health_forms` metadata table + `health_form_access_log` table.
4. Migration: add `health_forms.view` to `person_capabilities`' capability check constraint; add to
   `LEGACY_EXCLUDED` in `admin-actor.ts`.
5. `lib/health-forms.ts` — upload, signed-URL-issue (+ audit-log write), delete-on-reupload.
6. Server actions: family upload/replace (household-scoped), leader view (capability-gated).
7. Admin capabilities screen: add `health_forms.view` to the grantable list.
8. Attention-items integration for expiring/expired forms.
9. qa-lead security review — mandatory regardless of file count (auth/access-control change).

## Open Questions

- [ ] Does `people.health_form_date` get extended by this feature or fully superseded by the new
      `health_forms` table's `uploaded_at`/`expires_at`?
- [ ] Who initially holds `health_forms.view`? (Mirrors the `finance.manage` precedent of hand-picking
      two named people rather than a broad grant.)
- [ ] Should scouts (not just adults) be able to view their own health form once uploaded, or is this
      leader-view-only + family-upload-only?
- [ ] Expiry window — hardcode 1 year, or make configurable per high-adventure event requirements
      (some treks require ≤13 months)?

## Notes

- Investigated 2026-08-20 via parallel troop79-specialist (architecture facts) + qa-lead (security
  best practices) consultation, triggered by a direct question from Patrick, not by code in progress.
- Related: `Plans/Family-Identity-Auth.md` (Tier 2 identity — the binding mechanism for family-side
  access; Phase 3 leader tooling still open but not a blocker here).
- Related precedent files: `next-app/src/lib/receipt-media.ts`,
  `next-app/supabase/migrations/20260818210000_receipt_media_bucket.sql`,
  `next-app/supabase/migrations/20260816120000_person_capabilities.sql`,
  `next-app/supabase/migrations/20260817170000_login_events.sql`,
  `next-app/supabase/migrations/20260817120000_people_ypt_health_notes.sql`,
  `next-app/src/lib/admin-actor.ts` (`LEGACY_EXCLUDED` pattern).
