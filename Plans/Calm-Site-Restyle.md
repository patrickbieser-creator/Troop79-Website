# Calm Site Restyle — carry the Menu Monster style across the site

**Status:** Parked (starts after Menu Monster Scout Workspace Phase 1 ships)
**Parked:** 2026-10-02
**Priority:** High

## Overview

Bring the calm style Patrick evolved for Menu Monster to the whole Troop 79 website, **public and admin**. The reference is the approved concept-e prototype (`D:\Projects\Troop Menu Monster\prototypes\concept-e-scout-workspace\`, `css/monster.css`, `UX-BRIEF.md`) and the production Menu Monster screens built from it. Key traits: a cream page with borderless white list cards; tight ~38px list rows; few labels and outlines; quiet field labels; actions on the title line; quiet pulldowns instead of chip rows for single choices; compact `Label: [− n +]` dialers on one line; prices and counts in a fixed right column with no sublabels.

## Problem / Opportunity

Patrick, 2026-10-02: the rest of the site "suffers from the same loud UX that led to this restyling for the Menu Monster". Heavy outlines, boxed sections, uppercase labels, large controls and stacked hint text make pages long and noisy. That is worst on phones and for scouts.

## Decisions (Patrick, 2026-10-02)

| # | Question | Decision |
|---|---|---|
| 1 | Dialer size | **32px tall, number text stays 16px** (the iOS no-zoom floor, 2026-08-21). Buttons ~28px wide: smaller than the old 44px targets, still above WCAG 2.2 AA's 24px. |
| 2 | Number fields | Plain number boxes on the public site become the shared dialer: event sign-up guest counts and the reimbursement amount. **Done in Phase 1 of Menu Monster** with the shared component (see Notes). |
| 3 | Scope | **Public and admin**, after Menu Monster Scout Workspace Phase 1. Each side keeps its own token sheet (the admin↔public firewall stands); each adopts the same look in its own tokens. |
| 4 | Approach | **Jenna MACRO sweep first**: inventory the loud patterns, rank screens, propose an order. Then restyle shared components first (one change, many screens), then per-screen leftovers. |

## Acceptance Criteria

- [ ] Jenna's sweep lists every loud pattern with the screens that use it, and a ranked order.
- [ ] Shared public components (`src/app/_components/`) and admin components carry the calm style, each with an updated styleguide specimen in the same commit (AGENTS.md rule).
- [ ] `tests/design-system-census.test.ts` stays green with no growth in allowlists.
- [ ] Every restyled form still meets the save-button standard and the 16px input floor.
- [ ] A phone-width check (375px) of each restyled screen.

## Test Plan

- [ ] Census test unchanged or tightened.
- [ ] Per shared component: dom tests for behavior kept (keyboard, disabled states, aria labels).

## Technical Approach

TBD after Jenna's sweep. Likely order: tokens (spacing, borders, label style) → shared components (FormPanel/FormSection, Button, labels, list rows, tab strip) → per-screen cleanup. Admin uses the `--admin-*` sheet; public uses `globals.css`; no cross-reads.

## Implementation Steps

1. Jenna MACRO sweep (public + admin) → ranked findings.
2. Patrick picks the order.
3. Tokens + shared components, with styleguide specimens.
4. Screen-by-screen passes, a release per group.

## Open Questions

- [ ] Which screens first? (after the sweep)
- [ ] Does the cream page + white card look replace the current public page background everywhere, or only on app-like screens (forms, lists) and not on news/article pages?

## Notes

- Origin: Menu Monster restyle, D-288 / D-289 and the 2026-10-02 prototype review.
- The **shared compact dialer** (`src/app/_components/stepper`) is built during Menu Monster Phase 1 because the workspace needs it; it is the first piece of this restyle, not a one-off.
