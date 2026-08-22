# Merit Badges Into Library

**Status:** Parked
**Parked:** 2026-08-22
**Priority:** High

## Overview

Fold the public merit-badge tracker into the Resource Library so `/library/mb/[mbId]` becomes the ONE per-badge destination. Everything the retiring `/merit-badges/[mbId]` page shows — the Earned / In Progress / Not Started stat strip, the scout × leaf-requirement progress grid, the full requirements reference tree, and the official BSA / workbook links — relocates onto the library's per-badge page, placed above the "I did this" proof picker, which moves to the bottom of the page. The `/merit-badges` catalog page retires outright (Patrick: "the catalog in the Library is sufficient for public display"), with **no redirects** (Patrick, 2026-08-22 — the routes entered the sitemap only hours ago in v1.74.0; nothing has accumulated link equity). The sitemap stops advertising the retired routes in the same change, and every internal link is repointed.

The **admin** MB Progress screens (`/admin/advancement/mb-progress` and its `[mbId]` drill-in) are **out of scope by Patrick's explicit decision (2026-08-22: "the scope is for public only")** — no admin route, nav, or behavior changes ride along. He also asked for the overlap between the two sides to be considered rather than ignored; that analysis is the dedicated "Admin Overlap" section below. (The only admin file touched is a one-line comment fix: its doc header references "the public /merit-badges page," which stops existing.)

## Problem / Opportunity

Merit badges currently live in two public places: `/merit-badges` (catalog + per-badge tracker detail) and `/library/mb/[mbId]` (resources + proof submission). Each links to the other ("Troop Library resources" one way, "badge tracker page" the other), which means a scout working a badge bounces between two URLs for one subject. Patrick wants one destination: the Library, keeping its catalog layout, with tracker content folded into each badge page above the proof flow.

Bonus fixes the move delivers (defects found while reading — see Notes): the tracker grid's scout links point at a route that does not exist, and the library badge page ships with no `metadata` export (untitled browser tab).

## Acceptance Criteria

- [ ] `/library/mb/[mbId]` renders, top to bottom: page header (badge name, Eagle tag, kicker, BSA page + workbook links, jump link to "I did this"), troop narrative (when present), stat strip (Earned / In Progress / Not Started / Active Scouts), scout-progress grid (or its empty state), requirements reference tree, whole-badge resources, per-requirement resource groups, then the "I did this" proof picker last.
- [ ] Stat numbers on `/library/mb/archery` match what `/merit-badges/archery` showed before the move (same ledger derivation, verified against production data in browser).
- [ ] Scout names in the grid render via `publicScoutName()` (first name + last initial) and link to `/scouts/[id]`.
- [ ] `/merit-badges` and `/merit-badges/[mbId]` return 404 (route directories deleted; no redirects — decided).
- [ ] `/sitemap.xml` no longer contains any `/merit-badges` URL and contains one `/library/mb/{id}` URL per merit badge.
- [ ] `grep -rn "merit-badges" src/app src/lib` (excluding admin fast-entry tab ids, `scouting.org` URLs, and the deleted dirs) returns no internal route references — advancement CTA, library home "Full catalog →", site footer, about page, and the library badge page's own lede link are all repointed or removed.
- [ ] `/library/mb/[mbId]` exports `metadata` (badge-appropriate title/description).
- [ ] Design-system census, ESLint firewall, and seo tests pass with the moved code; `/admin/styleguide/public` scoreboard updated in the same commit as the CSS move.
- [ ] Full quality gate green: `npm run lint` + `npm run typecheck` + `npm run test` + `npm run build` (all four — build alone does not typecheck `tests/`).

## Test Plan

Named before implementation, repo convention (`{Subject}_{Behaviour}_When{Condition}`, vitest `it()` names as in `tests/seo.test.ts`). New pure logic is extracted from the page into `lib/` first so it is unit-testable (the D-049 convention this repo already follows).

