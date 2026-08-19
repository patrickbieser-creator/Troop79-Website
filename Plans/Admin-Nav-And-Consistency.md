# Admin Nav Reorganization & Cross-Module Consistency

**Status:** Active — Section 1 (nav reorg + mobile fix) and Section 3 (roster editor treatment)
shipped 2026-08-19, browser-unverified (see Shipped note). Section 2 (cross-module consistency
sweep) remains a plan, not yet activated.
**Priority:** Medium
**Owner (consulting):** Brad (UX/UI Prototyping) — planning only, no production code touched
by Brad; implementation below done directly at Patrick's request.

## Overview

Six weeks of daily shipping grew the admin workspace to 8 nav sections / ~20 items and 9+
independently-styled editor dialogs. Patrick flagged two concrete symptoms: the nav feels
cluttered, and the roster/person editors (`scout-form.tsx`, `adult-form.tsx`) are hard to
visually parse. This plan covers three scoped proposals — nav reorg, a cross-module
consistency audit, and a roster-editor visual treatment — each with a prototype to react to.
No `next-app/src/` files were edited to produce this plan.

**Prototypes:**
- `prototypes/admin-nav/index.html` — interactive nav comparison (desktop + mobile, capability-gated role switcher)
- `prototypes/roster-editor/index.html` — Current vs. Proposed scout-form.tsx treatment

## Problem / Opportunity

1. **Nav:** `sub-nav.tsx`'s `Records` section carries 7 of the ~20 total items — nearly twice
   any other section — while `Output` is a single orphaned item with its own full-width
   header. Neither reflects how a leader actually uses the two: day-to-day recording
   (Ledger, Submit & Present, MB Progress, Roster) reads differently from generate-and-hand-off
   actions (Audits, Weekly Report, Court of Honor, Scoutbook Export). Separately, **on mobile
   (≤800px) `admin.module.css` sets `.subNavSection { display: none; }`** — every section
   label disappears and the sidebar becomes one undifferentiated wrapped row of ~20 chips.
   Given "several [leaders] on tablets/phones at troop meetings" is an explicit constraint,
   this is the more consequential of the two nav findings, independent of any regrouping.
2. **Consistency:** 9 editor surfaces across 4+ CSS modules have converged on *visually*
   similar 2-column edit forms via 3 different implementation strategies — direct import of
   `lookups.module.css`, hand-copied duplicate class definitions (with in-code comments
   admitting the drift risk), or independently-authored equivalents with different class
   names and even a different label/input DOM shape. Dialog mechanism, sort-header handling,
   and table truncation are each inconsistent in ways that show up as real behavioral
   differences (Escape-to-close works in 7 of 9 surfaces, not 2; one sort implementation is
   duplicated while three tables with sortable-shaped data have no sort at all).
3. **Roster editor:** `scout-form.tsx`'s 6 sections (Identity, Demographics, Contact, Things
   We Should Know, Parents/Guardians, Status) share one visual treatment — a 1px dashed
   divider and an 11px uppercase label — that provides no orientation in a dialog dense
   enough to require scrolling. This is the same `.editSection` used by ~7 other, much
   lighter editors, so a fix here has a real ripple-effect question attached.

## Prototypes

Open directly in a browser, no build step:
- `prototypes/admin-nav/index.html` — click "View as" to switch between Full Admin,
  Calendar-only leader, and Roster & Advancement leader; both the desktop side-by-side and
  the 375px mobile frames re-render live using the same filtering logic as
  `visibleNavSections()`.
- `prototypes/roster-editor/index.html` — "Current" / "Proposed" tabs toggle between today's
  treatment and the rail-nav + section-card treatment, both built from the real
  `scout-form.tsx` field set (invented data — "Owen Kaczmarek" is not a real scout).

Both were browser-verified (desktop + mobile frames, role-switching interaction, scroll-spy
rail, zero console errors) before being handed off.

---

## Section 1 — Navigation Reorganization

### Current structure (8 sections, 20 items)

