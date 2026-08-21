# Admin Design System — Tokens, Shared Components, and Inline-Style Remediation

**Status:** Active — Foundation shipped 2026-08-21; Phases A–D queued
**Created:** 2026-08-21
**Priority:** Medium (High for the Phase A bug items)

## Overview

Standardize the Leader Workspace's CSS: one global token sheet, shared components for the
patterns every screen currently re-implements, and conversion of 162 redundant inline styles
into classes. Driven by a three-part audit (2026-08-21) of all 35 admin `module.css` files and
174 inline `style={{}}` sites. The living reference is **/admin/styleguide**, which renders the
canonical patterns from the real production stylesheets and shows surviving variants side by
side until remediation retires them.

**Architecture (decided by Patrick 2026-08-21):** global `--admin-*` tokens on `:root`
(`admin.css`) + shared React components in `(workspace)/_components/` carrying both styling and
behavior. Per-screen `module.css` shrinks to screen-specific layout. Explicitly rejected:
global utility classes only (can't share behavior), Tailwind migration (largest blast radius).

## Problem / Opportunity

The audit's headline numbers:

- **Tokens:** only 22 existed, module-scoped to `.adminRoot` (which forced the
  `#admin-popover-root` portal workaround). 1,680 `var(--admin-*)` reads, 92% with no
  fallback. **13 declarations read phantom tokens that were never defined** (`--admin-gray-600`
  ×11, `--admin-gray-800` ×2) and silently did nothing.
- **Color drift:** 160 distinct hex literals. 7 near-identical greens, 8+ reds, a 10-variant
  pale-red tint cluster across 11 files. `#1e3a4a` (the navy token's exact value) hardcoded 26
  times. Two exact public-palette leaks: `#3d5a3e` (public forest, 10×) and `#8b6914` (public
  bark, 14× across 8 files). Five files (library, article-editor, media-picker,
  date-picker-field, markdown-block-tools) read zero admin tokens and style off the public
  system instead.
- **Class duplication:** tab strips re-defined in 18 files, tables in 15, `.pageTitle` in 26;
  4 naming families for badges, 4 for tabs, 4 for error notices, 2 for cards.
- **Inline styles:** 174 sites; 162 convertible, 12 legitimately dynamic. Top pattern: bare
  `textAlign:'right'` ×23 while `.numCell` already exists in ledger/finance. `login` and
  `rosters` pages have no stylesheet at all.

## Acceptance Criteria

- [x] **Foundation (shipped 2026-08-21):** tokens on `:root` in `admin.css`; full scales
      (spacing, type, weights, tracking, radii incl. pill/circle, shadow-lg, transition,
      status backgrounds, gray-600/800, danger-dark, accent-gold); `.adminRoot` keeps layout
      only; `/admin/styleguide` live with canonical + variant specimens and the scoreboard.
- [ ] **Phase A** complete: shared `AddButton`, `Badge`, `TabStrip`, `ActionsMenu` components
      adopted by every screen the scoreboard lists; the dialog centering fix applied to
      meetings/albums/media-manager; `.adminLabel` utility exists; primary/danger button
      design decisions made and applied.
- [ ] **Phase B** complete: table clusters normalized, card/panel merged, `.pageTitle` and
      notice components shared, `access.module.css` off rem units, non-pill tab decision made.
- [ ] **Phase C** complete: ≤ 20 inline `style={{}}` sites remain under `admin/` (the 12
      dynamic ones + genuinely one-off cases, each commented); hex-literal count in admin
      modules reduced ≥ 80%; zero public-token reads from admin styles.
- [ ] **Phase D** complete: styleguide variant specimens deleted as their copies retire; the
      scoreboard shows every row struck.
- [ ] Each phase lands with the full quality gate green AND a browser screenshot pass on the
      screens it touched (35 screens, no visual regression tests — eyes are the gate).

## Test Plan

Most of this work is CSS with no unit-testable logic; the testable surfaces:

- [x] Nav visibility for the styleguide item — covered by existing
      `admin-nav-capabilities.test.ts` behavior (capability-less item ⇒ fullAdmin only).
- [ ] `SharedTabStrip_RendersCount_WhenCountProvided()` — Phase A, dom project.
- [ ] `SharedActionsMenu_FiresHandler_WhenOptionPicked()` — Phase A, dom project.
- [ ] `SharedBadge_MapsSemanticVariant_ToStatusToken()` — Phase A, dom project.
- [ ] Per-phase: `npm run lint && npm run typecheck && npm run test && npm run build` +
      manual screenshot sweep of touched screens.

## Technical Approach

**Foundation (shipped).** `(workspace)/admin.css` defines all tokens on `:root`, imported by
the workspace layout. The 22 legacy values are byte-identical (zero visual change). New tokens:
`gray-600` (#666 — matches what every fallback already rendered, so the 11 dead reads now
resolve with no visual delta), `gray-800` (#2a2e34 — the 2 dead roster-import reads take
effect for the first time; tiny deliberate visual delta), `danger-dark`, `accent-gold`, 4
status backgrounds, `radius-lg/pill/circle`, `shadow-lg`, `transition`, spacing scale 1–14,
type scale 2xs–4xl, weights, tracking. Phantoms `--admin-bark`, `--admin-green-50/700` were
deliberately NOT defined — their reads carry fallbacks that work today; they get renamed to
real tokens in Phase C instead (defining them now could shift rendering).

**Shared components (Phase A)** live in `(workspace)/_components/`, the pattern
`date-picker-field` already proves. Each carries its own `module.css` written token-only.
Canonical sources per the audit: addBtn ← calendar (4-way identical block), pill tabs ←
calendar (normalize `.tabOn`/`.tabActive`), badge ← meetings `.statusPill` base at pill
radius, ActionsMenu ← finance `.select` (7 identical copies; roster + calendar's divergent
ones adopt it — a deliberate, visible change on those two screens).

**Sequencing rule:** convert one screen at a time, screenshot before/after, never a big-bang
sweep. The styleguide's variant specimens are the work queue — delete each as its copy dies.

## Implementation Steps

1. **Phase A — shared components + bug fixes** (highest value density):
   a. `AddButton`, `TabStrip` (with count pills), `Badge`, `ActionsMenu` in `_components/`.
   b. **Dialog: spec APPROVED by Patrick 2026-08-21** — designed and staged on the
      styleguide (`.dialogSpec*` in `styleguide.module.css`): shadow-lg, radius-lg,
      navy-tinted blurred backdrop (`color-mix`), `@starting-style` entry motion with
      `prefers-reduced-motion` guard, banded gray-50 header/footer zones, danger variant.
      Phase A extracts these classes into the shared `Dialog` component, converts the 4
      legacy `<dialog>` screens (which also delivers the centering fix — `margin:auto;
      max-height:88vh; overflow-y:auto` — to meetings/albums/media-manager, a live bug),
      and then the other dialog families (ledger/roster/lookups `editDialog` etc.).
      Until then, NEW dialogs copy the approved spec from the styleguide, not calendar's
      legacy `.dialog`.
   c. `.adminLabel` eyebrow utility (11px/700/uppercase idiom — re-declared in 32 of 35 files).
   d. Design decisions (Patrick): primary button (court-of-honor navy vs workbench forest),
      danger treatment (outlined vs solid), roster's navy addBtn (intentional or convert?).
   e. Adopt screen-by-screen: News, Calendar, Meetings, Albums first (already identical —
      pure swaps), then the drift cases (lookups, roster, roster-import, roll-call).
2. **Phase B — structural consolidation:** table clusters (compact + wrapped-card), card/panel
   merge, shared PageTitle + Notice, `access.module.css` rem→token pass, non-pill tab
   decision (meeting-plan/library/media-picker/court-of-honor keep or fold).
3. **Phase C — inline-style + literal sweep**, screen by screen, worst first: Lookups editors
   (47 sites), fast-entry picker (14 + the marginBottom:4 ×11), library workstation, login
   (needs a new `login.module.css`), rosters (needs any stylesheet). Replace hex literals with
   tokens in the top-drift files: fast-entry, lookups, meeting-plan, ledger, roster-import.
   Retire the 5 public-token leak files onto admin tokens. Rename phantom `--admin-bark` /
   `--admin-green-*` reads to real tokens.
4. **Phase D — closeout:** delete retired variant specimens from the styleguide, strike
   scoreboard rows, final audit grep to confirm the Phase C acceptance numbers.

## Open Questions

- [ ] Primary button canonical: navy (court-of-honor) or forest (workbench)? (Phase A-d)
- [ ] Danger buttons: outlined, solid, or both-with-rules? (Phase A-d)
- [ ] Roster's navy addBtn — deliberate differentiation or convert to green? (D-159 left it
      visible but unconverted)
- [ ] meeting-plan's navy table header — keep as intentional emphasis or normalize?
- [ ] Fold the non-pill tab variants into one component, or bless two tab patterns?

## Notes

- **`library.module.css` is radioactive:** imported by 20 public-route files (signin, member,
  advancement reports, news submit…). Its classes (`.tab`, `.statusPill`, `.pageTitle`,
  `.fieldHint`, `.btnPrimary`…) must never be restyled from the admin side; the library
  workstation needs its own scoped classes first (existing backlog item, D-160).
- **Possible real bug found by the audit, parked for Patrick:** `media-picker.tsx:368`
  hardcodes `style={{width:'70%'}}` on `.progressFill` — looks like an unfinished progress
  indicator shipping a mock value.
- Inline styles that FIGHT their own module (fix by modifier, not conversion):
  `ledger-table.tsx:233` (th right-align vs module's th left rule), `.hint` + `marginTop:8`
  ×3 (court-of-honor ×2, report), `reconciliation-finding-row.tsx:66` vs `.fillRow`,
  the Lookups editors' `marginBottom:10` ×5 duplicating `.addPanel`'s own margin.
- The full audit outputs (per-site inline-style list, per-family drift quotes, complete
  hex census and mapping table) were produced 2026-08-21 by three subagents; this plan and
  the styleguide condense them. Re-run the greps if precision is needed later — the numbers
  here are the durable summary.
- Related: `Plans/Admin-Nav-And-Consistency.md` Section 2 (cross-module consistency sweep)
  overlaps Phase B — fold its checklist in when Phase B activates.
- Decision record: D-162 (Architect memory).