**`tests/mb-scout-progress.test.ts`** (new — pure fold of ledger rows → per-scout progress, extracted from the retiring page's `loadDetail`):
- [ ] `MbScoutProgress_MarksScoutAwarded_WhenLedgerHasMbAwardRow` — a `kind:'merit_badge_award'`, `code:'MB:{mbId}'` row sets `awarded`.
- [ ] `MbScoutProgress_CollectsLeafCodes_WhenLedgerHasCompositeCodes` — `'{mbId}-{code}'` rows land in that scout's code set with the bare leaf code.
- [ ] `MbScoutProgress_KeepsCompositeParsingCorrect_WhenMbIdContainsHyphens` — `first-aid-5a` parses to leaf `5a`, not `aid-5a` (the hyphenated-id bug class already fixed once in the `mb_progress` view — migration `20260719060000`).
- [ ] `MbStatCounts_FloorsNotStartedAtZero_WhenStartedScoutsExceedActiveCount` — the `Math.max(totalActive - started, 0)` guard (inactive scouts with history).
- [ ] `MbStatCounts_SplitsEarnedFromInProgress_WhenSomeStartedScoutsAreAwarded`

**`tests/mb-scout-grid.test.tsx`** (new, `dom` project — the grid extracted as a presentational component with plain props):
- [ ] `MbScoutGrid_RendersPublicScoutName_WhenScoutHasProgress` — asserts "Alex M." form, never `display_name`.
- [ ] `MbScoutGrid_LinksScoutRowToScoutsRoute_WhenRendered` — asserts `/scouts/{id}` (fixes the dead `/advancement/{id}` link the old page shipped).
- [ ] `MbScoutGrid_RendersAwardStar_WhenScoutHasAwardRow`
- [ ] `MbScoutGrid_MarksLeafCellDone_WhenScoutCompletedThatLeaf`

**`tests/seo.test.ts`** (updates + additions):
- [ ] `BuildSitemap_EmitsLibraryMbPath_ForEveryMeritBadge` — `/library/mb/camping` present.
- [ ] `BuildSitemap_NeverEmitsRetiredMeritBadgesPaths` — no URL contains `/merit-badges` for any input.
- [ ] Update `BuildSitemap_IncludesEveryStaticMarketingPath` and `BuildSitemap_SurvivesEmptyContent_WithTheStaticPathsIntact` — they iterate `STATIC_SITEMAP_PATHS`, which loses `/merit-badges`; the existing `.toContain('/merit-badges/camping')` assertion in `BuildSitemap_IncludesEveryPublishedArticle_EventCategoryAndMeritBadge` flips to the library path.

**`tests/design-system-census.test.ts`** (update, same commit as the move):
- [ ] Inline-style `SANCTIONED` map: the key `'(public)/merit-badges/[mbId]/page.tsx': 2` (the RequirementsTree depth-indent `/* dynamic */` sites) moves to the new file path with the code. Hex allowlist is value-keyed, so the two commented celebration-gold deliberates (`#f5d76a`/`#5a3a00`) survive the CSS relocation unchanged — but the file's own comment mentions minting `--award-gold` on a third use; this is the second-plus-relocation, not a third use, so no token yet.
- [ ] `PublicApp_ContainsNoInternalLinksToRetiredMeritBadgesRoutes` (new grep-shaped invariant, alongside the census greps) — no `href` to `/merit-badges` anywhere under `src/app`, so a future link can't quietly resurrect a 404.

Page-level section ORDER on the merged server component is verified by browser verification against dev (it is an async RSC with five parallel DB reads — a jsdom harness for it would test the mock, not the page), plus the acceptance checklist above. Revert any test inserts afterwards (standing memory: test-data cleanup).

## Technical Approach

**1. Page composition — tracker above, proof below, one scroll.** The merged `/library/mb/[mbId]` order is: header → narrative → stat strip → scout grid → requirements tree → resources (whole-badge, then per-requirement) → "I did this". Reasoning: Patrick is explicit that the tracker content replaces the top and "I did this" moves down. A parent or leader landing here gets the counts first — exactly what the retired page led with. A scout gets the natural study → do → claim order: what the badge asks (requirements), what helps (resources), then the claim (proof picker) at the end, adjacent to the requirement labels it asks them to pick from. Discoverability of the relocated picker is preserved with an in-page anchor jump link ("Done with a requirement? I did this ↓") in the header/lede region. No tabs, no accordion: default-simplest satisfies the request, and D-070 (native `<details>` shipping blank content twice) plus the proof picker's own always-expanded redesign (D-13x, 2026-08-19) both argue against click-to-reveal here. The requirements tree stays even though the picker lists every leaf — the tree carries optionality notes ("Do ONE of…") and full labels the radio list doesn't, and it's part of "everything on the individual merit badge display" Patrick asked to relocate.

**2. SEO retirement — sitemap edit, no redirects (decided).** Per Patrick 2026-08-22: the v1.74.0 sitemap is hours old, so the retired URLs carry no link equity worth preserving — the route directories are deleted and 404 naturally; no redirect map. What ships in the SAME change as the deletion: (a) `STATIC_SITEMAP_PATHS` in `lib/seo.ts` drops `/merit-badges` (`/library` is already listed); (b) `buildSitemap()`'s per-badge loop emits `/library/mb/{mb.id}` instead of `/merit-badges/{mb.id}` — a sitemap advertising dead URLs is a self-inflicted quality signal independent of the redirect question. Metadata/JSON-LD consequences, one sentence each: the retired pages rendered no JSON-LD (only news/events/layout do), so nothing migrates; robots.txt needs no change (its default blocks only private surfaces and never mentioned `/merit-badges`); the destination page gains the `metadata` export it currently lacks, carrying forward the retired pages' title/description intent ("<Badge> — Merit Badge — Scout Troop 79", live-progress description).

**3. PII / audience — same audience, but a deliberate reversal to surface. Verified:** both `/merit-badges/[mbId]` and `/library/mb/[mbId]` are fully public — no family/leader/identity gate on either (`viewerIsLeader()` on the library page only *widens* resource visibility for leaders; `gateAudience()` only tailors the proof picker's copy). Scout names render as `publicScoutName()` (first name + last initial) and that treatment moves with the grid, so **who can see scout names does not change**. What DOES change: the library badge page's own doc header currently promises "deliberately NOT personalized … no scout data renders either way" — this plan knowingly reverses that stance for troop-wide (not viewer-personalized) data, and the sitemap will now actively advertise the name-carrying pages at their new URL, as it did the old ones for a few hours. This is flagged as **Open Question 1 for Patrick, not decided here.** The `?viewScout` param stays dropped on this page (Open Question 2 offers the alternative).

**4. Composite-code contract — untouched.** The Resource Library keys stay exactly as they are: `library_placements` targets `mb:{mbId}` and `mb_req:{mbId}-{code}`; the proof picker continues emitting `mb_req:{mbId}-{code}` into `/library/submit-proof`. The relocated tracker derives its grid from `ledger_entries` composite codes (`{mbId}-{code}` leaves, `MB:{mbId}` awards) — a read-side sibling of the same convention, no schema or key change anywhere. Verified in `library-data.ts`, the placement query in the library page, and the picker.

**5. PostgREST 1000-row cap.** The merged page adds three reads to the library page's existing five: the ledger read (already wrapped in `fetchAllRows()` on the source page — copied verbatim, stays paginated), the active-scouts list, and the active-scout head-count (both far under the cap). `merit_badge_requirements` is read per-badge on both pages today (≤ ~120 rows for the largest badge — under the cap, noted not assumed unbounded-safe forever). Retiring the public catalog *removes* one `fetchAllRows(mb_progress)` full-table read from the public surface (the admin catalog keeps its own).

**6. CSS and enforcement.** The classes the detail needs (`statStrip`/`stat*`, `gridScroller`/`grid`/head/cell family, `rankPill`, `eagleTagLarge`, `actionRow`/`actionLink*`, `req*` tree family) move into a new colocated `src/app/(public)/library/mb/[mbId]/mb-tracker.module.css` rather than into `library.module.css` (already 439 lines; colocating keeps the library-routes-only module from doubling and keeps the tracker styles next to their one consumer). Catalog-only classes (`catalogGrid`, `count*`, `catalogCard*`) die with the catalog. `merit-badges.module.css` is deleted with its route. Census consequences are in the Test Plan; the styleguide scoreboard note ships in the same commit (AGENTS.md same-commit rule — the public styleguide's residuals list also currently names "merit-badges ×2", which gets updated).

**7. Extraction for TDD.** The ledger fold and stat math move from the page body into pure `lib/mb-scout-progress.ts`; the grid becomes a presentational `MbScoutGrid` component (props in, markup out). Tests land red first against the extraction, then the page composes the tested pieces — no logic left inline that a test can't reach.

**8. Internal link repoints** (the complete set, from a verified grep): `/advancement`'s `MbProgressCta` → `/library` (copy reworded: "Browse every merit badge in the Library…"); library home `MbGrid` divider's "Full catalog →" link removed (the grid IS the catalog now); `site-footer.tsx` "Merit Badges" FooterLink → `/library`; `about/page.tsx` "merit badge" link → `/library`; the library badge page's own lede link to the "badge tracker page" removed (it becomes self-referential). The retired detail page's "Troop Library resources" link dies with the page.

## Admin Overlap — Analysis Only (Admin Ships Unchanged)

Patrick: "I do think we need to consider the same mb functionality in admin. There is significant overlap with the public site." He is right, and the overlap is precisely locatable:

**Genuine duplication (verified line-against-line, not an impression):**
- **Catalog counts.** `loadCatalog()` in `(public)/merit-badges/page.tsx` and `loadCatalog()` in `admin/(workspace)/advancement/mb-progress/page.tsx` are the same function twice: same three parallel reads (`merit_badges`, `fetchAllRows(mb_progress)`, active-scout head count), same `byMb` fold, same `completed`/`partial`/`notStarted = Math.max(totalActive - rows.length, 0)` math, same `CatalogCard` interface. This plan **deletes the public copy** with the catalog page, which retires half the duplication by itself — the admin copy becomes the only one.
- **Per-scout detail fold.** `loadDetail()`'s ledger fold is byte-for-byte identical in `(public)/merit-badges/[mbId]/page.tsx` and `admin/.../mb-progress/[mbId]/page.tsx`: the same `.or('code.like.{mbId}-%,code.eq.MB:{mbId}')` + `archived_at`/`deleted_at` filters through `fetchAllRows`, the same `byScout` Map fold (award flag on `MB:{mbId}`, leaf codes sliced off `{mbId}-` composites), the same `startedScouts` filter and stat derivation. This is exactly what step 2 extracts into pure `lib/mb-scout-progress.ts` for the public page's TDD — the tests written for it serve both sides.
- **Requirement-tree rollup — already shared correctly.** Both sides import `buildReqTree`/`flattenLeaves`/`topLevelCodeOf`/`bsaPageUrl`/`workbookUrl` from neutral `lib/mb-helpers.ts`. This is the existing proof that lib-level sharing is the right mechanism here.

**Superficially similar — should stay separate:** the grid *rendering*. The admin grid is a working tool — every cell is a clickable link into `/admin/advancement/fast-entry?scout=…&mb=…&req=…` for one-click sign-off (filled cells reopen Fast Entry to confirm/undo); the public grid is display-only. They also live in different CSS universes (`mb-progress.module.css` on `--admin-*` tokens vs public tokens), and the firewall forbids sharing markup/styles outside the three sanctioned crossings (`scout-accordion.module.css` earned its crossing by being *one report rendered identically in both places* — these two grids are intentionally NOT identical, so no crossing is justified). Same numbers, different job: keep two renderers.

**Different on purpose (must never converge):** admin shows full `display_name` (public must stay `publicScoutName`); admin loads the counselor list (`merit_badge_counselors` joined to `leaders` names — leader PII that has no public surface); admin gates on `requireCapability('advancement.write')`; admin cells link into the sign-off workflow.

**Recommendation — sharing mechanism and timing:** share only the pure data fold, as a neutral `src/lib/mb-scout-progress.ts` both sides import (never a cross-import; the firewall is mechanically enforced by `eslint.config.mjs` and the census test). The extraction itself ships **with the public move** because the public move cannot be TDD'd cleanly without it — it is created for the public page regardless. **Admin adoption of that module is a separate follow-up plan** (park `Plans/Admin-MB-Progress-Shared-Fold.md` when this activates): rewiring the admin drill-in adds regression risk to a leader sign-off tool and nothing to Patrick's stated priority, which is that the Library becomes the one public place for merit badges. After this plan ships, the remaining duplication is exactly one fold in one admin file, with a tested lib module sitting ready for it — a small, safe, independently shippable refactor.

## Implementation Steps

1. **Red tests:** add `tests/mb-scout-progress.test.ts` and `tests/mb-scout-grid.test.tsx` (stubs failing for the right reason); update/add the seo sitemap tests; add the no-retired-links census invariant (it fails until step 5 completes — acceptable inside one branch, all steps ship as one release).
2. **Extract:** `lib/mb-scout-progress.ts` (pure fold + stat counts) and `MbScoutGrid` presentational component (scout link target corrected to `/scouts/[id]`); green the new unit/component tests.
3. **Merge the page:** rebuild `/library/mb/[mbId]/page.tsx` in the section order of Approach #1 — add the three tracker reads to its `Promise.all`, add the `metadata` export, add the anchor jump link, move the proof picker to the bottom; rewrite the file's doc header (its "no scout data" promise is no longer true); create `mb-tracker.module.css`; update the census `SANCTIONED` inline-style key and the `/admin/styleguide/public` scoreboard in this same commit.
4. **Repoint internal links** (Approach #8, all five sites).
5. **Retire:** delete `src/app/(public)/merit-badges/` entirely; edit `lib/seo.ts` (`STATIC_SITEMAP_PATHS`, `buildSitemap` badge loop); update the stale comment in `app/sitemap.ts` ("same reason /merit-badges and /advancement carry it") and in `admin/(workspace)/advancement/mb-progress/page.tsx`; the no-retired-links test goes green.
6. **Quality gate:** `npm run lint` + `npm run typecheck` + `npm run test` + `npm run build` — all four.
7. **Browser verification** on dev against prod-shaped data: Archery stats match the pre-move numbers; grid renders; proof picker still reaches `/library/submit-proof` with a correct `mb_req:` target; `/merit-badges` 404s; `/sitemap.xml` clean. Revert any test data touched.

## DECIDED (Patrick, 2026-08-22)

Answers to the open questions below. Where a question is answered here, the answer wins over
the plan body.

**1 — Scout names on the public library badge page: YES.** Render as **first name + last
initial** (`publicScoutName`), which is what `/merit-badges/[mbId]` already does. The audience
is unchanged (both pages are public), but the destination page's header still carries a "no
scout data renders here" note from 2026-08-07 — that note must be REWRITTEN in the same
commit, not silently contradicted, so the next reader learns the policy changed and why.

**2 — Catalog-level counts: build a Resources / Progress TOGGLE on the library's merit badge
grid.** Not the full triple on every tile, and not dropping progress.

Why, from the live data (69 badges offered, 528 `mb_progress` rows):

| Number | Non-zero on | Verdict |
|---|---|---|
| Earned | **63 of 69** badges, spread 1–21 | Carries real information |
| In progress | **13 of 69** | A column of dashes at catalog level |
| Not started | derived (`activeScouts − started`) | Almost no information per badge |

Three numbers on 69 tiles is ~207 figures with roughly 120 zeros. The toggle keeps the tile at
ONE number and lets the reader choose which noun it counts.

Shape:
- A two-option control above the grid: **Resources** (default, today's behaviour) and
  **Progress** (scouts who have earned the badge).
- A caption under the grid naming what the number currently means, so a bare integer is never
  ambiguous.
- The full Earned / In progress / Not started triple still appears on the **badge page**, in
  the stat strip — nothing is lost, it is just not all on the catalog at once.
- **Copy the pattern from the photo library's view tabs** (`albums-browser.tsx`, v1.77.0,
  2026-08-22): one URL param so a chosen view is shareable, one `localStorage` key so it is
  remembered, both hydrated in a single mount effect. Same problem, already solved once.

Query cost is NET-NEUTRAL for the site: Progress mode needs `fetchAllRows(mb_progress)` plus an
active-scout count, which is exactly what the retiring `/merit-badges` catalog already runs.
It moves; it is not added. Load it unconditionally rather than on toggle — it is one paginated
read and gating it would mean a loading state on a tab flip.

**3 — Scout-row link target: `/scouts/[id]`,** as the plan assumed. Note the defect it found:
the old grid's `/advancement/{scoutId}` links are dead today (no such route), so this is a bug
fix riding along, not just a move.

**4 — `?viewScout`: still open.** Keep the current drop-it behaviour for now; highlighting the
viewing scout's row is a later enhancement, not part of this move.


### The link sweep (exact, confirmed with Patrick 2026-08-22)

Retiring `/merit-badges` and `/merit-badges/[mbId]` leaves seven touchpoints. No redirects
(Patrick: the sitemap URLs are hours old and unlikely to be crawled), so every one of these is
a real edit, not a safety net — a missed line is a live 404 for a visitor, not just a crawler.

| # | File | Today | Change |
|---|---|---|---|
| 1 | `app/(public)/advancement/page.tsx:208` | The "MERIT BADGE PROGRESS / See every merit badge → / OPEN CATALOG" stripe | **Remove the stripe entirely.** It is the only merit-badge furniture on that page; nothing else there changes. |
| 2 | `app/(public)/library/page.tsx:308` | `Full catalog →` at the top-right of the BROWSE BY MERIT BADGE divider | **Remove.** The grid below it becomes the full catalog, so repointing it at itself would be a link to nowhere new. |
| 3 | `app/(public)/library/mb/[mbId]/page.tsx:139` | Dek: "For requirements and troop progress, see the **badge tracker page**." | **Rewrite the sentence.** After the merge that link is self-referential — the requirements and troop progress are now ON this page. |
| 4 | `app/(public)/library/mb/[mbId]/page.tsx:12` | Header comment: "no scout data renders either way" | **Rewrite.** The page now renders scout names by decision (first + last initial). A stale comment contradicting the code reads as a violation, not a policy change. |
| 5 | `app/_components/site-footer.tsx:28` | Footer nav: `Merit Badges` → `/merit-badges` | **Point at `/library`** (Patrick, 2026-08-22). A dead footer link appears on every page of the site, so this one is the highest-blast-radius miss. |
| 6 | `app/(public)/about/page.tsx:104` | Prose link "merit badge tracker" | Repoint at `/library`. |
| 7 | `lib/seo.ts` | `/merit-badges` in `STATIC_SITEMAP_PATHS`; `buildSitemap()` emits `/merit-badges/{id}` per badge | Drop the static entry; switch the per-badge loop to `/library/mb/{id}`. **`tests/seo.test.ts` asserts `/merit-badges/camping` today** — it fails until updated in the same commit, which is the intended tripwire. |

Also confirmed: **keep the Resources / Progress toggle** (item 2 above) after seeing that it is the
only thing preserving at-a-glance troop progress once the catalog retires. `/library`'s LAYOUT is
unchanged — same tiles, same grid, same rank accordions, same search — but the page is not
untouched: one link out (#2), one control in (the toggle).


## Open Questions

- [ ] **PII confirmation (the big one):** `/library/mb/[mbId]` will now display scout names (first name + last initial) and appear in the sitemap. The audience is unchanged — both pages are and were fully public — but this reverses the library badge page's deliberate "no scout data renders here" design (recorded in that file's own header, from Patrick's 2026-08-07 personalization ask). Confirm: troop-wide scout-name grid on a public, sitemap-advertised library page is intended. If not, the grid needs a gate or the move stops.
- [ ] **`?viewScout` on the merged page:** keep dropping it (current behavior, simplest), or should the grid highlight the viewing scout's row now that scout rows exist here? Default: keep dropping; highlight is a later enhancement if wanted.
- [ ] **Scout-row link target:** the old grid linked to `/advancement/{scoutId}`, which is not a route (404 today — see Notes); the roster links to `/scouts/[id]`. Plan assumes `/scouts/[id]` is the intended target — confirm.
- [ ] **Catalog-level progress counts are consciously dropped:** the retired `/merit-badges` catalog showed Earned/In-Progress/Not-Started per badge at the catalog level; the library's MB grid shows resource counts (and the viewer's own completions). Patrick said the library catalog "is sufficient" — confirm that losing at-a-glance troop progress per badge until you click through is acceptable (adding counts to the library grid would add a `fetchAllRows(mb_progress)` read to `/library` home; not planned).

## Notes

**Defects/contradictions found while reading (recorded, not fixed here):**
- `/merit-badges/[mbId]` links each scout to `/advancement/${sc.id}` — no such route exists (`src/app/(public)/advancement/` has no `[scoutId]` segment; the canonical scout page is `/scouts/[id]`, which the roster uses). Every scout-name link on the live tracker detail 404s today. The move fixes it via `MbScoutGrid`.
- `/library/mb/[mbId]/page.tsx` exports no `metadata` — untitled tab / no description on a public page that is about to join the sitemap. Fixed by the move.
- Stale comments that will dangle after retirement: `app/sitemap.ts` ("same reason /merit-badges … carry it"), admin `mb-progress/page.tsx` ("Same data the public /merit-badges page shows"), and the public styleguide residuals rows naming merit-badges. All updated in steps 3/5.

**Verified in code (not assumed):** both surfaces ungated-public; `publicScoutName` helper and its use; ledger read pagination via `fetchAllRows`; sitemap emission of `/merit-badges` + per-badge entries and the `STATIC_SITEMAP_PATHS`/`NEVER_SITEMAPPED` mechanics (`lib/seo.ts:355-445`); no JSON-LD on either surface; census hex allowlist value-keyed vs inline-style allowlist path-keyed; the five internal link sites; the existing `meeting-plan` redirect precedent in `next.config.ts` (not used — redirects ruled out); both admin MB Progress files read in full for the overlap analysis (`admin/(workspace)/advancement/mb-progress/page.tsx` and `[mbId]/page.tsx` — catalog fold and detail fold confirmed duplicated verbatim, counselor/leader reads confirmed admin-only, `advancement.write` gate confirmed).

**Assumptions (marked as such):** largest requirement catalog stays well under 1,000 rows per badge; deleting a route directory is the whole retirement (no route handlers or rewrites elsewhere reference `/merit-badges` — grep found none); Google has not meaningfully crawled the hours-old sitemap entries (Patrick's stated premise for no-redirects).

**Decisions & memory relied on:** D-040/D-089 (`force-dynamic` on DB-reading public pages — the merged page already carries it), D-049 (pure extraction for testability), D-069 (no hover-only information), D-070 (no native `<details>` for must-see content), resource-library-architecture memory (composite keys, badge-granularity pages), postgrest-1000-row-cap memory, feedback-simplify-dont-layer (one destination, not two), test-data-cleanup memory, Patrick 2026-08-22 no-redirects decision, AGENTS.md public design-token rules + same-commit styleguide rule, root CLAUDE.md four-part quality gate.
