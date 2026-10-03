# Calm Site Restyle — Jenna MACRO sweep (step 1 of `Plans/Calm-Site-Restyle.md`)

**Date:** 2026-10-03 · **By:** Jenna (MACRO) · **Status:** Awaiting Patrick's order + two open questions

Inventory: ~97 routes (42 public, 55 admin), 107 module stylesheets, 9 pattern clusters. Counts from grep/import counts over `next-app/src/app`; screen verdicts from stylesheets, not rendered pages (no phone check yet).

**Headline:** the public site already has the cream page — `body` is `--newsprint` in `globals.css`, the same ground as Menu Monster. MM's calm is what sits ON the ground: no hairline-bordered cards, no 2px header rules, no uppercase tracked labels, no 44px controls, no chip rows. The fix is subtraction, not a page-color change.

## 1. Loud patterns

| Pattern | Defined in | Reach | Calm replacement |
|---|---|---|---|
| Bordered + shadowed cards | `_components/card.module.css` `.card`; `form.module.css` `.formCard` (26×28 pad, border, shadow); `.gate` boxes (profile, event-detail, signin) | `.card`/FormCard: 5 files; ~24 per-screen modules hand-roll borders (scout-detail 32 border decls, event-detail 36, mb-tracker 30, events 20) | New `.list`/`.listRow` recipe in `card.module.css` = MM `.card`/`.row`: borderless white, `--rad-md`, `--shadow-card`, 1px `--rule` between rows, 38px rows. `.formCard` loses border, ~16px pad |
| Uppercase tracked labels | `form.module.css` `.fieldLabel` (11px/0.1em/uppercase); `page-header` `.kicker`; `section-divider` `.label`; `badge`; `button` `.btn`; `event-detail` `.blockHead`. 27 public sheets use `text-transform: uppercase` | Every form (`Field`, 15 files), 13 SectionDivider, 19 PageHeader | Sentence case, 13–14px, 600, `--text-meta`, no tracking (MM `.dayHead` / `.line label`). Badges keep caps only for status |
| Boxed admin FormPanel/FormSection | `admin/_components/form-panel.module.css` `.panel` (tint, border, shadow); `.section` (+4px navy left bar, numbered navy circle, uppercase title) | 29 FormPanel + 21 FormSection in 19 files (scout-form, adult-form, entry-form, article-editor, meeting-editor, builder-panels, workbench) | Borderless panel on page ground, 14px sentence-case title, actions on title line; section drops bar + circle. Fields stay white (`--admin-field-bg`, 2026-08-21) |
| Oversized buttons | Public `button.module.css` (min-height 44px, 12×22 pad, uppercase, 0.05em); admin heavy solid navy primary | Public Button: 77 uses / 37 files; admin: 364 uses | Public: sentence case, 600, min-height 36px (44px stays only on tap-only icon targets), add `md` size. Admin: keep sizes; quiet primary when a title line has >1 action |
| Chip rows for single choices | Public `event-detail.module.css` `.pill`/`.pickChip` (1.5px borders, pill radius); admin `.chip` in 6 files | Signup `person-first-form.tsx` (~L103, ~L166), `slot-first-form.tsx`, `guest-rows.tsx`, MM `paid-section.tsx:266` | Single choice ≤6 → MM quiet pulldown; ≤3 → quiet inline segmented. Chips only for multi-select, borderless with tint when on |
| Stacked hint text | `form.module.css` `.fieldHint`; long `gateLede` / `hintTop` | Signup, profile, signin ledes | Hint only when it adds info the label lacks (no-redundant-text rule) |
| Table density/headers | Admin `data-table.module.css` `.compact`/`.card`/`.dense`: gray-50 header band, uppercase 10–11px, 2px rule on `.card`; public `roster-table`, `report` | 22 admin files | Sentence-case 12px gray-500 headers, no band/2px rule; hairline rows; `.cardWrap` drops border, keeps shadow. Row heights already ~38px |
| Page header weight | Public `page-header.module.css` (`--fs-display` 30–44px/900, italic lede, 2px `.headRule`, uppercase kicker); admin `page-title.module.css` (22px, 1px rule) | 19 public PageHeader; 43 admin PageTitle; event/profile/scouts hand-roll 2px `.head` border | MM title line: `--fs-2xl` display (26px), no rule, 14px meta lede, actions right. Hero size kept for home/news/article |
| Notice/badge loudness | Public `notice.module.css` (600, border + tint), `badge.module.css` (pill, border, uppercase); admin twins | Public 39 Notice / 7 Badge; admin 86 / 77 | Notices regular weight, tint only (border on error only); badges sentence case, tint only |
| Tab strips | Public `tab-strip.module.css` (joined segmented, solid navy active); admin gray tray + pill tabs + count chips | Public 7; admin 22 | Text/underline tabs: quiet gray, 2px navy underline on active; counts as plain "(n)" |

## 2. Shared-first leverage (screens ÷ effort)

