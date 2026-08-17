# Weekly Advancement Report

**Status:** Prototype approved 2026-08-17 ("looks good, let's move forward") — ready for
implementation
**Created:** 2026-08-17
**Priority:** Medium

## Overview

A tool that generates the consolidated advancement summary Patrick currently builds by hand for
the Bugle (the troop e-newsletter) — every week or so, a list of ranks, merit badges, and
requirements scouts completed, grouped and consolidated so it stays readable even on a heavy
week. It replaces the manual process of running the `weekly-scout-advancement-summary-for-bugle`
skill against an exported spreadsheet with a live tool sourced directly from `ledger_entries`,
with two surfaces:

- **Admin:** pick a date range, generate a styled preview, review/edit, publish. Also produces a
  markdown version for pasting into the Bugle.
- **Public:** the latest published report is visible on the site as its own page/section —
  families don't have to wait for the Bugle email to see it.

## Problem / Opportunity

Today this is a fully manual process: Patrick exports or pastes rows into a spreadsheet, runs the
Claude skill, hand-reviews the output, and pastes it into the Bugle. That's real, recurring effort
every week, and the underlying data already lives in `ledger_entries` — there's no reason to leave
the app to produce it. It also only ever reaches families who read the Bugle; nothing on the site
itself shows "what got signed off this week."

The skill's own hard part — collapsing a long list of individual requirement sign-offs into a
readable, consolidated summary — is a solved problem already (see Notes). The work here is making
that logic live against real ledger data instead of a spreadsheet export, and giving it both an
admin generation flow and a public home.

## Acceptance Criteria

- [ ] **Two view modes on every generated report, admin and public alike: category view (the
      five sections below) and a scout-centric view** — the same content, alphabetically by
      scout, everything they earned in the period grouped under their name. Toggle/tab between
      them; same underlying data, just reorganized. Patrick's framing (2026-08-17): on a heavy
      week (Summer Camp being the motivating case), a scout or parent just wants to find their
      kid and confirm everything got recorded — hunting across five sections for one name doesn't
      serve that. Prototyped and validated in `prototypes/advancement-report/` before build.
- [ ] Admin screen: pick a start/end date range (inclusive), generate a report.
- [ ] **Filters on `ledger_entries.entered_at`, never `date`.** This is deliberate, not
      incidental: `entered_at` is when a leader recorded something, `date` is when the scout
      actually did it, and those diverge on purpose — a late entry or a correction made this week
      for something earned three weeks ago must show up in THIS week's report, not silently land
      in a past one nobody re-runs. Every query in this feature filters on `entered_at`.
- [ ] Date range defaults to `{last published report's end date} → today`, so generating "this
      week's" report is normally zero-typing. Still fully overridable — this session's own
      trigger (returning from Summer Camp) is exactly the case where the default range is wrong
      and needs widening.
- [ ] Five sections, all consolidated per the rules below, each omitted entirely when empty:
  1. **Ranks Earned** — `kind = 'rank_award'`
  2. **Merit Badges Earned** — `kind = 'merit_badge_award'`
  3. **Rank Requirements Completed** — `kind = 'rank_requirement'`, grouped by rank in BSA order
     (Scout → Tenderfoot → Second Class → First Class → Star → Life → Eagle)
  4. **Merit Badge Requirements Completed** — `kind = 'merit_badge_requirement'`, grouped by badge
  5. **Leadership & Other** — `kind in ('leadership', 'award', 'service_hours', 'camping_nights',
     'hiking_miles')` (settled 2026-08-17 — logistics/participation kinds ARE in scope, reversing
     the plan's earlier lean; Patrick's call, not the "advancement only" assumption this plan
     started with)
