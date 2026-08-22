# Photo Library Restyle

**Status:** ACTIVE — decided by Patrick 2026-08-22, in build
**Parked:** 2026-08-22
**Priority:** Medium
**Prototype:** `prototypes/photo-library-concepts.html` (six working concepts, one scroll)

## DECIDED (Patrick, 2026-08-22)

Brad recommended Print Shelf + Ledger behind a toggle. Patrick went further and took the
tabbed shell from Concept 6 with **four** views rather than two:

> "I liked the tabbed approach introduced in option 6, it should include tabs in this order:
> print shelf, timeline spine, the ledger, and the almanac views as the four tabs with all of
> the features brad suggested on each screen."

**Tab order is specified and not ours to re-sort:**

| # | Tab | Carries |
|---|---|---|
| 1 | **Print Shelf** (default) | every feature from Concept 2 |
| 2 | **Timeline Spine** | every feature from Concept 1 |
| 3 | **The Ledger** | every feature from Concept 3 |
| 4 | **The Almanac** | every feature from Concept 5 |

Concept 4 (Year Shelf) and Concept 0 (today's grid) are **not** shipped. Concept 6's own
demo content is superseded by this four-tab arrangement — it contributed the shell, not the
view list.

**Print Shelf tweak (Patrick, 2026-08-22):** the title and the date go on **separate lines**,
not run together on one meta line.

**Still open — the Almanac's axis (Brad's Q7).** Calendar quarters keep left-to-right reading
forward in time but file a September Court of Honor under "Summer"; true seasons read better
but break strict chronology. Chronology is one of the four hard requirements, so the build
defaults to **calendar quarters** unless Patrick says otherwise.

**Known cost, accepted:** Print Shelf is the image-heaviest of the four and is the default
tab, so until `Plans/Photo-Thumbnails.md` lands it loads 1–4 MB PNG covers. Mitigate with
lazy-loading below the fold; the real fix is that plan.


## Overview

Restyle the public photo library at `/photos`. Patrick asked for several presentation
concepts, with a hard constraint that **date, title, category and chronology** must all
stay legible; description and photo count are negotiable. Six concepts were built as a
single interactive prototype running on the real fourteen `photo_albums` rows.

The prototype answers the question as asked ("how else might this be presented?"), but
investigating the data turned up two things that matter more than the styling and are
listed under Problem / Opportunity below.

## Problem / Opportunity

**1. Album cards are indistinguishable from news cards.** Both use the same recipe —
16:10 image box, 17px Playfair title, meta line, hover lift. Nothing in the card says
*this is 209 photos* rather than *this is an article*. This was the known backlog item and
it is real.

**2. The library is smaller than the layout assumes.** Fourteen albums, not sixty. The
three-across grid inside year groups is a layout for a library five times this size:

| Year | Albums | In a 3-col grid |
|------|--------|-----------------|
| 2026 | 9 | three full rows — fine |
| 2025 | 3 | one full row — fine |
| 2024 | 0 | year absent entirely |
| 2023 | 0 | year absent entirely |
| 2022 | 2 | orphaned row of two |

**3. There is a two-year content hole.** No albums exist for 2023 or 2024 at all. Today's
design hides this, because a year with no albums simply never renders a heading. Three of
the six concepts surface it deliberately. Whether that is desirable is a content question
for Patrick, not a design decision.

**4. Category colors are read from the wrong place — this is a live bug.**
`albums-browser.tsx` hardcodes a `CATEGORY_CLASS` map from category label to palette
token. But categories live in `calendar_categories`, which carries an authoritative
`color` column that the public calendar already renders (`month-grid.tsx`,
`colors: CategoryColorMap`). The hardcoded map is missing five live labels, and one of
them is in production: **"Troop 79 — 2025 in Review" is `Recruiting / Outreach`, which has
no entry, so it silently falls through to the default navy chip** instead of its DB color
`#a04a3d`. Fixable in an hour, independent of any restyle.

**5. Cover weight is the page's whole performance budget.** Roughly 1–4 MB per PNG cover ×
14 albums, all above the fold. No concept here can beat that without an image derivative
pipeline, and `lib/bunny-storage.ts` shows a Bunny *Storage* zone with no evidence of
Optimizer or `?width=` transforms.

## The Concepts

| # | Name | Thesis |
|---|------|--------|
| 1 | **The Spine** | Stop grouping by time and start drawing it — one continuous rail, every album a dated node, gaps included. |
| 2 | **The Print Shelf** | Make an album look like a stack of prints, not a story card. |
| 3 | **The Ledger** | Trade every image for scanability — a sortable index that loads in zero bytes. |
| 4 | **The Year Shelf** | One horizontal shelf per year; a two-album year looks deliberate on a shelf, broken in a grid. |
| 5 | **The Almanac** | Years down, seasons across — show that the troop's year rhymes. |
| 6 | **One Index, Three Lenses** | Don't pick one; let the visitor choose how the same filtered set is drawn. |

