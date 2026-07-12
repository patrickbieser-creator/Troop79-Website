# Meetings Page — Public Agenda, Archive & Plan-to-Agenda Bridge

**Status:** Active
**Parked:** 2026-07-12
**Activated:** 2026-07-12
**Priority:** High

## Overview

A public `/meetings` experience in next-app centered on the next upcoming meeting, with forward/backward navigation through published meeting agendas. Meetings are authored in an admin editor that pulls Meeting Plan engine suggestions in as editable candidates, adds freeform items and logistics, and publishes the authoritative agenda. Ports the validated static prototype (`meeting.html` display + `admin/meeting-editor.html` editor + `data/meetings.json` shape) into the production app.

## Problem / Opportunity

Three distinct concepts are currently conflated or missing:

1. **The Plan** (machine-generated candidates) — live at `/meeting-plan`, but it's advisory engine output being presented publicly as if it were the decided agenda.
2. **The Agenda** (human decision) — no production equivalent exists. The nav "Meetings" tab points at `/meeting-plan` as an interim target (the old `/meeting` href 404'd; fixed 2026-07-12).
3. **The Record** (what happened) — no archive exists; past meetings are the troop's log and should be browsable.

Without this feature, families can't see a curated "what's happening Sunday," leaders can't turn plan suggestions into a published agenda, and there's no meeting history. Two public pages both describing Sunday (once one is built ad hoc) would confuse families about which is authoritative.

## Acceptance Criteria

- [ ] `/meetings` lands on the next upcoming **published** meeting, rendered in the prototype's display language (glance card with date/time/uniform/location/snack/flag/cleanup, pre-meeting section, timed agenda with parallel tracks, per-session leader/scouts/requirements).
- [ ] Prev/next date navigation with permalinks (`/meetings/2026-07-12`); a "This Week" affordance appears whenever viewing a non-current meeting.
- [ ] Past meetings render with a "this meeting has already happened" treatment; future meetings without a published agenda show calendar logistics + "agenda not yet published" (no 404s or empty pages).
- [ ] Admin meeting editor: logistics form + agenda builder with freeform items, backed by `meetings` + `meeting_sessions` tables.
- [ ] Editor shows the current Meeting Plan engine suggestions as a candidate tray; one action promotes a suggestion into an agenda slot prefilled with skill, requirements, instructor, and scout list — all editable after promotion.
- [ ] Draft/published status gates public visibility; only leaders see drafts.
- [ ] Nav "Meetings" tab and footer link repointed from `/meeting-plan` to `/meetings`.
- [ ] Public `/meeting-plan` page retired from public nav (folded into admin) once `/meetings` ships — one authoritative public answer to "what's happening Sunday."
- [ ] Scout-name privacy on the public page matches the existing `/meeting-plan` convention (first name + last initial).

## Test Plan

No automated test suite exists in next-app yet (`npm run lint` + `next build` are the gate). If a suite lands first, stub these; otherwise verify via browser walkthrough before ship:

- [ ] `Visitor_SeesNextPublishedMeeting_WhenVisitingMeetingsRoot()` — `/meetings` shows the soonest published meeting ≥ today.
- [ ] `Visitor_SeesArchiveTreatment_WhenViewingPastMeeting()` — past permalink renders the happened banner, not the live layout.
- [ ] `Visitor_SeesNotYetPublished_WhenAgendaMissing()` — future date with no published agenda shows logistics + placeholder.
- [ ] `Visitor_CannotSeeDraftAgenda_WhenNotAuthenticated()` — drafts are invisible to the public (loader uses admin client; draft filter server-side).
- [ ] `Leader_CanPromotePlanSuggestion_WhenEditingAgenda()` — promoted candidate lands as an editable session row with prefilled fields.
- [ ] `Leader_CanPublishMeeting_WhenAgendaComplete()` — publish flips public visibility atomically.
- [ ] `Engine_SuggestionsUnaffected_WhenAgendaEdited()` — editing/publishing an agenda never mutates plan engine data (plan stays regenerable).

## Technical Approach

**Sessions as rows, not a JSON blob — the load-bearing decision.** The future signup feature (scouts/leaders committing as participants/instructors) needs something to FK to. `meeting_sessions` as first-class rows means signups later are just a `session_signups` table. Porting `meetings.json` as a JSON document column would force a migration when the interactive phase arrives.

- **`meetings`**: `id bigserial`, `meeting_date date unique`, `status text check (draft|published)`, logistics columns (`time_range`, `uniform`, `location`, `location_address`, `snack`, `flag_ceremony`, `cleanup`, `duty_roster_url`), `updated_by`, timestamps. Soft-hide via `archived_at` if needed (house pattern, mirrors `ledger_entries`/`articles`).
- **`meeting_sessions`**: `id bigserial`, `meeting_id fk`, `sort_order`, `time_label`, `title`, `description`, `track text null` (Open Advancement / Merit Badge / etc.), `leader_name text` (display string for v1 — not an FK; instructors can be non-leaders like Turner Hall), optional provenance links back to plan concepts (`skill_id`, `mb_id`, nullable), `scouts jsonb` (display names list for v1; becomes real rows when signups land), plus a `section` discriminator for pre-meeting vs agenda items (single table, discriminator column — house pattern).
- **RLS/read model**: follow v0.22 posture — public loaders use `createAdminClient()` server-side with a `status = 'published'` filter; anon key stays locked out. Writes via Server Actions gated by `requireRole(['leader'])` (scouts don't author agendas in v1).
- **Plan → agenda bridge**: the editor calls the existing engine (`meeting-plan/engine.ts`) read-only for the target date and renders suggestions as candidate cards. Promotion copies data into `meeting_sessions`; no reverse dependency. Engine remains regenerable and advisory.
- **Default-meeting resolution**: soonest published meeting with `meeting_date >= today` (America/Chicago), else most recent past published meeting.
- **Calendar tie-in**: future meetings' logistics placeholder reads from `calendar_entries` (meetings are Sundays; recurring events self-classify via `events.default_kind`).
- **Prototype is the design reference** for both display and editor: `meeting.html` (glance card, pre-meeting cards, agenda rows with parallel-track layout, requirement toggles, quick contacts sidebar) and `admin/meeting-editor.html`.

## Implementation Steps

1. Migration: `meetings` + `meeting_sessions` tables, RLS enabled, no public policies beyond the house read pattern (or none — reads go through service role).
2. Supabase types + loaders (`createAdminClient`, published-only for public).
3. Admin editor page `admin/news/../meetings` (placement TBD — see open questions): logistics form, agenda builder (add/edit/reorder/delete sessions), draft/publish action.
4. Candidate tray: surface engine suggestions for the meeting date; promote-to-agenda action.
5. Public `/meetings` + `/meetings/[date]`: port prototype display; state-aware rendering (current/past/unpublished-future); prev/next strip + "This Week" affordance.
6. Repoint nav tab + footer to `/meetings`; remove `/meeting-plan` from public surface (redirect it to `/meetings` or move under admin).
7. Lint + build gate; browser walkthrough of the test-plan scenarios; publish the first real meeting.

## Open Questions — RESOLVED (Patrick, 2026-07-12)

- [x] Editor placement: **Advancement, next to Meeting Plan** — the workflow is plan → agenda; candidate tray one click away.
- [x] `/meeting-plan` fate: **redirect to `/meetings`** — launch-week bookmarks keep working; plan detail stays in admin.
- [x] Phone privacy: **name only in public** — structured contact phone renders post-login only; freeform description text remains author's choice.
- [x] Calendar link: **decoupled in v1** (default taken — no auto-created `calendar_entries` row; revisit if double entry annoys).
- [x] Archive depth: **production-era only** (default taken — no backfill of prototype `meetings.json`; can import later if wanted).

## Notes

- **Sequencing**: (1) Meetings v1 per this plan → (2) archive polish → (3) signups. Signups (`session_signups`: session FK, person, participant/instructor, interested/committed) are explicitly **out of scope** until Phase 4 per-user Supabase Auth lands — there's no "who" to commit as until then. The schema shape here is what makes that phase cheap. Instructor commitments should eventually feed back into the plan engine so it stops suggesting sessions nobody will teach.
- **Design intent (Patrick, 2026-07-12)**: Meeting Plan is excellent for planning but "not the final decision of what's going to happen at any meeting" — plan feeds agenda as candidates; leader is editor-in-chief. Matches the "simplify, don't layer" preference: one authoritative public artifact, engine stays advisory.
- Prototype's `data/meetings.json` is already an array with per-meeting `meta.lastUpdated`/`updatedBy`/`source` — it anticipated the archive; reuse its field vocabulary.
- Related: `Plans/Meeting-Plan-Advancement-Suggestions.md` (engine), `Agents/Architect/Memory/DECISIONS.md` (event classification), memory notes on Meeting Plan v0.21 rules.
- Consult tech-lead (3+ files, new tables) and ux-lead (public UI) at activation, per governance.