| Section | Items | Notes |
|---|---|---|
| Overview | Dashboard | |
| Entry | Fast Entry, Event Rosters | |
| Planning | Meeting Plan, Roll Call & Agendas, Has/Needs Tool | Roll Call deliberately separate from Calendar (in-code comment) |
| **Records** | **Universal Ledger, Submit & Present, MB Progress, Audits, Weekly Advancement Report, Roster, Court of Honor** | **7 items — largest section by a wide margin** |
| News & Events | News, Calendar, Resource Library, Media Manager, Photo Albums | Ordered by editor workflow (in-code comment) |
| Finance | Ledger, Reimbursements, Activity Report | Mid-flight, `finance.manage`-gated |
| **Output** | **Scoutbook Export** | **1 item, own full-width section header** |
| Setup | Lookups & Admin, Roster Import, Access & Permissions, Utilities | |

### Proposed structure (8 sections, rebalanced — max 5 items)

Same section count, same flat-list pattern — only Records/Output are touched:

| Section | Items | Change |
|---|---|---|
| Overview | Dashboard | unchanged |
| Entry | Fast Entry, Event Rosters | unchanged |
| Planning | Meeting Plan, Roll Call & Agendas, Has/Needs Tool | unchanged |
| Records | Universal Ledger, Submit & Present, MB Progress, Roster | **7 → 4 items** |
| **Reports & Exports** *(new)* | Audits, Weekly Advancement Report, Court of Honor, Scoutbook Export | **new section** — day-to-day recording split from review/hand-off |
| News & Events | News, Calendar, Resource Library, Media Manager, Photo Albums | unchanged |
| Finance | Ledger, Reimbursements, Activity Report | unchanged |
| Setup | Lookups & Admin, Roster Import, Access & Permissions, Utilities | unchanged |

**Why not touch anything else:** Overview/Entry/Planning/News & Events/Finance/Setup already
carry documented intent in `sub-nav.tsx`'s comments (e.g. why Roll Call stays off the
Calendar workbench, why News & Events is ordered the way it is) and are reasonably sized
(1–5 items). Dashboard stays alone at the top deliberately — it's the landing page, not an
orphaned single item the way Output was.

**Capability-gating verified in the prototype** (mirrors `visibleNavSections()`):
- A `calendar.write`-only leader sees exactly 2 sections (Entry → Event Rosters, News &
  Events → Calendar), identical in Current and Proposed — the reorg only touched items that
  were already `advancement.write`-gated, so this narrow case is unaffected.
- A `roster.manage` + `advancement.write` leader sees Records shrink to 4 tight items and the
  new Reports & Exports section hold the other 4, instead of one 7-item wall — the intended
  effect, visible even under partial capabilities.

### Mobile fix (independent of the regrouping above)

`admin.module.css` hides `.subNavSection` entirely below 800px. Fix: keep a compact inline
divider (small uppercase label + rule) between groups in the wrapped chip layout instead of
`display: none`. This is a small, low-risk CSS change and arguably the higher-value fix of
the two — it restores grouping for every leader on a phone/tablet regardless of whether the
Records/Reports split ships.

### Alternatives considered and rejected

| Option | Verdict | Why |
|---|---|---|
| Collapsible/accordion sections | **Rejected** | Tracker memory (STATE.md v1.19.0, D-070) documents a shipped-broken-twice production incident: a per-rank `<details>` accordion's closed content became browser-internal "skipped content" that `display: block !important` and `content-visibility: visible !important` both failed to override. A JS-driven (non-`<details>`) expand/collapse could sidestep that specific failure mode, but with sections now capped at 5 items there's no scroll-length problem left to justify the interaction cost. |
| Command palette / search (Cmd+K) | **Rejected** | Solves a discovery problem this audience doesn't have — 10 people who each use the same 3–5 items weekly, several non-technical, several on tablets. |
| Top-level tabs instead of sections | **Rejected** | Makes the narrow-capability case *worse* — a `calendar.write`-only leader would land on a mostly-empty tab instead of a short, honest 2-item list. Bigger engineering lift (routing/state) for a site this size. |
| Icons per section | **Held / open question** | Could aid scanning but is an ongoing maintenance surface (every future nav item needs an icon decision) for a marginal gain over the existing 3px active-border accent. Not built into the prototype — see Open Questions. |

