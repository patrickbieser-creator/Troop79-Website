# Webelos on the Roster

**Status:** SHIPPED v1.265.0 (2026-11-12, ff1be7df + ac7bd173); seven Webelos converted in production the same day.
**Asked:** 2026-11-12 (session 78). Supersedes the "Webelos are named guests" model in
[[webelos-families]] for youth the troop expects to cross over.

## Goal

Webelos who are on their way into the troop become real roster people with a troop scout ID.
They sign up for events like scouts (Adult / Scout / Webelos / Guest), and their families are
captured and kept engaged. Advancement can be TRACKED for them (e.g. Climbing MB at the Nov 15
climbing night) and counts once they cross over. They stay out of every advancement report,
the public clipboards, the planner, the Scoutbook export and the BSA roster check until then.
Crossing over is a leader action, like "Promote to adult" for an 18-year-old.

Not now: a "show Webelos" toggle on the advancement and library screens (Patrick: foreseeable,
do not build).

## Facts that shape the design

- Advancement lives in `ledger_entries.scout_id → scouts(id)`. A Webelos needs a `scouts` row
  to hold any advancement. A guest person cannot.
- Scout IDs are typed by a leader (no minting). The letter is the joining cohort: A ≈ 2020,
  B, C, D, E = 2025–26 joiners. The add-scout form already suggests F01.
- Almost every EXCLUDE site (reports, clipboards, planner, library counts, wreath sellers,
  Menu Monster patrols, Scoutbook export, BSA roster check, ~12 meeting SQL functions) filters
  on `scouts.active = true`. The INCLUDE sites (sign-up lists, households, attendance, roster,
  profile, money) go through a few loaders: `person_directory`, `lib/households.ts`,
  `lib/scout-row.ts`, `default_participant_class`.
- Age-out today: `promoteScoutToAdult` (lookups/actions.ts) + a "Turning 18 soon" roster
  callout + "Promote to adult" on the person record.

## Design (recommended)

**A Webelos is a `scouts` row with `is_webelos = true` and `active = false`.** Because nearly
every scout-only feature already filters `active = true`, Webelos are excluded from all of
them with no change. The work is the short list of places that must INCLUDE them, plus the few
ledger-driven reports that do not check `active`.

1. **Schema:** `scouts.is_webelos boolean not null default false`;
   CHECK `not (is_webelos and active)`; `scouts.crossed_over_on date` (with its `_from_1900`
   CHECK). `inactive_reason` stays null for a Webelos (it means "left").
2. **person_directory:** new tab `webelos` (a scouts row with is_webelos); `inactive_scout`
   no longer catches them; not in the adult picker.
3. **Roster admin:** a Webelos tab; "Add Webelos" (same form as a scout: ID suggested as the
   next in the current cohort letter, BSA ID optional); person record shows "Webelos" and a
   **Cross over** action (sets active, clears is_webelos, stamps crossed_over_on, asks for the
   BSA ID if missing). A "Ready to cross over" callout, like "Turning 18 soon".
4. **Sign-ups:** `lib/households.ts` lists a Webelos with the household's youth;
   `default_participant_class` / `defaultClassFor` give class `webelos`; prices at the scout
   tier (already true for class webelos). Event roster, roll call and attendance show them,
   labelled Webelos.
5. **Recording advancement:** Fast Entry and the ledger pickers include Webelos, marked
   "Webelos", so a leader can record Climbing MB work.
6. **Ledger-driven reports that don't check active** (advancement-report, court of honor,
   attention items, ledger audit, snapshot, Bugle advancement summary, public scout page,
   sitemap, `trg_auto_scout_rank_award`): exclude rows whose scout is a Webelos. One shared
   helper or view (`troop_scouts`) so this is one rule, not twelve.
7. **Convert the current seven** (Helkowski, Kroening, Rankin, Jalan, Gabbard, Moojen,
   Malacara): create each youth as a Webelos in their existing household; Logan's guest record
   (201) merges into his so his Nov 15 sign-up and $20 payment follow.
8. **Guest pricing** (the $0 problem): guests still exist for one-off visitors; they get the
   matching price tier automatically and appear in "Your household total" (option 1 from
   2026-11-12).

## Decisions (Patrick, 2026-11-12)

1. **IDs:** the next cohort letter at entry (F01…), kept through crossover. Never re-keyed.
2. **Dates:** advancement done as a Webelos keeps its real dates at crossover.
3. **Engagement:** Webelos families join the Bugler / EmailOctopus list (tagged Webelos
   family). Event reminders, a Webelos patrol and wreath selling: not now.
4. **Conversion:** after the feature works end to end. Until then Webelos stay guests, so guest
   pricing (item 8) ships first, before the Nov 15 climbing night.

## Tech-lead must-fixes (folded into the build)

- **"No active scout row" is used as the test for "adult"** (`authorized-adults.ts:99`, D-102,
  the teaching-skills adult rule). Each such site also excludes is_webelos, or the adult-pool
  definition is fixed once.
- **Role:** decide the Webelos `person_roles` shape (D-296: an inactive scout has an ENDED
  youth_member role). Proposal: an open `youth_member` role is opened at crossover; a Webelos
  has a `webelos` role (or none). The view derives the tab from that, not only the flag.
- **scout_tenure / Left column:** the Webelos tab shows no "Left"; tenure start after crossover
  is `crossed_over_on`, not the first ledger row.
- **Sign-in:** scout-own-address sign-in (13+) is gated on `not is_webelos` explicitly.
- **Wreath sellers** ignore `scouts.active` (memory); verify a Webelos cannot become a seller.
- **One choke point for reports:** a `reportable_ledger` view = `ledger_active` joined to
  non-Webelos scouts; advancement-report, court-of-honor, attention-items, ledger-audit,
  scoutbook-export, snapshot and the Bugle summary read it; a guard test forbids them reading
  `ledger_active` directly. `ledger_active` itself is unchanged (Fast Entry needs Webelos).
- **trg_auto_scout_rank_award** skips Webelos; crossover re-runs rank evaluation.
- **Crossover is a SQL function** (atomic: active, is_webelos, crossed_over_on, role, rank
  re-evaluation, audit_log with a valid area); the server action checks capability + BSA ID.
  Plus **Undo crossover**.
- Also cover: email-recipients, newsletter-sync-db, calendar_list_counts, roll call,
  meeting-live attendance, member-viewer, finance-viewer, capabilities-admin; a merge test for
  guest 201 → Logan's scouts row (D-480 moves payment); CHECK `crossed_over_on` only when not a
  Webelos.

## Test Plan

TBD after answers — acceptance stubs per numbered design item; DB tests for the view, the
CHECK, crossover, and each excluded report.

## Implementation Steps

TBD — worktree `feat/webelos-roster`, migration DB-first, ships on Patrick's word (D-404).