- [ ] **Consolidation rule** (ported from the skill, generalized from "per rank" to "per rank OR
      per badge"): within each rank (section 3) or each badge (section 4), a requirement with
      exactly one scout is a "solo req." A scout with two or more solo reqs in the same
      rank/badge collapses onto one line (req numbers + labels comma-joined, name once). A
      requirement held by two or more scouts always renders as its own line, never folded into
      anyone's consolidated line. See the skill's own worked example in its SKILL.md.
- [ ] Requirement/badge text comes straight from `rank_requirements.label` /
      `merit_badge_requirements.label` — confirmed already short and newsletter-ready (sampled
      real data: "Nosebleed", "Pack for Overnight Campout", "Closed wounds (bruise, hematoma)").
      **No AI/keyword-reduction step** — that was only ever needed because the skill's spreadsheet
      input carried full raw BSA requirement text; the app's own tables don't.
- [ ] Admin shows a styled preview matching how it'll read once published, AND a markdown export
      for pasting into the Bugle tool (both from the same generated content — not two separate
      generation paths).
- [ ] The generated content is editable before publishing (typo fixes, a note added, a scout
      removed at a family's request) — the auto-generated version is a draft, not the final word.
- [ ] Draft → Published, matching this app's existing pattern (`articles`, `calendar_entries`,
      `library_resources` — status column, public reads only published). A published report is a
      point-in-time snapshot: correcting a ledger entry next week must not silently rewrite what
      already went out in an already-published report or the Bugle.
- [ ] Public page shows the most recently published report (and probably an archive of past ones
      — see Open Questions on IA/placement).
- [ ] Gated on `advancement.write` (same capability that gates Fast Entry / the Ledger / Roll
      Call) for generating and publishing.

## Technical Approach

**New table, snapshot-based, not a live view.** A published report is content, the same way an
`articles` row is — captured at generation time, editable while in draft, frozen once published.
This matches how every other periodic/dated content type in this app already works and avoids the
surprising case of a newsletter's own online copy silently changing after the fact because someone
fixed an unrelated typo in the ledger weeks later.

```
advancement_reports
  id              bigserial primary key
  start_date      date not null
  end_date        date not null          -- both bounds of the entered_at range, inclusive
  status          text not null default 'draft' check (status in ('draft','published'))
  content_json    jsonb not null         -- the REAL source of truth (see below)
  content_md      text not null          -- derived cache of content_json, category view only
  generated_at    timestamptz not null default now()
  generated_by    text                   -- leader label, same convention as ledger_entries.by /
                                          -- articles.author_name / calendar_entries.author_name —
                                          -- NOT a people FK; this is attribution, not a grant
                                          -- (tech-lead review, 2026-08-17 — the FK carve-on
                                          -- person_capabilities.granted_by doesn't apply here)
  published_at    timestamptz
  published_by    text
  corrected_at    timestamptz
  corrected_by    text
  created_at      timestamptz not null default now()
```

**`content_json` is the real source of truth, not `content_md` — revised 2026-08-17 (tech-lead
review) from the plan's original "markdown is the single source" framing, which doesn't survive
publish.** The prototype's `buildScoutView()` regroups the *structured* report object the
consolidation pass produces — it never touches rendered markdown, and reconstructing a scout view
by re-parsing markdown text back into `{code, label, scouts, entries}` objects would be fragile in
exactly the way this plan elsewhere warns against. So: `content_json` stores that structured object
(the same shape `buildReport()` returns in the prototype); `content_md` is *derived* from it —
recomputed on every draft regeneration and on publish, kept only so the Bugle export and the
category-view's `ArticleBody` markdown render have something to consume without recomputing on
every read. Both the category view AND the scout-centric view are rendered LIVE from
`content_json` at read time (admin preview, public page, every archived permalink) — cheap
in-memory regrouping of an already-small object, not a query, and exactly what the prototype
already validated at heavy-week volume. Edits (remove-scout, label edit) mutate `content_json`
first; `content_md` regenerates from it before save, so the two can never drift apart.

**Overlap check before publish, app-level, not a DB constraint** — matches this codebase's existing
style (e.g. `isDuplicateLedgerEntry`) rather than an `EXCLUDE` constraint this app doesn't use
elsewhere. Refuse to publish a report whose `[start_date, end_date]` overlaps an already-published
report's range — the failure mode without this is a scout's entry silently appearing in two
different published reports with no way to notice.

**Query shape**, one pass per section, all scoped to `entered_at between start and end` (inclusive
of the end date's full day), `archived_at is null`, `deleted_at is null`:

- Sections 1–2 (awards): `ledger_entries` joined to `ranks`/`merit_badges` for display names,
  grouped by rank/badge, scouts listed underneath.
- Sections 3–4 (requirements): `ledger_entries` joined to `rank_requirements`/
  `merit_badge_requirements` on the composite code (same `{parentId}-{code}` join shape
  `lib/library.ts`'s `rankReqKey()` already uses) for the label, then the consolidation pass
  described above.
- Section 5: `ledger_entries` where `kind in (...)`, label as-entered.

**Every section query uses `fetchAllRows()` (`lib/supabase/paginate.ts`), not a bare `.select()` —
non-negotiable, not just for sections 3–4 (tech-lead review, 2026-08-17).** PostgREST silently
truncates at 1000 rows with no error (D-028's lesson). This feature's entire reason for existing is
absorbing wide catch-up ranges — the sampled heavy week alone was 681 merit-badge-requirement rows;
a genuinely wide range (several missed weeks, the exact scenario motivating this feature) can
plausibly clear 1000 on its own. Unlike `loadScoutRankProgress`/`loadScoutMbAwardMap` (provably
small, scoped to one scout), these queries are scoped to a date range with no upper bound on row
count.

**Regenerating a draft always re-runs the query live** against the stored date range — only
publishing freezes it into `content_json` (`content_md` regenerated alongside it). Re-running after
edits is expected and cheap; there's no version history beyond "the current draft" and "what's
published."

**Port the prototype's pure functions near-verbatim**, don't re-derive from this plan's prose —
`RANK_ORDER`, `sortKey`/`cmpCode`, `consolidateGroup`, `datesOutOfRange`, `entriesForScoutSlot` in
`prototypes/advancement-report/assets/advancement-data.js` are the tested reference implementation
(tech-lead review, 2026-08-17).

**IA note:** `/advancement` already has a `page.tsx` (the existing tracker) — this needs subroutes
(`/advancement/report`, `/advancement/report/[id]` for archived permalinks), not a collision with
the existing index.

## Implementation Steps

1. ~~**Prototype first** (Brad)~~ — **done, approved 2026-08-17.** Category view, scout-centric
   accordion view, admin generate/edit/publish flow, and the per-entry date rule all validated in
   `prototypes/advancement-report/` against real heavy-week volume.
2. Migration: `advancement_reports` table.
3. Report-generation query module (`lib/advancement-report.ts` or similar) — the five section
   queries + consolidation logic, unit-testable independent of any UI (same pattern as
   `lib/library-data.ts`).
4. Admin screen: date range picker (defaulted per the acceptance criteria), generate, edit,
   markdown export, publish/unpublish.
5. Public page + IA placement (resolved in prototype).
6. Migrate the `weekly-scout-advancement-summary-for-bugle` skill's role — likely stays for
   one-off historical/external-spreadsheet cases, but the live tool becomes the normal weekly
   path. Confirm with Patrick once the tool ships whether the skill should note that in its own
   description.

## Decisions (settled 2026-08-17, after reviewing the prototype)

1. **Site placement: under `/advancement`.** Both admin and public surfaces live there, not under
   News & Events.
2. **Public archive: yes.** Past published reports stay reachable, each with its own permalink —
   not just the latest.
3. **Section 5 scope: `leadership`, `award`, `service_hours`, `camping_nights`, `hiking_miles`.**
   Reverses this plan's earlier "advancement only" lean — Patrick wants logistics/participation
   kinds included, not just leadership and special awards.
4. **Per-entry dates: shown only when the earned date falls outside the report's own date range.**
   Not the skill's fully date-free style, and not an always-on date either. Most advancement
   happens within days of being entered, so the report's headline range (built from `entered_at`)
   almost always covers the earned date too — no date needed on those lines. The exception this
   exists for: a scout credited for something completed a long time ago (a backfilled correction,
   credit for prior experience, etc.) needs a visible way to know that got recorded correctly,
   which a silent, dateless line can't show. Rule: show the earned `date` on an entry only when
   `date < start_date OR date > end_date` for that report.
5. **Correction path: agreed as prototyped** — unlock a published report, edit in place, re-save;
   `published_at` stays fixed, a `correctedAt` timestamp is added and shown alongside it. No full
   revision/version trail.
6. **First-run default: agreed as prototyped** — with no prior published report, both date fields
   start blank and Generate is disabled until a range is picked.
7. **The ★ EAGLE inline-tag treatment for Eagle-required badges (replacing the skill's separate
   "Eagle-Required Merit Badges" section) is approved** — Patrick: "I do like the *Eagle approach
   better than the old skill. Cleaner."
8. **Scout-centric view: built, tested, and approved.** Every report (admin, public, and every
   archived permalink) gets a **By Category / By Scout** toggle. By-Scout is derived from the same
   consolidated data as By Category — not a second query/aggregation — grouped alphabetically by
   scout, everything they earned that period under their name. Rendered as an **accordion**
   (collapsed to name + item count by default; multiple scouts can be open at once; Expand
   All/Collapse All provided) — built as a plain button + hidden `<div>` toggle, deliberately NOT
   `<details>`/`<summary>` (this codebase has a real production incident from that mechanism,
   D-070, 2026-07-19 — content silently un-overridable-by-CSS when closed). Supports a shareable
   per-scout deep link (`?view=scout&scout=Name`) that auto-expands and scrolls to just that
   scout's card. The per-entry out-of-range date rule (decision 4) applies identically in this
   view. Validated in the prototype (`prototypes/advancement-report/`) against the same heavy-week
   sample volume as the category view, including a full publish → cross-tab → public page
   round-trip.

## Notes for implementation (from the prototype pass)

- **Known minor gap, acceptable to ship with:** when a consolidated line joins multiple
  requirement codes for one scout and only one of the joined codes is a backfill/out-of-range
  entry, the date note correctly still shows (no false negative) but can't yet indicate which of
  the joined codes triggered it. Not hit in realistic testing; revisit only if it turns out to
  confuse readers in practice.
- Reuses `prototypes/resource-library/index.html`'s existing accordion pattern rather than
  inventing a new one — match that when porting to real components.

## Notes

- Parallels `weekly-scout-advancement-summary-for-bugle`
  (`C:\Users\pat\.claude\skills\weekly-scout-advancement-summary-for-bugle\SKILL.md`) closely
  enough that its consolidation rules and worked examples are the reference spec for this
  feature's grouping logic — read that file before implementing the query/consolidation module,
  don't re-derive the rules from scratch.
- `ledger_entries` schema confirmed via `next-app/supabase/migrations/20260525000000_initial_schema.sql`
  (base columns) and `20260527000000_ledger_kind_additions.sql` /
  `20260706000200_ledger_kind_day_outing_fundraiser.sql` / `20260712060000_ledger_kind_meeting_attendance.sql`
  (the full `ledger_kind` enum, built up over several migrations — not all in one place).
- `rank_award` entries are themselves auto-created by a Board-of-Review trigger
  (`20260712040000_auto_rank_award_on_bor.sql`, `20260721000000_scout_rank_auto_award.sql`) — no
  special-casing needed here, they're ordinary `ledger_entries` rows by the time this feature
  reads them.
- Matches this app's existing draft/published content pattern (D-080/D-096-adjacent) rather than
  inventing a new one — see `articles.status`, `calendar_entries.status`,
  `library_resources.status`.