---

## Section 2 — Cross-Module Consistency Audit

Surveyed 9 editor/table surfaces: `mb-editor.tsx`, `event-editor.tsx`, `meeting-editor.tsx`,
`calendar-editor.tsx`, `article-editor.tsx`, `albums-editor.tsx`, `add-person.tsx` +
`roster-table.tsx`, `people-table.tsx`'s PersonEditor, and (read-only reference)
`finance/edit-transaction-dialog.tsx` + `reimbursement-queue.tsx` — plus `scout-form.tsx` /
`adult-form.tsx` already read in full for Section 3.

### Findings

**1. Dialog mechanism is inconsistent — different close/dismiss behavior per screen.**
7 of 9 surfaces use a native `<dialog>` (Escape-to-close, backdrop-click, browser-managed
focus trap, all free). `people-table.tsx`'s `PersonEditor` instead hand-rolls a fixed-position
overlay (`<div role="dialog" aria-modal="true">`) with none of that — no Escape, no
backdrop-click dismiss. `add-person.tsx`, `event-editor.tsx`, and `article-editor.tsx` use no
dialog at all (inline panels / full pages). A leader gets a different interaction contract
depending on which editor happens to be open, with no in-code rationale for the divergence.

**2. The "shared" `lookups.module.css` pattern is shared in name only — real duplication, not reuse.**
Only `mb-editor.tsx`, `event-editor.tsx`, `pending-update-panel.tsx`, and `scout-form.tsx`
actually `import` it. `roster.module.css` and `meetings.module.css` **copy-paste** the same
`.editGrid`/`.editField`/`.editLabel`/`.editInput` class contract by hand — their own
comments admit this ("kept in sync with lookups.module.css... so this module is
self-contained") and warn about drift. `calendar.module.css`, `albums.module.css`, and
`finance.module.css` reinvent form-field markup with different class names again, and
`finance.module.css` skips the `<span class="editLabel">` wrapper entirely (`<label>Date
<input/></label>` instead). Six visually similar edit forms are running on five unrelated
stylesheets — three different authoring strategies for the same visual language.

**3. Two competing sort-header implementations, and most sortable-shaped tables use neither.**
`advancement/roster/use-sortable.tsx` exports a reusable `SortHeader` + `useSortable` hook.
`event-editor.tsx` independently reimplements the identical click-to-sort/arrow-indicator
behavior by hand. Meanwhile `people-table.tsx`, `roster-table.tsx` (event rosters), and
`calendar-editor.tsx` have no sort at all on data that's shaped for it. `use-sortable.tsx`'s
own comment explains why it's deliberately *not* the Lookups windowing/search hook
(`use-lookup-table.tsx`) — that divergence is intentional and documented. The absence of any
sort hook in 3 other tables is not documented anywhere and reads as an oversight, not a
decision.

**4. The project's own truncation lesson (`minmax(0,1fr)`/`min-width:0`, PATTERNS.md) isn't
applied where it's needed.** `albums.module.css` defines a `.linkCell` ellipsis rule that is
never referenced in `albums-editor.tsx` — dead CSS. `calendar.module.css`'s `.titleCell` has
no overflow handling at all. Both can blow out their column on a long title, the exact
failure mode PATTERNS.md already documents from three separate 2026-08-15 incidents.

**5. Row actions never use the project's own stretched-link pattern (PATTERNS.md, D-108).**
Every table audited uses 2–3 separate buttons/links per row instead. `calendar-editor.tsx` is
the sharpest example: the title cell is already a link to the edit page, and there's a
*second*, separate "Edit" button pointing at the identical URL — two tab stops for one
destination, on every row.

### Proposed standard

| Concern | Standard | Rationale |
|---|---|---|
| Dialog mechanism | Native `<dialog>` + `showModal()`/`close()` for anything that's genuinely a modal edit. Reserve inline-in-page panels for non-modal, always-addable rows (e.g. `event-editor.tsx`'s inline add). | Matches what 7 of 9 surfaces already do; free accessibility behavior; removes `PersonEditor`'s divergence. |
| Shared field CSS | Genuinely `import` `lookups.module.css` rather than hand-copying its classes. Where a module needs something `lookups.module.css` doesn't have, add it there (opt-in, additive) rather than forking. | Turns "kept in sync by hand" (an admitted drift risk in the code's own comments) into "actually one source." |
| Sort headers | Any table with 20+ rows and 2+ sortable-shaped columns uses `use-sortable.tsx`'s `SortHeader`/`useSortable`, moved to a shared location (e.g. `_components/`) so non-roster tables can import it without reaching into `advancement/roster/`. | Removes the duplicate hand-rolled implementation in `event-editor.tsx` and gives `people-table.tsx`/`roster-table.tsx`/`calendar-editor.tsx` sorting they currently lack. |
| Truncation | Any cell holding free-text (titles, descriptions, names) gets `minmax(0,1fr)` on its track + `min-width:0` + `text-overflow: ellipsis` on the cell, per PATTERNS.md. Sweep `albums-editor.tsx` (apply the already-defined `.linkCell`) and `calendar.module.css`'s `.titleCell` (currently undefined) first — lowest effort, already-known fix. | Already a documented, hard-won project pattern; this is applying it, not inventing it. |
| Row actions | One stretched link (`<a>` + `::after{inset:0}` over `position:relative` row) per row where the row's primary action is "open this," per PATTERNS.md D-108. Secondary actions (Delete, Clone) stay as explicit buttons layered above the overlay. | Removes `calendar-editor.tsx`'s literal duplicate link/button pointing at the same URL; already a documented project pattern. |

