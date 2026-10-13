# Admin Home and Navigation — a "needs you today" home, a card hub, and a slim section menu

**Status:** Active — planning; prototype next (Brad, `prototypes/admin-home/`)
**Parked:** 2026-10-13
**Priority:** Medium
**Owner (consulting):** Jenna (macro IA, 2026-10-13); Brad (prototype)
**Supersedes in part:** `Plans/Admin-Nav-And-Consistency.md` Section 1 (the 2026-08-19 rail regroup). That plan's
Sections 2 and 3 are unaffected.

## Overview

The admin left rail has grown to 8 headings and 32 links (`_components/sub-nav.tsx`), filtered by each leader's
capabilities. Replace it with one `/admin` home: a "needs you today" inbox at the top and a grid of job-grouped cards
below (Patrick's "Amazon Your Account" idea), plus a slim top-level section menu with per-section tabs in place of
the rail. Rarely used tools move into one "Troop admin tools" card.

## Problem / Opportunity

- **Grouped by system, not by job.** Volunteers think "pay someone back", not "Finance › Reimbursements".
- **Rare tools sit in primary nav.** Styleguides, Audit Trail, Lookups & Admin, Roster Import, Utilities and Ledger
  Audit are used a few times a year. Ledger Audit is linked twice.
- **Misfiled items.** Roster under Records; Menu Monster under News & Events; the seasonal Wreath Sale in permanent Finance.
- **The Dashboard is one link among 32.** Its "Needs Attention" inbox (`advancement/dashboard/attention-items.ts`)
  covers profile updates, library and proof submissions and new members — not reimbursements, wreath orders or
  pending news — and no counts show in the nav.
- **Phones.** Even a one-capability leader gets the full rail width (~240px).
- **It will keep growing** (wreath Release C, health forms, registration, campout payments). Every new feature
  today means another rail link.

## Decisions (Patrick, 2026-10-13)

| Question | Answer |
|---|---|
| Direction | Jenna's recommendation: B (task inbox) on top of A (card hub), with a slimmed C (section menu + tabs). Search (D) deferred. |
| Does the rail need to work as a mid-task quick switcher? | **No** — Patrick opens another browser tab to jump mid-task. The rail can go. |
| Per-person pinned shortcuts | **Not now.** No storage change. |
| Next step | Write this plan, then build prototypes before any production code. |

## Proposed structure

**`/admin` (home)**
1. **Needs you today** — the attention inbox, filtered by capability, each row with a count and a link straight to
   the queue. Adds: reimbursements to approve (finance), unpaid / unassigned wreath orders while a sale is open
   (finance), news and page submissions pending (news.write), the next event with an open sign-up (calendar.write).
   Empty state: "Nothing needs you today."
2. **Card grid** grouped by job. Each card: title, one line, count badge when something is waiting. Only cards the
   leader can open render; a group with no visible cards disappears.

| Group | Cards |
|---|---|
| Advancement | Fast Entry, Ledger, MB Progress, Meeting Plan, Has/Needs, Reports (Audits, Advancement Report, Court of Honor, Scoutbook Export, Attendance Report) |
| Calendar & Content | Calendar, News, Pages, Media Manager, Photo Albums, Resource Library, Menu Monster |
| Money | Financial Ledger, Reimbursements, Activity Report, Ledger Audit, Wreath Sale (seasonal — first in the group while a sale is open) |
| People & Setup | Roster, Access |
| Troop admin tools (bottom, quiet) | Lookups & Admin, Roster Import, Audit Trail, Utilities, Styleguides |

**Section menu (replaces the rail):** a top bar under the admin header — Home · Advancement · Calendar & Content ·
Money · People · Tools — showing only sections with at least one visible item. Inside a section, its pages are a
`TabStrip`. A section with ONE visible item has no tab strip (answers the 2026-08-19 objection that top-level tabs
leave a narrow-capability leader on a mostly empty tab). Phones: the section bar scrolls horizontally or collapses
to a "Sections ▾" menu (prototype decides).

**One source of truth:** the hub cards, the section bar and the tabs all render from the existing `SECTIONS` data in
`sub-nav.tsx` (regrouped) filtered by `visibleNavSections` — never three hand-kept lists.

## Acceptance Criteria

- [ ] `/admin` lands on the home: inbox first, card grid below, for every leader.
- [ ] A leader sees only inbox rows, cards, sections and tabs their capabilities open; a section or group with nothing visible is absent, and a single-item section shows no tab strip.
- [ ] The inbox adds reimbursements, wreath orders (only while a sale is open), pending news/pages and the next open sign-up, each with a count; finance rows require finance capabilities.
- [ ] The left rail is gone; every former rail destination is reachable from the home in ≤ 2 taps and from the section menu.
- [ ] Ledger Audit appears once; Styleguides and the other rare tools live only in "Troop admin tools".
- [ ] `PageTitle`'s back slot still works: section roots are `back={null}`; the existing depth-2/3 back links are unchanged.
- [ ] The unsaved-changes guard fires when leaving a dirty form through the new section bar or tabs.
- [ ] Usable at 375px wide with no horizontal page scroll.

## Test Plan

- [ ] `AdminHome_ShowsOnlyCardsTheLeaderCanOpen_WhenGrantedOneCapability()`
- [ ] `AdminHome_HidesAGroup_WhenNoneOfItsCardsAreVisible()`
- [ ] `AdminNav_SkipsTheTabStrip_WhenASectionHasOneVisibleItem()`
- [ ] `AdminNav_HubAndSectionBarAgree_ForEveryCapabilitySet()` — one source; no orphaned or duplicated destination.
- [ ] `AttentionInbox_CountsReimbursementsToApprove_ForFinanceOnly()`
- [ ] `AttentionInbox_ShowsWreathOrders_OnlyWhileASaleIsOpen()`
- [ ] `AttentionInbox_SaysNothingNeedsYou_WhenEveryQueueIsEmpty()`
- [ ] `AdminNav_PromptsToDiscard_WhenLeavingADirtyForm()`
- [ ] `AdminNav_EveryFormerRailLinkIsReachable()` — regression list of the 32 current destinations.

## Implementation Steps (after the prototype is approved)

1. **Wave 1 (S):** `/admin` becomes the extended Dashboard; new attention categories with counts; drop the
   Styleguides rail link (route stays) and the duplicate Ledger Audit.
2. **Wave 2 (M):** card grid under the inbox, from the regrouped `SECTIONS` + `visibleNavSections`; rare tools
   into the tools card. Styleguide specimens for the card and inbox row in the same commit (AGENTS.md rule).
3. **Wave 3 (M):** replace the rail with the section bar + per-section `TabStrip`; mobile behaviour per prototype.
4. **Later, only if asked:** Ctrl-K search; per-person pins.

## Open Questions

- [ ] Phone section bar: horizontal scroll or a "Sections ▾" menu? (Prototype both.)
- [ ] Should the card grid show count badges, or only the inbox? (Risk: the same number twice.)
- [ ] Wreath Sale outside the sale season: stays in Money, or moves to the tools card until next fall?
- [ ] Reports: one "Reports" card with its five reports as tabs, or five cards?

## Shipped so far

- Wave 1 v1.214.0 (62c5ce6): /admin Home + "Needs you today" inbox.
- Wave 2 v1.215.0 (9a42628): card grid; rail regrouped from nav-data.ts. v1.216.0 (f3f9d10): /admin/reports landing.
  v1.216.1 (cdad5a6): reports also on the rail (Patrick: allowed duplication while the rail exists).
- **Wave 3 decision (Patrick, 2026-10-13):** once the rail is gone, the five reports live ONLY on the Reports landing
  page — not as tabs in the Advancement section. Advancement's tab strip carries a single "Reports" tab.

## Prototype (Brad, 2026-10-13) — `prototypes/admin-home/index.html`, awaiting Patrick's review

Brad's calls on the open questions: phone bar scrolls horizontally (kept on the current section); no counts on
cards (the inbox already shows them); Wreath Sale stays in Money off-season, last and greyed; Reports is one card
with sub-tabs. Gaps he found: Submit & Present was missing from the table (placed in Advancement); an
Advancement-only leader has no inbox rows; a Librarian sees "Calendar & Content" with no calendar in it; Ledger
Audit's route is under `/admin/utilities/`, so the Tools section lights up instead of Money; the rail has 31 links,
not 32.

## Notes

- Jenna's consult (2026-10-13) considered four options: A card hub, B task-first home, C top sections + tabs, D icon
  rail + command palette. The 2026-08-19 plan rejected top-level tabs and a command palette; the single-item-section
  rule answers the tabs objection, and the palette stays deferred for the same reason as then.
- Key files: `src/app/admin/(workspace)/_components/sub-nav.tsx`, `src/app/admin/(workspace)/layout.tsx`,
  `src/app/admin/(workspace)/advancement/dashboard/attention-items.ts`, `src/lib/capabilities.ts`.
- Admin styling rules in `next-app/AGENTS.md` apply (admin tokens, shared Button/TabStrip, PageTitle back slot).