### Against the four hard requirements

| Concept | Date | Title | Category | Chronology | Reads as a collection | Image weight | Works at 14 albums | Effort |
|---------|------|-------|----------|------------|----------------------|--------------|--------------------|--------|
| 0 · Today | Month only | Yes | Chip; 5 labels unmapped | Year groups | **No** — same recipe as news | ~25 MB | Sparse years break the row | — |
| 1 · Spine | Exact day | Yes | Node color + chip | **Strongest** — gaps shown | Yes — a log, not a feed | ~85 KB | Excellent | ~1 day |
| 2 · Print Shelf | Exact day | Yes | Corner sticker | Year groups + full dates | **Strongest** — stack silhouette | Needs derivatives | 4-up, better than 3-up | **~½ day** |
| 3 · Ledger | Exact day, sortable | Yes | Column, sortable | Default sort + year rows | Neutral — it's an index | **Zero** | Excellent | **~½ day** |
| 4 · Year Shelf | Exact day | Yes | Corner sticker | Horizontal = weaker signal | Yes — shelf reads as a set | Lazy, in-view only | Best for sparse years | ~1 day |
| 5 · Almanac | Day + month | Yes | Border color | Two axes — linear + cyclical | Yes — reads as an archive | Zero | **Only 7 of 20 cells filled** | ~1.5–2 days |
| 6 · Three Lenses | inherits from the active lens — that is the design constraint | | | | Yes, via Prints | Visitor's choice | Yes | +~2 hrs |

All six preserve date, title, category and chronology. They differ on everything else.

## Recommendation

**Ship Concept 2 (Print Shelf) as the default view and Concept 3 (Ledger) as the alternate,
joined by Concept 6's toggle. Roughly 1.5 days total.**

- **Concept 2** solves the stated problem — album-as-news-story — with a CSS rewrite over
  markup that already exists. The stack silhouette costs two pseudo-elements. Highest
  design return per hour of the six.
- **Concept 3** solves weight, scanning and accessibility with a real `<table>`, no images,
  and no new query. It is also the only concept that stays good if the library triples.
- **Concept 6's toggle** is ~2 hours (one `view` state, one URL param beside the existing
  `?category=&year=&q=`, one `localStorage` read) and removes the need to choose between
  browsing and finding.

**Concept 1 (Spine)** is the strongest of the six on chronology and the best-looking, but
at fourteen albums it largely duplicates what year-grouping already does. It is the right
*third* lens once the first two ship, not the place to start.

**Concept 5 (Almanac)** is the most interesting idea here and the weakest fit today — it
fills 7 of 20 cells. Revisit in two years.

## Acceptance Criteria

- [ ] Album cards are visually distinguishable from news cards at a glance, without reading text
- [ ] Every album shows its exact date, title and category in the default view
- [ ] Chronological order is preserved in every view, and switching views never reorders data
- [ ] Category color is read from `calendar_categories.color`, not a hardcoded map; all live labels render their DB color
- [ ] No new CSS token or font is introduced; no new raw hex in public CSS
- [ ] `/photos` cover payload drops below 1 MB total on first load
- [ ] The chosen view persists across navigation and is shareable via URL
- [ ] New patterns have specimens on `/admin/styleguide/public` in the same commit
- [ ] Keyboard: every album reachable and activatable; sortable headers expose `aria-sort`
- [ ] Renders correctly at 480 / 640 / 900 breakpoints

## Test Plan

- [ ] `Visitor_SeesExactDate_WhenViewingAnyAlbum()` — every card/row exposes day-level date
- [ ] `Visitor_SeesDbCategoryColor_WhenCategoryHasNoHardcodedMapping()` — regression for the `Recruiting / Outreach` bug
- [ ] `Visitor_SeesAlbumsNewestFirst_WhenNoSortApplied()` — default chronology
- [ ] `Visitor_KeepsChronology_WhenSwitchingViews()` — order identical across lenses for the same filter
- [ ] `Visitor_SeesYearSeparators_WhenSortedByDate()` — and that they disappear under other sorts
- [ ] `Visitor_SeesEmptyState_WhenFiltersMatchNothing()` — one empty state shared by all views
- [ ] `Visitor_RestoresChosenView_WhenReturningToPage()` — persistence
- [ ] `Visitor_CanReachEveryAlbum_UsingKeyboardOnly()` — focus order and visible focus ring
- [ ] `Visitor_SeesAllAlbums_WhenAlbumCountExceedsPostgrestCap()` — guard: albums are well under 1000 rows today, but the loader should not silently truncate

