# Meeting Plan — Suggested Advancement per Scout & Group

**Status:** Built (Phase 1 code complete 2026-07-11; awaiting migration apply + live verification)
**Parked:** 2026-07-11
**Priority:** High

## Overview

An **on-demand** Meeting Plan generator that turns the advancement ledger into an actionable troop-meeting agenda: for each active scout, a short list (max 3) of next-rank requirements they could realistically complete *at a troop meeting*, plus group sessions that cluster scouts who need the same requirement (capped at 8 per group), each with a qualified teacher — adult leader or authorized older-scout Instructor. A leader picks a meeting date (default: next Sunday, the troop's meeting day) and generates a plan for it; themed meetings (single-MB nights, campout prep) simply don't get one. Generated plans publish to the public site.

## Problem / Opportunity

Meeting planning today is manual: leaders don't have a live view of who needs what, so skills instruction defaults to generic content — too advanced for new scouts, boring repeats for older ones. The ledger already knows every scout's outstanding requirements; nothing connects that to the weekly meeting. Research confirms no mainstream scouting software (Scoutbook, TroopTrack, Troopmaster, TroopWebHost) ships a "group scouts by shared next-needed requirement per meeting" planner — Troopmaster's requirement-selection report is the closest precedent. This is a genuine gap and a high-leverage use of data we already have.

### Best-practices grounding (research, 2026-07-11)

- **BSA 7-part meeting plan** splits Skills Instruction into three simultaneous tracks by experience: **New / Experienced / Older** scouts. Group suggestions should carry this tier so they map onto how meetings actually run. (troopleader.scouting.org)
- **BSA requirement text itself** distinguishes venue — e.g., Second/First Class outdoor-activity requirements explicitly say "does not include troop or patrol meetings." Encode BSA's own wording as a `venue` tag rather than inventing a heuristic.
- **Patrol-size instruction**: patrols run 6–8 active scouts; skills breakouts are patrol-sized. The 8-person cap matches official practice.
- **Who teaches**: the **Troop Instructor** youth POR + EDGE method is the official model for older-scout teaching. But first aid instruction, Totin' Chip / Firem'n Chit sign-off, aquatics, and shooting sports require adult/certified instruction per the Guide to Safe Scouting — so "youth-teachable" must be an explicit data point, defaulting to *not* teachable.
- **Known pitfalls to design against**: overloading scouts (hence max 3 suggestions), sign-offs without real mastery (keep sign-off in Fast Entry, planner only *suggests*), stale campout-only items falling off the radar (show them grayed with a "needs outing" note).

## Acceptance Criteria

- [ ] Every leaf requirement in `rank_requirements` carries a `venue` value (`meeting` / `outing` / `either`); campout-only items never appear as meeting suggestions.
- [ ] Admin Meeting Plan page shows, for a chosen meeting date: (a) group sessions listed requirement-first, (b) per-scout suggestions capped at 3, (c) a teaching roster.
- [ ] No suggested group exceeds 8 scouts — larger cohorts split automatically (by patrol, then alphabetically).
- [ ] Each group session names qualified teachers: adult leaders matched via skills, and — only where the skill is `youth_teachable` — older scouts (Star+) who have completed that requirement themselves.
- [ ] Groups carry an instruction tier (New = pre-Tenderfoot/Tenderfoot, Experienced = Second/First Class, Older = Star+) mirroring the BSA 3-track skills block.
- [ ] Older scouts (Star+) receive merit badge suggestions alongside rank work, with Eagle-required badges (`merit_badges.eagle`) preferred; counselors matched from `merit_badge_counselors`.
- [ ] Skill-area, venue, and capacity tags are data-only (drive grouping/matching/splitting, never rendered); the UI displays only teach-authorization tags ("Older scout may teach" / "Adult sign-off" / "Adults only") and the Eagle-required marker. No jargon in tags (spell out Guide to Safe Scouting where referenced, not "G2SS"). (User feedback 2026-07-11, rounds 1–2.)
- [ ] Plan generation is on demand: leader picks a date (default: next Sunday, the troop's meeting day) and generates; no plan is auto-created for themed/campout-prep meetings. No meeting pull-down — a plan is only good for one meeting at a time, since each week's completions reshape the next plan. (User decision 2026-07-11, superseding "pick from events calendar".)
- [ ] Public site shows the published plan by scout and by group; scouts appear as **first name + last initial**.
- [ ] Suggestions derive from the same satisfaction logic Fast Entry uses (`satisfaction.ts`) — no parallel completion calculus.

## Test Plan

- [ ] `Leader_SeesOnlyMeetingVenueRequirements_WhenGeneratingPlan()` — no `venue='outing'` leaf appears in suggestions
- [ ] `Leader_SeesGroupsSplit_WhenMoreThanEightScoutsShareRequirement()` — 11 scouts sharing a requirement yield groups of ≤8
- [ ] `Leader_SeesAtMostThreeSuggestions_PerScout()`
- [ ] `Leader_SeesOnlyAdultTeachers_WhenSkillNotYouthTeachable()` — first aid group never lists a scout instructor
- [ ] `Leader_SeesScoutInstructorCandidates_WhenSkillYouthTeachableAndScoutCompletedIt()`
- [ ] `Scout_SeesOutstandingRequirement_OnlyWhenNotSatisfiedByLedger()` — completed reqs (incl. `n-of` rules) excluded via `nodeSatisfied()`
- [ ] `Family_SeesPublishedWeeklyList_OnPublicSite()`

## Technical Approach

### Data model additions (Supabase)

```sql
-- 1. Venue tag on requirement leaves (BSA's own wording drives the value)
alter table rank_requirements
  add column venue text not null default 'either'
  check (venue in ('meeting','outing','either'));
alter table merit_badge_requirements
  add column venue text not null default 'either'
  check (venue in ('meeting','outing','either'));
-- MB venue curation can start with just the Eagle-required badges (13) —
-- that covers the older-scout suggestion path without tagging all ~140 badges.

-- 2. Skill taxonomy — one small lookup doing triple duty:
--    group label, leader matching, and youth-teachability scope
create table skills (
  id text primary key,            -- 'first-aid', 'knots', 'woods-tools', ...
  name text not null unique,
  youth_teachable boolean not null default false,  -- per user: teachability is a property of the SKILL
  sort_order int not null default 0
);

alter table rank_requirements add column skill_id text references skills(id);

-- 3. Leader ↔ skill mapping (the "list of leaders and what their skills are")
create table leader_skills (
  leader_code text references leaders(code) on delete cascade,
  skill_id text references skills(id) on delete cascade,
  primary key (leader_code, skill_id)
);

-- Phase 3 (future): scout requests + instructor authorization
-- create table advancement_requests (scout_id, requirement_id, status, created_at ...);
-- create table scout_instructors (scout_id, skill_id, authorized_by, authorized_at);
```

Starter skill taxonomy (~12 rows): First Aid*, Knots & Lashings, Woods Tools (Totin' Chip)*, Fire Safety (Firem'n Chit)*, Cooking & Meal Planning, Navigation & Map, Fitness, Camping Skills, Aquatics*, Citizenship & Discussions, Teaching (EDGE), Safety & Awareness. (* = adult-only per Guide to Safe Scouting → `youth_teachable = false`, and these stay false regardless of troop preference.)

**Simplicity check** (per "one source of truth" convention): this adds exactly one lookup (`skills`) + one join (`leader_skills`) + two columns on `rank_requirements`. `venue` stays per-requirement because BSA's wording is per-requirement; `youth_teachable` lives on the skill, matching how the user described it ("whether a *skill* is authorized to be taught by an older scout"). No new completion state anywhere — the ledger remains the single source of truth for what's done.

### Suggestion algorithm (server-side, on demand)

1. For each active scout: next rank = `current_rank + 1`; load its requirement tree; mark satisfied nodes with existing `nodeSatisfied()` against `ledger_entries` (kind `rank_requirement`).
2. Candidate list = unsatisfied leaves with `venue in ('meeting','either')`.
3. Rank candidates per scout: shared-need first (requirements many scouts need score higher → better groups), then proximity to rank completion, then requirement `sort_order`. Take top 3.
4. Grouping pass: bucket the *suggested* items by requirement code; groups need ≥ 2 scouts; split at 8 (by patrol, then alpha); tag tier from the members' target ranks.
5. Teacher match: requirement → `skill_id` → `leader_skills` for adults; if `skills.youth_teachable`, also list Star+ scouts whose ledger shows that requirement complete.
6. **Older-scout MB pass:** for Star+ scouts, add merit badge candidates — unsatisfied MB requirement leaves with `venue in ('meeting','either')`, drawn from badges in progress (`mb_progress.has_any_req`) or badges with a registered counselor in `merit_badge_counselors`. Sort Eagle-required (`merit_badges.eagle`) first. These compete for the same 3-suggestion cap per scout; counselor becomes the session's teacher.
7. Campout-only outstanding items are returned separately (grayed "needs outing" list) so they stay visible.

Pure function over data already in Postgres — MVP needs **no new state tables**; the plan is computed for a given meeting date. Curation (pin/dismiss/publish) is Phase 2 and adds a `meeting_plans` table only when we know it's needed.

### Surfaces

- **Admin:** `advancement/meeting-plan` — "Planning" group in sub-nav. Leader picks a date (defaults to next Sunday) and clicks Generate; tabs: Group Sessions / By Scout / Teaching Roster. No automatic weekly generation — themed MB nights and campout-prep meetings don't get advancement plans.
- **Public:** `/meeting-plan` (linked from the advancement page) — read-only view of the published plan for the upcoming meeting (empty state when none generated); scouts shown as first name + last initial.

### Phasing

1. **Phase 1 (MVP):** schema columns + skills seed + venue curation pass over existing rank requirements; computed admin view; public read-only page.
2. **Phase 2:** leader curation (pin/remove/annotate), publish snapshot, print view for the clipboard.
3. **Phase 3:** scout accounts request "I want to work on X" → leader notification; older-scout instructor signup (`scout_instructors`); attendance-aware planning (only suggest for scouts likely to attend).

## Implementation Steps

1. Migration: `venue`, `skills`, `skill_id`, `leader_skills` (+ seed skills).
2. Curation pass: tag all rank requirement leaves with venue + skill (one-time, reviewable in Lookups & Admin).
3. Enter leader skills (small admin UI under Lookups, or seed SQL from the existing leader skills list).
4. Server module `meeting-plan/suggestions.ts` reusing `satisfaction.ts`; unit tests per Test Plan.
5. Admin page + sub-nav entry.
6. Public page.
7. tech-lead review before implementation begins (3+ files, new feature); qa-lead before deploy (new public surface).

## Open Questions

- [ ] Where should venue/skill tagging live in Admin — extend Lookups & Admin, or a dedicated requirements editor?
- [ ] Which older-scout authorization flow: blanket per-skill (`scout_instructors`) vs. per-meeting assignment?
- [ ] Publishing model: does on-demand generation imply a stored snapshot per meeting (small `meeting_plans` table lands in Phase 1 after all), or is "publish" just a flag on the generated plan? Leaning stored snapshot — the public page needs something stable to show.

## Notes

- **Reseed caveat:** `scripts/seed.ts` deletes and reinserts `rank_requirements` / `merit_badge_requirements` from `data/advancement.json`, which would wipe the venue/skill curation (columns reset to defaults). If a reseed is ever needed, re-run the curation UPDATE block from `20260711000000_meeting_plan_skills.sql` afterward — or teach seed.ts/advancement.json about venue/skill first.
- Migration `20260711000000_meeting_plan_skills.sql` must be applied via Supabase Studio SQL editor (CLI not linked on this machine).
- Prototype: `prototypes/meeting-plan/index.html` (built 2026-07-11 for reaction).
- Research + schema mapping notes captured in this plan's Best-practices section; sources include troopleader.scouting.org (7-part meeting plan, patrol method), scouting.org rank requirement PDFs (venue wording), Guide to Safe Scouting (adult-instruction skills), troopmaster.com/reports (closest software precedent).
- Existing assets reused: `rank_requirements` tree + `complete_rule`, `satisfaction.ts` (`nodeSatisfied`, `validateAwards`), `leaders`, `merit_badge_counselors` (pattern for `leader_skills`), public roster table pattern (`roster-table.tsx`).