**Scope note:** this table is a *standard to converge toward*, not a rewrite plan — see Open
Questions for sequencing.

---

## Section 3 — Roster / Person Editor Treatment

### What's there today

`scout-form.tsx` (535 lines, imports `lookups.module.css`) and `adult-form.tsx` (233 lines,
imports its own `roster.module.css`) are the two person editors — themselves an inconsistency
per Section 2 (`adult-form.tsx` doesn't share `scout-form.tsx`'s stylesheet even though they
edit adjacent record types). `scout-form.tsx`'s 6 sections — Identity, Demographics, Contact,
Things We Should Know, Parents/Guardians, Status — each get identical treatment: a
`margin-bottom:16px; padding-bottom:14px; border-bottom:1px dashed var(--admin-gray-200)`
wrapper and an 11px uppercase `<h4>`. In a dialog dense enough to scroll, that's not enough
visual separation to tell sections apart at a glance — Patrick's stated complaint, confirmed
in the "Current" tab of `prototypes/roster-editor/index.html`.

### Proposed treatment

Built and browser-verified in the "Proposed" tab of `prototypes/roster-editor/index.html`:

1. **Section cards, not dividers.** Each section becomes a card: light background tint
   (`var(--admin-gray-50)`), a 4px navy left-border accent, 6px radius, numbered circle badge
   (1–6) next to a slightly larger uppercase header, 14px gap between cards. All within the
   same single scrolling dialog — nothing is hidden or collapsed.
2. **Sticky left rail, pure wayfinding.** A 168px rail lists all 6 section names with the same
   numbered badges; clicking scrolls the section into view, and an `IntersectionObserver`
   highlights whichever section is currently in the viewport as the leader scrolls. This is
   strictly additive — it never hides a section, so it cannot hit the `<details>` failure mode
   below.
3. **Every field stays in the DOM, always visible.** No tabs, no collapse, no
   `display:none`/`hidden` toggling of form content at all.

