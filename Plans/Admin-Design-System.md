# Admin Design System — Tokens, Shared Components, and Inline-Style Remediation

**Status:** COMPLETE — Foundation + Phases A–D all shipped 2026-08-21; move to Plans/Completed/ after Patrick's production eyes-on
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
- [x] **Phase A** complete (2026-08-21, second session): shared `AddButton`, `Badge`,
      `TabStrip`, `ActionsMenu`, AND `Dialog` components adopted by every screen the
      scoreboard lists; the dialog centering fix applied to meetings/albums/media-manager
      (5 `<dialog>` sites across 4 screens — the recon's "4 sites" undercounted:
      meeting-editor.tsx:343 was a live 5th consumer, meetings' `.dialog` was NOT dead);
      `.adminLabel` utility exists in admin.css; primary/danger button decisions made by
      Patrick and applied (see Notes). Full gate green (666 tests), every touched screen
      browser-verified in dev with screenshots.
- [x] **Phase B** complete (2026-08-21, third session — v1.59.0): shared `PageTitle`
      (~33 pages; the 26 per-screen blocks deleted) and `Notice` (error/success/warning/info
      on the status tokens, alert/status roles; ~33 box sites) components shipped and adopted
      everywhere; table clusters normalized within themselves (compact = calendar canon incl.
      meeting-plan's normalized navy header; wrapped-card = ledger canon incl. access);
      card/panel merged onto the card canon; `access.module.css` fully off rem units (and its
      tan palette onto tokens); non-pill tab decision made (fold ALL into pill TabStrip) and
      applied (meeting-plan, coh, report, library workstation, media-picker). ALSO: the
      remaining dialog families converted to the shared Dialog — ledger ×3, finance ×6,
      lookups ×2 (mb-editor 720px), roster (scout form 860px, PersonEditor + adult-form
      hand-rolled overlays → native Dialog, gaining Esc/backdrop close — Section 2 finding #1
      closed), fast-entry req-first-card, rosters payment dialog. Exceptions documented in
      Notes. Gate green (671 tests), representative screens browser-verified in dev.
- [x] **Phase C** complete (2026-08-21, fourth session — v1.60.0): inline sites 170 → 12
      (all dynamic, each commented — under the ≤ 20 target); hex in admin modules
      371 → 59 (−84%, ≥ 80% target met; survivors deliberate: date-picker-field's
      load-bearing public-fallback chains, the categorical palettes, one on-dark amber);
      public-token reads 229 → 0 outside the sanctioned `--admin-preview-*` alias block
      (new: font tokens `--admin-font-ui`/`--admin-font-mono`, preview aliases for WYSIWYG
      parity); phantom reads renamed. login.module.css created; rosters deliberately
      shares events-admin.module.css. Library discovery: TWO library.module.css files
      exist — the admin one (3 admin importers) was fully re-tokened + dead classes
      deleted, the public one at `(public)/library/` untouched; quick-add joined the
      shared Dialog (Phase B exception closed). Gate green (671), 14-screen browser
      sweep, zero regressions.
- [x] **Phase D** complete (2026-08-21, fourth session — v1.61.0): every scoreboard row
      struck (the variant specimens were already deleted phase-by-phase; remaining
      specimens are canonical or documented deliberate exceptions). The last open row —
      eyebrow labels — closed by finishing the .adminLabel retirement: 0 true label
      re-declarations left, ~96 adminLabel call sites (5 byte-identical copies converted,
      then the drifted variants normalized onto the utility per the plan's
      drift-folds-to-steps rule — tracking .04–.12em → .08em, gray-600/700 → gray-500,
      10–10.5px → 11px; navy label accents kept as ≥(0,1,1)-specificity local overrides).
      Rules that share the typography but are OTHER patterns stay: table th, pills,
      buttons, composite headers; two distinct-role survivors documented (events
      .tileLabel, library .groupSectionLabel). Final audit grep re-confirmed Phase C:
      inline 12, hex 59, public reads 0, phantoms 0.
- [x] Each phase landed with the full quality gate green AND a browser screenshot pass on
      the screens it touched (Phase C: 14-screen sweep; Phase D: styleguide + label
      screens; production eyes-on by Patrick still recommended for the label-tracking
      deltas and meeting-plan's plan-view when a plan next exists).

## Test Plan

Most of this work is CSS with no unit-testable logic; the testable surfaces:

- [x] Nav visibility for the styleguide item — covered by existing
      `admin-nav-capabilities.test.ts` behavior (capability-less item ⇒ fullAdmin only).
- [x] `SharedTabStrip_RendersCount_WhenCountProvided()` — Phase A, dom project.
- [x] `SharedActionsMenu_FiresHandler_WhenOptionPicked()` — Phase A, dom project.
- [x] `SharedBadge_MapsSemanticVariant_ToStatusToken()` — Phase A, dom project (plus
      Dialog render/danger/backdrop-close tests and AddButton disabled — baseline 660→666).
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

**PHASE A COMPLETE (2026-08-21, second session — v1.58.0).** What landed beyond the first
slice below: shared `Badge` (6 semantic variants on the status tokens; adopted by meetings ×2,
calendar StatusPills, articles table + editor, roster scouts-table, roster-import
review-client, roll-call, court-of-honor, report — the drift tint clusters collapsed into
tokens); shared `Dialog`/`DialogHeader`/`DialogBody`/`DialogActions` implementing the
approved spec (all 5 legacy `<dialog>` sites converted: calendar-editor + entry-form +
CloneForm, meeting-editor SessionForm, albums-editor AlbumForm, media-manager Edit +
Delete — Delete uses the danger variant + solid confirm; legacy .dialog CSS deleted from all
4 modules; calendar keeps .dialogHeader/.dialogActions ONLY for the CSV import overlay and
gained .inlineActions for the workbench inline form); AddButton finished (lookups ×7 editors,
roster ×3 incl. the navy→green conversion, roll-call seedBtn; `disabled` prop added; meetings'
and albums' dead .addBtn copies deleted); the three design decisions applied (see Open
Questions); `.adminLabel` utility in admin.css; styleguide fully updated (Badge/Dialog
canonical specimens, variant specimens deleted, 6 scoreboard rows struck). Badge scope rule
documented on the styleguide: STATUS pills convert; CATEGORICAL tags (lookups rank/MB/Eagle,
meeting-plan track tags, scoutbook-export type badges, events-admin .tag) deliberately stay;
library.module.css untouched (shared with public routes, D-160).

**Phase B note:** the remaining dialog families (ledger row-actions/bulk-edit/info-cell,
roster editDialog/scout-form, lookups mb-editor/req-codes-table, finance edit-transaction/
actionModal/memo-cell/entered-by-cell, fast-entry, library quick-add, rosters roster-table,
meeting-plan?) adopt the shared Dialog in Phase B; media-picker's custom div overlay unifies
last (HIGH risk).

1. **Phase A — shared components + bug fixes** (highest value density):
   a. `AddButton`, `TabStrip` (with count pills), `Badge`, `ActionsMenu` in `_components/`.
      **PROGRESS 2026-08-21:** `TabStrip`, `AddButton`, `ActionsMenu` SHIPPED with 9 dom
      tests (baseline 650→659). Converted: TabStrip — calendar, articles, roster (page strip
      + scouts-table), roster-import (all per-screen pill-tab CSS deleted; `.tabOn`/`.tabActive`
      split gone; missing tablist roles/type="button" fixed en route). AddButton — calendar,
      articles, albums (articles' `white-space:nowrap`/`flex-shrink:0` adopted into the shared
      component). ActionsMenu — finance (canonical), calendar + roster (both divergents
      retired). **ActionsMenu COMPLETE same session:** court-of-honor, report, meeting-plan,
      scoutbook-export, and roll-call's list (a 3rd divergent — it borrowed `.dateInput`)
      converted too; a `disabled` prop added (test 10/10). Audit correction: ledger's and
      articles' `.select` are FILTER selects (persistent values) and roster-import's is a
      batch picker — none are Actions menus, correctly untouched. Dead `.select` copies
      deleted from 4 modules. Remaining in Phase A: AddButton on lookups (padding drift);
      roster navy addBtn + meetings/report green SUBMIT wait on the primary-button design
      call; `Badge` and `Dialog` components not started. Recon for the Dialog conversion
      (2026-08-21, pre-wrap): only 4 `<dialog>` elements exist in the target screens —
      calendar-editor:544, albums-editor:146, media-manager-view:212 and :320 — and
      meetings.module.css's `.dialog` block has NO `<dialog>` consumer (dead copy, delete on
      conversion). Badge recon: meetings/roster/coh status pills share the 10px-radius
      2px-8px shape with per-file tint colors (#e5efe4/#eef6ee greens, #fdf3dc/#fdf3d6
      ambers — the drift clusters); calendar's statusPill family adds borders + 999px radius.
      Small accepted deltas: roster's
      count pills gain 3px label gap (7px vs its old 4px margin); articles' tabs hydrate now
      (was a zero-JS server component); roll-call list's Actions ▾ visibly changes from
      .dateInput styling to canonical.
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
2. **Phase B — structural consolidation: COMPLETE (2026-08-21, v1.59.0).** Executed by three
   parallel forks with strict directory ownership + a parent integration pass. Beyond the
   acceptance list: meeting-plan's green Generate button (a primary the audit missed) went
   navy; the audit's dead `.pillNews`-style leftovers and events-admin's retired `.payDialog`
   chrome were deleted; Admin-Nav-And-Consistency Section 2's fold-ins landed where they
   overlap CSS consistency — dialog mechanism unified (incl. both hand-rolled overlays) and
   the two truncation quick wins (albums' dead `.linkCell` applied; calendar `.titleCell`
   got overflow-wrap). **Deliberately deferred from Section 2** (behavior features, not CSS
   consistency — now backlog): SortHeader/useSortable moved to `_components/` + adoption in
   event-editor/people-table/roster-table/calendar-editor; stretched-link row actions
   (calendar's duplicate Edit link); genuine `import` convergence of the copied
   `.editGrid`/`.editField` field CSS. **Dialog exceptions:** fast-entry's mb-focus-modal
   (its unsaved-ticks close guard needs a `closeOnBackdrop` prop on the shared Dialog first)
   and library's quick-add (styled by the public-shared stylesheet; rides with the library
   workstation scoped pass). meeting-plan's plan-view tabs/table conversion is
   code-complete but needs a production eyes-on when a plan next exists (dev regeneration is
   deliberately avoided).
3. **Phase C — COMPLETE (2026-08-21, v1.60.0).** Executed by three parallel forks
   (advancement-core / shell+events / news+library+calendar+_components) with strict
   directory ownership + parent integration, same pattern as Phase B. Numbers and
   discoveries in the acceptance entry above. Open item for Patrick: the categorical
   tints have drifted BETWEEN files (MB is #e6eef5 in scoutbook-export but #e3eee5 in
   lookups; rank is purple in records/scoutbook, blue-gray in lookups) — normalizing
   would need a `--admin-cat-mb`/`--admin-cat-rank` token pair and Patrick's sign-off
   (the Badge scope rule says categorical stays, so left as commented literals).
   Original queue for reference: Lookups editors
   (47 sites), fast-entry picker (14 + the marginBottom:4 ×11), library workstation, login
   (needs a new `login.module.css`), rosters (needs any stylesheet). Replace hex literals with
   tokens in the top-drift files: fast-entry, lookups, meeting-plan, ledger, roster-import.
   Retire the 5 public-token leak files onto admin tokens. Rename phantom `--admin-bark` /
   `--admin-green-*` reads to real tokens.
4. **Phase D — COMPLETE (2026-08-21, v1.61.0).** Closeout done: scoreboard fully struck,
   final audit grep confirmed the Phase C numbers, and the eyebrow-label retirement was
   finished (two forks, two passes: byte-identical copies first, then the parent-approved
   drift normalization — see the acceptance entry). Utility override rule now documented
   on the styleguide: out-specify (0,1,0), never rely on stylesheet order.

## Open Questions

- [x] Primary button canonical — **DECIDED by Patrick 2026-08-21: NAVY** (court-of-honor
      .primaryBtn). Green stays reserved for Add/create so color carries meaning (green =
      create, navy = commit). Applied: workbench's forest Save (public-token leak) → navy;
      meetings/report's green Apply submit → .editSaveBtn; lookups' green Save → .editSaveBtn.
- [x] Danger buttons — **DECIDED by Patrick 2026-08-21: both, with rules.** OUTLINED for
      in-context destructive actions (rows/panels); SOLID reserved for the confirm button
      inside a danger Dialog (media-manager's DeleteConfirm is the exemplar). Applied:
      events-admin's solid one-off → outlined; roster + access hardcoded reds → tokens; all
      outlined copies share color-mix(30% danger) border + status-error-bg hover.
- [x] Roster's navy addBtn — **DECIDED by Patrick 2026-08-21: convert to green** shared
      AddButton (it was drift, not a recorded choice).
- [x] meeting-plan's navy table header — **DECIDED by Patrick 2026-08-21 (Phase B session):
      normalize to the compact cluster's gray header.** One table language everywhere.
- [x] Non-pill tab variants — **DECIDED by Patrick 2026-08-21 (Phase B session): fold
      EVERYTHING into the pill TabStrip** (offered "bless two patterns" was declined).
      Applied to meeting-plan's underline tabs, court-of-honor's and the report's view tabs,
      the library workstation (admin page only — library.module.css untouched, which also
      closes the D-160 backlog item), and media-picker's tabs.

## Notes

- **`library.module.css` is radioactive:** imported by 20 public-route files (signin, member,
  advancement reports, news submit…). Its classes (`.tab`, `.statusPill`, `.pageTitle`,
  `.fieldHint`, `.btnPrimary`…) must never be restyled from the admin side; the library
  workstation needs its own scoped classes first (existing backlog item, D-160).
- **media-picker progress-bar bug (was parked here): already fixed before Phase C** — the
  mock `width:'70%'` is now an honest indeterminate sweep bar (CSS comment records
  Patrick confirmed the bug). Phase C's recon found the parked note stale.
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
