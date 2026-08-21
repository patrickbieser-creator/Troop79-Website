# Public Design System — Tokens, Shared Components, and the Two-Guide Styleguide

**Status:** Ready to activate — all Open Questions decided by Patrick 2026-08-21
**Created:** 2026-08-21
**Priority:** Medium

## Overview

Bring the public site (everything outside `/admin`) up to the standard the Leader Workspace
just reached (`Plans/Completed/Admin-Design-System.md`, D-162): one complete token sheet,
shared React components for the patterns every public screen re-implements, per-screen
`module.css` reduced to screen-specific layout, and a living **public styleguide**. The
styleguide ships first (it is the work queue, exactly as `/admin/styleguide` was): the
admin nav's Styleguide item becomes a **chooser** — clicking it offers two choices, the
existing Admin guide and the new Public guide.

Driven by a full public-surface audit (2026-08-21, one subagent, all 22 public stylesheets +
67 public `.tsx` files). Headline: public is 65% of admin's CSS volume but carries **60% more
color entropy** (79 distinct hex vs admin's post-cleanup 49).

**Architecture: mirror the admin decision (Patrick, 2026-08-21, D-162)** — global tokens +
shared components carrying styling *and* behavior; per-screen modules shrink to layout.
Rejected then, still rejected: utility-classes-only, Tailwind migration.

## Problem / Opportunity

The audit's headline numbers:

- **Tokens:** 21 exist (globals.css `:root`) — colors/shadows/transition only. No spacing
  scale, no type scale, no radius scale, no semantic status tokens (danger/success/warning),
  no `--font-mono`, no breakpoint tokens. 1,457 `var()` reads. **18 phantom reads** (`--rule`
  ×16 with *mutually disagreeing* hex fallbacks, `--gold`, `--cream-2`). 212 reads carry
  fallbacks and **~63 of the hex fallbacks contradict the token they shadow** — a second
  palette encoded in fallbacks (`--navy`→`#22333b`, `--forest`→`#3d7a4a`, `--text-meta`→3
  different values…).
- **The palette fork ("second lineage"):** 8 files — `member`, `signin`, `news/submit`,
  `scout-account`, `reimbursements`, `news-controls`, `meeting-agenda`, `scout-accordion` —
  render an alternate palette outright: a second navy `#22333b` (12×), a second forest
  `#3d7a4a` (15×), five spellings of `--text-meta`, four hairline-rule tans. These 8 files
  account for ~30 of the 79 distinct hexes. They also hold the rem-unit font sizes (the
  token-native lineage is px).
- **Color drift:** 308 hex occurrences / 79 distinct. 18-member cream/off-white cluster,
  13 reds with **no danger token at all** (two independent red families), 12 text greys,
  10 greens, 9 tans, 9 navies.
- **Class duplication:** page header re-declared across 11 files (+2 pages doing it inline);
  buttons — 33 distinct class names in 15 files, the primary green button written from
  scratch 5× with 3 greens and 3 radii; 46 distinct pill/badge/tag names in 16 files; form
  fields in 18 files; the 1180px page shell 17× in CSS + 4× inline; tab strips 5×; notices
  15×; empty states 12×; the card surface recipe ~14× with 4 radii.
- **Inline styles:** 146 sites in 31 files, ~140 convertible (96%). The two merit-badges
  pages have **no stylesheet at all** — 46 sites / ~336 CSS props, a full stylesheet living
  in JSX. `site-footer.tsx` (on every public page) is fully inline and therefore has zero
  media queries.
- **Typography:** 507 `font-size` declarations, **59 distinct values** across px/rem/em;
  27 distinct letter-spacings; 12 radii; 17 breakpoints; no 4/8px spacing grid. Fonts load
  via a render-blocking Google Fonts `<link>` (no `next/font`), and `--font-ui` (230 reads)
  is defined only inside Tailwind's `@theme inline` block — a silent single point of failure.
- **`library.module.css` (595 lines, 19 importers)** is a de-facto public design system
  masquerading as a page stylesheet: it already holds the best page-shell, form-kit, button,
  and empty-state classes. The 9 non-library importers use only ~20 of its 104 classes.

## Acceptance Criteria

- [x] **Foundation — SHIPPED 2026-08-21 (v1.63.0).** All of it, plus a bonus catch: admin's
      literal `'Open Sans'`/`'Playfair Display'` stacks would have silently lost their
      webfonts under next/font — `--admin-font-ui` repointed to the next/font variable and
      a new `--admin-font-display` closed the five "TOKEN GAP" heading sites. 90 lying
      fallbacks dropped (audit estimated ~63; the extra are `--rule`'s now-redundant 16).
- [x] **Styleguide — SHIPPED 2026-08-21 (v1.63.0).** Chooser + both guides live; nav item
      relabeled "Styleguides" (longest-prefix matchPath covers the children); chooser test
      failing-first. Public guide's specimens re-pointed to the live shared components in
      the Phase A commit.
- [x] **Phase A — SHIPPED 2026-08-21 (v1.64.0).** All ten components built (15 dom tests,
      failing-first) and adopted across ~40 files by three parallel forks (D-165 pattern);
      library promotion complete — all 19 importers converted, promoted classes deleted,
      `library.module.css` is library-only. Honest residuals live on the public
      styleguide's scoreboard (photos/events two-column headers, compact/quiet button
      variants, reqDoneBadge uppercase question, home's editorial divider) — they fold
      into Phases B/C plus two Patrick calls. Deliberate deltas: passkey buttons
      navy→forest, boxed accessible error notices, focus rings, 3px→2px radii.
      Phone-width spot-check deferred to production eyes-on (desktop sweep done;
      components inherit the canon's responsive CSS).
- [x] **Phase B — SHIPPED 2026-08-21 (v1.65.0).** merit-badges ×2 on a real all-token
      stylesheet + PageHeader/PageShell/SectionDivider/EmptyState/card (46 sites → 2);
      site-footer.module.css with the footer's first-ever mobile stacking (640px canon);
      signed-in-as/site-nav/nav-links/utility-date converted (nav active state now styles
      off aria-current). Inline sites 146 → **13** in 6 files, every survivor genuinely
      dynamic and commented. Two deliberate hex survivors (merit-badges celebration gold —
      mint --award-gold if a third use appears); footer's on-navy rgba tints flagged for a
      Phase C --on-navy-* family. Phone eyes-on still owed in production (capture tooling
      wouldn't hold the mobile viewport; media queries verified in code).
- [x] **Phase C — SHIPPED 2026-08-21 (v1.66.0).** Second lineage fully normalized (8 files,
      zero raw hex, rem sizes onto --fs-*); distinct hex 79 → **7** (target was ≤ 30) — all
      survivors commented deliberates (Clipboard print pencil grid, categorical ramps,
      celebration gold). DatePickerField decoupled per option (b): public DateField (native
      input) shipped + adopted by both profile editors, admin's 31 fallback chains deleted,
      **zero admin imports anywhere in (public)**. Component additions decided + shipped
      with tests: Button size="sm" + dangerGhost (submitBtn/passkeyRemove/mastheadJoin
      converted), Badge caps={false} (reqDoneBadge converted), form kit at the 16px iOS
      no-zoom floor, --on-navy-* on-dark ink family. Home/about/join editorial divider
      FOLDED to shared (Patrick call; the printed Clipboard keeps the one sanctioned local).
      Breakpoints folded onto 480/640/900 where safe; load-bearing exceptions commented.
- [ ] **Phase D — closeout:** public scoreboard fully struck; final audit grep re-confirms
      the numbers; AGENTS.md styling rules extended to cover the public side.
- [ ] Every phase lands with the full quality gate green (`lint`+`typecheck`+`test`+`build`)
      AND a browser screenshot pass on touched screens; mobile widths included (the public
      site is family-facing and phone-heavy).

## Test Plan

CSS-heavy like the admin effort; the testable surfaces, written failing-first:

- [ ] `StyleguideChooser_OffersTwoGuides_WhenRendered()` — dom: chooser page renders exactly
      two links, to `/admin/styleguide/admin` and `/admin/styleguide/public`.
- [ ] `AdminNav_ShowsStyleguideItem_ToFullAdminOnly()` — already covered by
      `admin-nav-capabilities.test.ts` (capability-less item semantics); re-verify it still
      passes against the renamed/moved routes, extend only if matchPath behavior changes.
- [ ] `PublicButton_MapsVariant_ToSemanticClass()` — dom: primary/secondary/ghost/danger.
- [ ] `PublicBadge_MapsTone_ToStatusToken()` — dom (mirror of admin's Badge test).
- [ ] `PublicTabStrip_RendersCount_WhenCountProvided()` — dom.
- [ ] `PublicNotice_SetsAlertRole_WhenToneError()` — dom (role=alert vs role=status).
- [ ] `PageHeader_RendersKickerTitleLede_WhenAllProvided()` — dom.
- [ ] `EmptyState_RendersAction_WhenActionProvided()` — dom.
- [ ] `FormField_AssociatesLabelAndError_WithInput()` — dom: `htmlFor`/`aria-describedby`.
- [ ] Per-phase: `npm run lint && npm run typecheck && npm run test && npm run build` +
      manual screenshot sweep of touched screens at desktop AND ~390px mobile width.

## Technical Approach

**Token home: `globals.css`, kept global.** The 21 existing tokens stay where they are (on
`:root`, loaded by the root layout) — three hard constraints require it: (1) `admin.css:152-159`'s
sanctioned `--admin-preview-*` alias block reads 8 public tokens for WYSIWYG parity; (2) the
home page (`app/page.tsx`) and `login` sit outside the `(public)` route group; (3) 1,457
existing reads use the unprefixed names. New scale tokens join them in `:root`. Naming: the
existing color names stay untouched; new tokens use role-clean names that can't collide with
the color tokens (`--text-head` is a COLOR, so type sizes are `--fs-*`, spacing `--sp-*`,
radius `--rad-*`, status `--status-*-bg` etc. — final scheme is an Open Question). The
public↔admin firewall stays convention + the AGENTS.md rule, now stated in both directions:
admin CSS never reads public tokens (except the preview alias block), public CSS never reads
`--admin-*` (audit confirms: currently zero leaks — keep it that way).

**Fonts.** Migrate the Google Fonts `<link>` to `next/font/google` (Playfair Display, Lora,
Open Sans → CSS variables), define `--font-display/body/ui/mono` in `:root` off those
variables, and stop depending on `@theme inline` emission for a 323-read token. Free
performance win (self-hosted, no render-blocking request, fallback metrics kill the CLS)
and a prerequisite for honest font tokens.

**Shared components** live in `src/app/_components/` (the existing shared dir, above the
route groups — same relationship to public screens that `(workspace)/_components/` has to
admin screens). Each carries its own token-only `module.css`. Canonical sources per the
audit: page shell + header + form kit + buttons + empty state ← `library.module.css`
(promote, don't restyle — lift the ~20 shared classes out, leave the ~65 library-specific
ones); tabs ← `advancement/report`; badge seed ← library `.reqTag`/`.hostChip`. Where a
behavior-and-API twin exists on the admin side (TabStrip, Badge, Notice, Dialog patterns),
copy the admin component's API shape but implement against public tokens — **do not import
admin components into public** (that's the DatePickerField mistake, see below). The two
sides stay visually distinct on purpose (NYT editorial vs workspace); what they share is
the *system* (tokens + components + styleguide discipline), not the skin.

**Styleguide chooser.** `sub-nav.tsx`'s item label becomes "Styleguides", href stays
`/admin/styleguide`, `matchPath` covers the section. `/admin/styleguide/page.tsx` becomes a
small chooser — two large cards (Admin Styleguide / Public Styleguide, each with a one-line
scope description) — and the existing guide moves wholesale to `styleguide/admin/`. The
public guide at `styleguide/public/` imports the real public stylesheets (the admin guide's
proven pattern) and wraps its specimens in a container that re-establishes the public
context (`--cream` background, `--font-body`) inside the workspace chrome, since public
tokens are on `:root` and resolve everywhere. Old deep links to `/admin/styleguide` land on
the chooser — acceptable; code comments referencing the old path get updated in the same
commit.

**Coupling repairs** (from audit §8, ordered):
1. `DatePickerField` — public profile imports the admin component today, and its 31
   double-fallback chains (`var(--admin-*, var(--public-*, #hex))`) exist to survive that.
   Fix (decided, option b): public gets its own simple date field; admin's component
   reverts to pure admin tokens; the double-fallback chains are deleted.
2. `--article-*` tokens (`src/lib/article-body/`) are a deliberate third namespace,
   DB-driven, shared by 7 public + 8 admin consumers. Freeze: neither side folds them in;
   the public styleguide documents them as the shared prose contract.
3. The 8 public tokens behind `--admin-preview-*` are a frozen contract: changing their
   values restyles admin preview panes — call this out on both styleguides.

**Sequencing rule (unchanged from admin):** convert one screen at a time, screenshot
before/after, never a big-bang sweep. The public styleguide's variant specimens are the work
queue — delete each as its copy dies. Multi-fork waves reuse the D-165 pattern: strict
directory ownership, parent runs the gate.

## Implementation Steps

1. **Phase 0 — Foundation + the two-guide styleguide** (no visual change except where noted):
   a. `next/font/google` migration; `--font-*` tokens onto `:root`; delete the Google Fonts
      `<link>`. Verify all three faces render identically (screenshot diff, home + article).
   b. Token scales added to `globals.css` (type/spacing/radius/status/mono/focus). Values
      chosen from the audit's actual distributions (e.g. the 59 font sizes cluster onto a
      ~9-step scale; radius canon from the 2px(68)/3px(45)/4px(24) split — Open Question).
   c. Phantom cleanup: define `--rule` (pick the canonical hairline from the 4 candidates)
      or rename its 16 reads; resolve `--gold`, `--cream-2`. Correct the ~63 lying fallbacks.
   d. Restructure styleguide routes: chooser at `styleguide/`, admin guide → `styleguide/admin/`,
      public guide scaffold at `styleguide/public/` with token swatch sections + the initial
      scoreboard (one row per §4 duplication family), canonical + variant specimens rendered
      from real stylesheets. Nav item relabeled "Styleguides". Chooser + nav tests.
2. **Phase A — shared components + library promotion** (highest value density):
   a. Build the component set (Test Plan components first, failing-first) with token-only
      modules: `PageHeader`, `PageShell`, `Button`, `Badge`, `TabStrip`, `Notice`,
      `EmptyState`, `SectionDivider`, form kit, `.card` primitive.
   b. Library promotion: lift the shell + form clusters out of `library.module.css`; convert
      the 9 non-library importers to the shared components; then the 10 library routes.
   c. Adopt screen-by-screen, easiest first (the token-native lineage: events, advancement,
      news-cards screens are near-identical to canon — pure swaps), drift cases last.
3. **Phase B — the stylesheet-less screens + inline conversion:**
   a. `merit-badges/page.tsx` + `merit-badges/[mbId]/page.tsx`: new `merit-badges.module.css`
      on tokens + shared components (46 inline sites, ~336 props — the single largest win).
   b. `site-footer.tsx`: new module, add the missing mobile media queries.
   c. Sweep the remaining ~100 convertible inline sites (the un-do pattern
      `textTransform:'none'…` ×6 signals over-specified classes — fix the class, not the
      inline); keep the ~6 genuinely dynamic sites (`--lane-count` etc.), each commented.
4. **Phase C — palette + unit normalization:**
   a. The 8 second-lineage files onto canonical tokens (visible change on member/signin/
      submit/scout-account/reimbursements screens — needs Patrick's palette call first).
   b. Hex → token across remaining files (meeting-agenda 31, photos 32, profile 24 are the
      top targets); reds onto the new status tokens (collapse the two red families — pick
      one, Open Question); rem → px type scale; letter-spacing/radius onto scales.
   c. DatePickerField decoupling (per the decided Open Question).
5. **Phase D — closeout:** strike the scoreboard; final audit grep re-confirms (target:
   hex ≤ 30 distinct, inline ≤ 15, phantom 0, fallback-contradictions 0); AGENTS.md gains
   the public styling rules (mirror of the admin block, both-direction firewall); archive
   this plan.

## Open Questions

All decided by Patrick 2026-08-21 (same-day as plan creation):

- [x] **Second-lineage normalization — DECIDED: YES**, the canonical palette wins
      everywhere. member/signin/submit/scout-account/reimbursements/news-controls/
      meeting-agenda/scout-accordion move onto the tokens; the visible change on those
      screens (second navy `#22333b` → `--navy` `#1e3a4a`, five meta-greys →
      `--text-meta`…) is accepted and intended.
- [x] **Forest — DECIDED: keep `#3d5a3e`** (the existing `--forest` token, 144 reads).
      The 15 public uses of `#3d7a4a` convert to the token. `#3d7a4a` remains admin's
      forest only.
- [x] **Danger red — DECIDED: `#8c3b3b`** becomes `--status-danger` (Patrick: no
      preference, either fine; picked for use count 9 vs 7 and the more muted brick fits
      the editorial palette). The 13-member red cluster, including the `#a04a3d` family,
      collapses onto it and its derived tint.
- [x] **Token naming — DECIDED: as proposed.** `--fs-2xs…--fs-3xl` (type), `--sp-1…--sp-12`
      (4px grid), `--rad-sm/md/lg/pill/circle`, `--status-{danger,success,warning,info}` +
      `-bg` tints, `--font-mono`, `--focus-ring`.
- [x] **Radius canon — DECIDED: 2px = `--rad-sm`, 4px = `--rad-md`, 3px retired** (each
      3px use folds to its nearer neighbor per the pattern it belongs to).
- [x] **DatePickerField — DECIDED: option (b).** Public gets its own simple date field
      (likely a styled native `<input type="date">` — better on phones, where families
      edit profiles); the 2 public call sites (profile adult-editor + profile-editor)
      switch to it. Admin's DatePickerField reverts to pure admin tokens and its 31
      double-fallback chains are deleted. "Never import admin components into public"
      becomes absolute.
- [x] **Styleguide chooser — DECIDED: chooser page** at `/admin/styleguide`, the two
      guides at `/admin/styleguide/{admin,public}`.

## Notes

- **Component wishes from the Phase A adoption waves (2026-08-21)** — small API gaps hit
  during conversion; add with tests when their residual sites convert (B/C): `Button`
  `size="sm"` (news-controls compact CTA) and a danger-ghost variant (member passkeyRemove);
  `PageHeader` optional `meta` slot (meeting-plan's date/title row between lede and rule);
  `Field as="fieldset"` for radio groups (submit-proof); `FormCard`/`FieldHint` accept no
  style overrides (by design — revisit only if wrappers proliferate). Open Phase C question
  the waves surfaced: bump the form kit's 14.5px input font to 16px to stop iOS focus-zoom
  (name-search already does this deliberately).

- **Full audit (2026-08-21, subagent):** 22 public stylesheets / 5,772 lines / 746 classes /
  1,173 declarations; 308 hex occurrences, 79 distinct; 1,457 var() reads; 146 inline sites
  in 31 files; 507 font-size declarations, 59 distinct. The durable summary is condensed
  above; re-run the greps if precision is needed later (admin plan's precedent).
- **`library.module.css` exact importer count: 19** (AGENTS.md says "~20" — 10 library
  routes + advancement/report ×3, member ×3, news/submit, signin ×2). Zero admin importers —
  the promotion move is admin-safe. Update AGENTS.md's note when the promotion lands.
- **The fallback fork is silent but armed:** the ~63 contradicting fallbacks never render
  today (tokens always resolve) but document a second palette and detonate if tokens are
  ever scoped or a file is used outside the root layout. Phase 0c defuses them.
- **`--font-ui` fragility:** 323 reads depend on Tailwind's `@theme inline` emitting the
  variable. Phase 0a's `:root` definitions remove the single point of failure regardless of
  what Tailwind does later.
- **Admin↔public leak status at audit time:** public reads zero `--admin-*` (clean); admin
  reads public only via the sanctioned preview alias block + DatePickerField's fallback
  chains. Preserve during all phases; the public styleguide gets a "shared contracts"
  section documenting `--article-*` and the preview-alias 8.
- **Mobile matters more here than in admin** — public is the family-facing surface.
  Screenshot passes include ~390px; the footer's missing media queries and the 17-breakpoint
  spread get rationalized onto documented breakpoints in Phase C.
- Related: `Plans/Completed/Admin-Design-System.md` (the playbook this mirrors), D-162
  (architecture decision), D-165 (fork-parallel wave pattern), D-160 (library workstation
  scoping — closed), `next-app/AGENTS.md` admin styling rules.