## Technical Approach

- **Category color:** delete `CATEGORY_CLASS` from `albums-browser.tsx`; pass a
  `CategoryColorMap` from the server component exactly as `events/page.tsx` →
  `month-grid.tsx` already does. Apply as inline `style={{ '--catColor': color }}` with a
  `/* dynamic */` comment — the sanctioned pattern, not a new token.
- **View toggle:** one `view` state alongside the existing filter state; extend the
  existing `replaceState` sync to carry `&view=`; hydrate from URL first, `localStorage`
  second, default third.
- **Print Shelf:** almost entirely a rewrite of `photos.module.css`. Same JSX shape as
  today's card, minus the description paragraph. Stack pseudo-elements drop below 640px.
- **Ledger:** a real `<table>` with `<caption>`, `scope` attributes and `aria-sort`. Year
  separators render only while sorted by date, which is how chronology stays defended
  under user sorting.
- **Images:** blocked on the pipeline decision (see Open Questions). Until it lands,
  the Ledger is the only concept that is unambiguously faster than today.

## Implementation Steps

1. Fix the category color source and add its regression test. Ship independently.
2. Rewrite `photos.module.css` as the Print Shelf; drop the description from the card.
3. Add the Ledger view component.
4. Add the view toggle, URL param and persistence.
5. Add specimens for the print card and ledger row to `/admin/styleguide/public`.
6. Quality gate: `npm run lint` + `npm run typecheck` + `npm run test` + `npm run build`.
7. Browser-verify at 375 / 768 / 1280.

## Open Questions

**None of this is ready to activate until 1 and 2 are answered.**

- [ ] **1. The 2023–2024 hole.** Do those albums exist and simply were never added, or did
      the troop not collect them? Concepts 1, 4 and 5 all render the gap explicitly. If the
      albums exist, adding them changes which concept wins. If they don't, should the gap
      be labelled honestly or quietly skipped?
- [ ] **2. Cover derivatives.** `lib/bunny-storage.ts` is a plain Storage zone — no
      Optimizer, no `?width=`. Enable the Bunny Optimizer add-on (paid, needs Patrick's
      call), or generate derivatives at upload time in the admin uploader? Concepts 2 and 4
      are only wins once this is settled.
- [ ] **3. Is `description` worth keeping?** 2 of 14 are null and several restate the title
      verbatim. Every concept drops or demotes it. Retire the field, or make it required
      and useful at entry?
- [ ] **4. How much do we trust `photo_count`?** The type comment calls it
      leader-maintained and approximate; "2025 in Review" claims 1,024. Concept 3 promotes
      it to a sortable column with a proportional bar, which is only a good idea if the
      number is roughly right.
- [ ] **5. Default view and persistence.** Prints everywhere, or List on phones? Persist in
      `localStorage`, or URL only?
- [ ] **6. Uniform treatment, or a hero slot?** A featured album needs a new `featured`
      boolean on `photo_albums` — a schema question, not a CSS one.
- [ ] **7. Only if the Almanac is in play: where does a season start?** Calendar quarters
      keep left-to-right forward in time but file a September Court of Honor under
      "Summer"; true seasons read better and break the chronology guarantee.

## Notes

**Considered and rejected**

- **Map view.** Appealing — Governor Dodge, Long Lake, Boundary Waters and Tesomas are all
  real places. Rejected: `photo_albums` has no location field and there is no lat/long
  anywhere in the schema. Needs a new column plus manual backfill. Worth its own plan.
- **Masonry / mosaic.** Rejected twice over: it wants *more* large images visible at once,
  the wrong direction for this page, and a masonry column flow makes reading order and
  date order disagree — which fails the chronology requirement outright.
- **Infinite scroll.** Fourteen albums. Nothing to paginate.

**Verification status of the prototype.** Render logic was executed under Node and checked
against the real data (14 albums, 3 year groups, gap detection returning `[2024, 2023]`,
zero unmapped categories, all four required fields present in all six concepts). The page
was loaded in Chrome and its DOM read back — no console errors, all six concepts populate.
**Visual/screenshot verification was not completed**: two Chrome instances are connected to
this account and selecting one requires the user, which a subagent cannot do. Layout should
be eyeballed at 375 / 768 / 1280 before any concept is chosen.

**Constraints honored.** Every color, size, space and radius in the prototype comes from
`globals.css`. No new token or font is required by any concept. The nine category colors
are database rows, not CSS tokens, and belong in a dynamic inline `style` — all nine clear
4.5:1 against white (the lightest, `#527554`, at 5.25:1); the text-only variant on cream
clears 4.8:1.