**Explicitly addressing the accordion failure (per the brief's requirement):** Tracker memory
(STATE.md v1.19.0, D-070) documents a real production incident — a per-rank `<details>`
accordion shipped broken twice because a closed `<details>`'s content is browser-internal
"skipped content," not a normal overridable CSS value; `display: block !important` and
`content-visibility: visible !important` both failed to force it visible, and every rank but
the scout's current one rendered blank in production for hours before being caught. The
proposed treatment above sidesteps this category of failure entirely by construction — no
section is ever hidden, so there's no closed state to fail to un-hide. A true tabbed variant
(one section visible, others hidden) was considered and set aside — see Open Questions — not
because it would necessarily repeat the same failure (tabs built with `hidden`-attribute
toggling or conditional rendering are a different mechanism than native `<details>`), but
because hiding content behind a tab reintroduces the exact risk this incident is a cautionary
tale about: a leader could miss a required field (e.g. the inactive-reason dropdown under
Status) sitting on a tab they never opened, with no accordion bug required to cause it.

### Feature or fork? — the `lookups.module.css` ripple, decided explicitly

The brief asks for an explicit call on whether the shared `.editSection`/`.editGrid` pattern
across ~7 other editors (MB, Event, Categories, Skills, Name Lookup, Article Tokens, Skill
Assign) is a feature to keep or something the person editors need to diverge from. **Decision:
split the two concerns.**

- **Section-card chrome (tint / left border / numbered badge) rolls out to everyone,
  eventually.** It's a strict visual upgrade over a plain dashed divider and costs nothing
  extra even on a 1-section lookup dialog. Ship it as a new *opt-in* class
  (`.editSectionCard`) added *alongside* the existing `.editSection` in
  `lookups.module.css` — existing dialogs keep rendering with today's look until a component
  explicitly switches classes, so this is non-breaking by construction, not a
  flag-day rewrite.
- **The rail nav does not roll out everywhere.** It's gated on section count (4+), not on
  module identity. Most Lookups editors have 1–2 sections and have nothing to jump between; a
  rail there would be pure chrome. `scout-form.tsx` (6 sections) is the clear candidate today;
  `people-table.tsx`'s `PersonEditor` (also dense, flagged in Section 2) is the next most
  likely candidate once/if it's rebuilt on the shared pattern.
- **Field-level markup — `.editGrid`/`.editField`/`.editLabel`/`.editInput` — is untouched.**
  Nothing in this proposal requires touching the ~7 other editors' actual form fields.

This keeps the blast radius of "fix the roster editor" scoped to `scout-form.tsx` (and
optionally `adult-form.tsx`) plus one additive CSS class, rather than a redesign that ripples
into every Lookups dialog on day one.

---

## Shipped (2026-08-19)

Implemented directly against `sub-nav.tsx`, `admin.module.css`, `lookups.module.css`,
`roster.module.css`, and `scout-form.tsx` — full quality gate green (lint 0 errors/3 known
warnings, typecheck clean, 572/572 tests, production build clean). **Not browser-click-through
verified**: `/admin/login` confirmed the shared leader password is fully retired in this local
dev environment too (identity-only sign-in), and no real leader credentials/email access are
available in this session — same constraint noted in Tracker STATE.md item 7. CSS/markup was
built directly against Brad's already browser-verified `prototypes/roster-editor/index.html`
values (colors, spacing, badge sizing, IntersectionObserver logic) rather than re-derived, but
Patrick should click through both surfaces for real before calling this done.

- **Nav reorg — adopted as proposed, with one change.** Records/Reports & Exports split shipped
  exactly as Brad proposed. Patrick's own call: **Roster moved to position 2 in Records**
  (directly under Universal Ledger — the two he reaches for most), not position 4 where Brad's
  table had it. Final Records order: Universal Ledger, Roster, Submit & Present, MB Progress.
  Reports & Exports: Audits, Weekly Advancement Report, Court of Honor, Scoutbook Export
  (absorbing the old standalone Output section, as proposed).
- **Mobile section-divider fix — shipped independently, as the plan recommended.**
  `.subNavSection { display: none; }` replaced: each section's wrapper now carries a
  `.subNavGroup` class that becomes its own wrapped chip row with a compact bordered label,
  instead of one undifferentiated mass of buttons.
- **Roster editor — section cards + sticky rail, shipped on `scout-form.tsx` only**, per the
  plan's explicit scope (`adult-form.tsx` is a single flat form, no rail candidate — untouched).
  New classes are additive in `lookups.module.css` (`.editSectionCard`, `.editRailBody`,
  `.editScrollArea`, etc.) alongside the existing `.editSection` — none of the ~7 other Lookups
  editors were touched. `FormSection` (local to `scout-form.tsx`) now takes `num`/`sectionRef`
  props and renders the card+badge chrome instead of the dashed-divider treatment.
  - **One correction made mid-implementation, not anticipated in the plan:** the plan's
    `.editDialogRoster` sizing class was drafted for `lookups.module.css`, but the actual
    `<dialog>` wrapper in `scouts-table.tsx` imports `roster.module.css` (a separate,
    hand-duplicated stylesheet — exactly the Section 2 finding #2 problem). `roster.module.css`'s
    own `.editDialog` already provided adequate width/height (94vw/860px/90vh) via
    `overflow-y: auto` on the `<dialog>` itself; a new `.editDialogRosterFixed` modifier
    (`overflow: hidden`) was added there instead, so the rail can stay sticky while only
    `.editScrollArea` (in `lookups.module.css`) scrolls internally — the outer dialog no longer
    double-scrolls against it. Also restored `.editDialogHeader`'s horizontal padding, scoped to
    `.editDialogRosterInner > .editDialogHeader` only — it previously came from the old
    `.editDialogInner` parent, which this treatment no longer uses.

## Open Questions

*(Answering these turns this from a planning doc into an implementation plan. None are
blocking for Patrick to react to the prototypes.)*

- [x] **Reports & Exports section — adopt as proposed, or a different split of the 7 Records items?** **Decided 2026-08-19 (Patrick): adopted, with Roster moved to position 2** (under Universal Ledger) rather than Brad's position 4 — see Shipped note above.
- [x] **Mobile section-divider fix — ship this independently and immediately**? **Shipped 2026-08-19** — see Shipped note above.
- [ ] **Icons per nav section** — worth the ongoing maintenance surface, or skip in favor of the existing active-border accent? Not built into the prototype either way.
- [ ] **Consistency standard (Section 2) — sequencing.** Converge all 9 surfaces at once, or fix opportunistically as each module is next touched? Given qa-lead/tech-lead governance triggers on cross-cutting changes (5+ files, 3+ modules), a full sweep would need that review; a some of these individual fixes (e.g. `use-sortable.tsx` relocation) don't.
- [ ] **`use-sortable.tsx` relocation** — moving it out of `advancement/roster/` into a shared `_components/` location touches its 1 current consumer plus however many of `people-table.tsx`/`roster-table.tsx`/`calendar-editor.tsx` adopt it. Confirm the new location before anyone starts.
- [ ] **`adult-form.tsx` — bring onto `lookups.module.css` alongside `scout-form.tsx`, or leave it on `roster.module.css`?** They edit adjacent record types today with two different stylesheets; folding them together is straightforward (its 1-section form doesn't need the rail) but touches a file outside today's stated scope.
- [ ] **Section-card CSS rollout — opt-in now, or a committed rollout schedule to the other 7 editors?** The plan proposes additive/opt-in with no forced timeline; Patrick may prefer a concrete "do all 7 by X" commitment instead of leaving it open-ended.
- [ ] **Tabbed (hide-on-switch) variant for the roster editor** — explicitly not built, per the accordion-adjacent risk discussed in Section 3. Worth prototyping as a genuine alternative once Patrick has reacted to the card+rail version, or is the additive rail sufficient?
- [ ] **`PersonEditor`'s custom overlay vs. native `<dialog>`** (Section 2, finding 1) — biggest single behavioral gap found (no Escape, no backdrop-click). Worth a standalone fix ahead of the broader consistency sweep given it's one file, one clear bug, and no cross-cutting blast radius?

## Notes

- Full audit detail (per-file dialog mechanism, CSS module, sort convention, truncation,
  row-action pattern) for all 9 surveyed editors is preserved in this session's research; ask
  to have it re-expanded per-file if Section 2's summary table isn't enough detail to plan
  implementation work.
- Architect memory `Agents/Architect/Memory/PATTERNS.md` already documents the two CSS lessons
  cited above (`minmax(0,1fr)`/`min-width:0` truncation, one-stretched-link-per-row) — Section
  2's proposed standard applies them, doesn't restate their reasoning.
- Tracker memory `Agents/Tracker/Memory/STATE.md`, v1.19.0 entry (2026-07-25), is the source
  for the `<details>` accordion failure (D-070) cited in Section 3.