1. Public `form.module.css` — 15 files (signin, profile, library submit, submit-proof, news submit, reimbursements, signup). One file, top reach.
2. Public `page-header` + `section-divider` — 19 + 13 files, near-pure subtraction.
3. Public `button.module.css` — 37 files; wrapping/tap-target risk → 375px check.
4. Admin `data-table.module.css` — 22 files, 3 blocks.
5. Admin `form-panel.module.css` — 19 files / 50 uses.
6. Admin `page-title`, `tab-strip`, `notice`, `badge` — 43 / 22 / 86 / 77 uses, mostly tint + weight.
7. Public `card`, `notice`, `badge`, `tab-strip` — low reach, cheap; become the recipes screens migrate onto.
8. Admin `.adminLabel` utility (`admin.css`) — 36 files incl. styleguides; check every consumer.

## 3. Screen ranking (loudness × traffic, phones weighted)

1. `/events/[id]` + signup (`event-detail.module.css`, `person-first-form.tsx` 1344 lines, `slot-first-form.tsx`) — every family, on phones; pill rows, 36 borders, uppercase `.blockHead` over 2px rule.
2. `/scouts/[id]` Clipboard (`scout-detail.module.css`, 873 lines) — print-critical; 32 borders, 11 uppercase labels.
3. `/library/mb/[mbId]` (`mb-tracker.module.css`, 611 lines) — 30 borders, pills, tracker boxes.
4. `/profile` — form-dense; bordered gates, uppercase labels.
5. `/signin`, `/member` — the front door.
6. `/events` + calendar (`events.module.css`) — month-grid chips loudest.
7. `/advancement` + report — rank pills, segmented tabs, heavy table.
8. `/library`, `/library/submit*` (`library.module.css`, 24 borders, 10 shadows).
9. Admin `fast-entry` (`fast-entry.module.css`, 967 lines, 38 borders) — leaders' top page.
10. Admin `calendar/entry-form.tsx`, `scout-form.tsx` — numbered navy-barred FormSection stacks.
11. Admin `advancement/ledger`, `finance` — `.card` table, uppercase headers, 2px rule.
12. Admin `events/[id]` builder (`events-admin.module.css`), `meeting-plan`.

## 4. Proposed order (each release: styleguide specimens in the same commit + 375px check)

- **R1 — Public tokens + kit:** add calm tokens (`--label-*`, `--row-h`) without changing existing values; restyle `form`, `page-header`, `section-divider`, `card` (+ `.list`), `notice`, `badge`, `tab-strip`. Moves signin, profile, submit, reimbursements, MM.
- **R2 — Public Button + sign-up form:** calm Button; signup pill rows → pulldowns. Ships alone (top family screen).
- **R3 — Public hand-rolled pages:** `/events`, `/events/[id]`, `/profile`, `/member`, `/signin` onto R1 recipes.
- **R4 — Scouts / MB tracker / advancement:** Clipboard, `mb-tracker`, `/advancement`, report; print gets its own check.
- **R5 — Admin shared:** `form-panel`, `data-table`, `page-title`, `tab-strip`, `notice`, `badge`, `Button` + admin specimens (~70 files move at once).
- **R6 — Admin per-screen:** `fast-entry`, `entry-form`, `scout-form`, ledger, finance, events-admin, meeting-plan.
- **R7 — Long tail** + the styleguides themselves.

## 5. Open question — cream + white card everywhere?

**Recommendation:** white-card-on-cream for every app-like screen (forms, lists, trackers, admin). News/article reading pages (`/news/[slug]`, `article-detail.module.css`, `news-cards.module.css`) and Home keep the NYT editorial type, serif body and masthead (BRAND.md identity) — only their loud chrome (uppercase kicker, 2px rules, bordered feed cards) calms. Page color already shared, so nothing changes there.

## 6. Risks

- **Preview alias:** `admin.css` aliases `--cream`, `--newsprint`, `--text-*`, `--border-light` into `--admin-preview-*` — editing those public values restyles admin previews. Add tokens; don't edit those.
- **Census** (`tests/design-system-census.test.ts`): only counts raw hex, inline `style={{}}`, cross-side reads. Border removal is safe; new hex/inline styles trip it. Admin must re-express the look in `--admin-*`; new admin tint tokens need a comment.
- **Admin text is small** (9–14px scale): don't shrink fields; sentence-case 11–12px labels need a contrast check.
- **16px input floor** stays when padding shrinks.
- **Save-button standard:** FormPanel/Section changes keep dirty-gated Save + Discard on the title line; check quiet disabled states stay legible.
- **Print:** Clipboard, MM shopping/store sheets rely on borders and `:has()` rules in `globals.css` — recheck after R4.
- **Button resize** (77 uses): wrapping and tap targets in dense rows.
- **Concurrent sessions:** stage explicit paths only.

## Open questions for Patrick

1. Release order — take R1→R7 as proposed?
2. Confirm the news/article/home editorial exception (§5).
3. Admin labels: sentence case at current small sizes, or step the admin label size up at the same time?
