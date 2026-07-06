---
name: populate-mb-requirements
description: Parse pasted official BSA merit badge requirement text into a condensed two-level requirement tree, present a draft for approval, then write it to Supabase and mirror it into data/advancement.json. Use when the user pastes merit badge requirements or asks to populate the merit badge catalog with requirements.
model: claude-sonnet-5
---

# Populate Merit Badge Requirements

Turns pasted official BSA requirement text (from scouting.org / the pamphlet)
into rows in `merit_badge_requirements`, following the condensed-label pattern
established for Cooking. One badge per invocation; the user reviews and
approves a draft before anything is written.

## Workflow

1. **Identify the badge.** Match the badge name from the pasted text against
   the `merit_badges` catalog (`id` column, e.g. `citizenship-community`). The
   catalog list also lives in `data/advancement.json` → `meritBadges`. If the
   badge isn't in the catalog, stop and ask — don't invent an id.
2. **Check current state** (read-only, anon key is fine):
   - Existing rows in `merit_badge_requirements` for this `mb_id` — if any,
     tell the user they will be replaced.
   - Active ledger codes: `ledger_active` where `kind =
     'merit_badge_requirement'` and `code like '<mbId>-%'`. Any referenced
     code (the part after `<mbId>-`) MUST keep the same code in the new tree.
3. **Parse and condense** the pasted text (rules below).
4. **Present the draft** in chat as an indented list or table showing
   `code · rule · label` for every node, plus any warnings (rows to be
   replaced, ledger codes that constrain the draft, judgment calls made while
   condensing). Ask the user to edit or approve. Do not write anything yet.
5. **On approval:**
   a. Write the tree as JSON to a scratch file:
      `{ "mbId": "<id>", "requirements": [ ...nodes ] }`.
   b. From `next-app/`, run `npm run set-mb-reqs -- <path-to-json>`.
      The script is replace-on-save with ledger-orphan and duplicate-code
      safety checks (`--force` to override, only with user consent).
   c. Mirror the same node array into `data/advancement.json` under
      `meritBadgeRequirements.<mbId>` (create or replace the key). This keeps
      `npm run seed` — which truncates ALL requirement trees and re-inserts
      from that file — from destroying the work on its next run.
   d. Verify: re-query the DB for the badge and confirm the row count matches
      the draft. Report the count to the user.

## Node shape

Same shape as `advancement.json` `meritBadgeRequirements` entries (this is
what both the script and the JSON mirror consume):

```json
{ "code": "9", "label": "...", "complete": "n-of", "completeN": 2, "children": [
  { "code": "9a", "label": "..." }
]}
```

`complete` defaults to `all`; only include `completeN` with `n-of`.

## Parsing rules

- **Codes:** top-level requirements are `1`, `2`, …; lettered sub-requirements
  are `1a`, `1b`, …. Two levels only — never create a third level.
- **Optionality:** "Do the following" (or no preamble) → `all`.
  "Do ONE of the following" → `any`. "Do TWO/THREE/N of the following" →
  `n-of` with `completeN`. An "OR" inside a single requirement's prose is
  wording, not structure — fold it into that node's label.
- **Embedded numbered lists** inside a sub-requirement (e.g. Citizenship in
  the Community 2a lists four categories of places to map) are folded into
  that node's label as a condensed parenthetical — they never become children.
- **Trailing boilerplate** ("Print Requirements", "Revised …", worksheet
  links) is dropped, but note the revision date in the draft message so the
  user knows which edition was parsed.

## Label style (condensed, Cooking pattern)

- Short imperative summaries, target ≤ ~90 characters. Scan-friendly in the
  Fast Entry picker beats verbatim fidelity — the official text stays in the
  pamphlet.
- Keep the requirement's verb ("Discuss", "Demonstrate", "Plan") and its
  measurable specifics (quantities, durations, counts: "at least eight
  hours", "20 nights").
- Parents whose official text is just a stem ("Do the following:") get a
  short topic label derived from their children (e.g. "Health and safety",
  "Charitable organizations and volunteering").
- Drop procedural padding ("with your counselor's and a parent's approval",
  "discuss with your counselor") unless the approval/discussion IS the
  requirement.

## Troubleshooting

- Sandboxed Git Bash can crash on this machine
  (`fatal error - add_item ... errno 1`). Re-run the command with the sandbox
  disabled.
- The scripts need local Supabase running (`supabase start` from `next-app/`)
  and read keys from `next-app/.env.local` via `tsx --env-file`.
- Admin pages read the DB per request — a browser refresh shows the new tree;
  no revalidation step is needed for script writes.

## Known state (as of 2026-07-05)

- Populated via this skill (condensed + mirrored to advancement.json):
  `citizenship-community`, `citizenship-nation`, `citizenship-world`,
  `first-aid` (2025 edition; old-edition ledger codes 2c and 12e–12p were
  orphaned with user consent — ~8 scouts continue under the old edition),
  `woodwork` (2025 edition restructured from 6 to 7 top-level reqs; codes
  `3c`/`5a`–`5d` orphaned and `1a`/`1b`/`1c`/`2a`/`2b` silently changed
  meaning, both with user consent — 23 scouts have active sign-offs against
  the old structure and now need re-mapping or to be treated as
  grandfathered under the old edition).
  `camping` (2025 edition; numbering shifted almost entirely — 6 codes
  orphaned (`2a`–`2c`, `3a`–`3c`) and 15 more silently changed meaning; only
  1 scout affected but every one of that scout's 21 sign-offs collided,
  proceeded with user consent).
- Still prototype paraphrases: `cooking` (has known typos to fix later).

**Heads up for future badges:** when a badge already has authored
requirements AND active ledger sign-offs, check not just for codes *missing*
from the new tree (the script catches this) but codes that *survive with a
different meaning* (the script can't catch this — only a side-by-side read of
old vs. new labels will). Flag both kinds of collision before asking for
approval, and total how many distinct scouts are affected
(`ledger_entries` distinct `scout_id` for that mb_id, active rows only) so the
user can gauge blast radius.
