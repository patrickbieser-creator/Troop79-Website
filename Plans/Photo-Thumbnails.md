# Photo Thumbnails — Stop Shipping 62 MB of Screenshots

**Status:** BUILT 2026-08-23 (steps 1–4, 6, 7; v1.87.0) — `lib/image-resize.ts` (resizePlan +
browser `prepareImageForUpload`), `lib/photo-backfill.ts` (pure decisions), `scripts/backfill-photo-
thumbnails.ts` (dry-run default, `--write` to upload/verify/repoint, `--alt` fills empty alt, refuses a
remote DB without `--allow-remote`), media-picker resize + before/after line, `safeImageUrl` on /photos,
data migration `20260823160000_media_cdn_url_encode_spaces.sql` (24 rows). Defaults taken: Q1 1200 px,
Q2 JPEG, Q3 originals KEPT, Q4 no Optimizer. **Step 5 — the PRODUCTION backfill — NOT run yet**
(dry run on local: 29 heavy covers, 60.7 MB → ~5.9 MB projected). Command in the Notes below.
**Parked:** 2026-08-22
**Priority:** High

## Overview

`/photos` serves 30 album covers totalling roughly **62 MB**. Twenty-six of them are
PNG *screenshots* between 0.85 MB and 4.0 MB, each rendered into a box about 400 px
wide. The page is 10–25× heavier than it needs to be, and it is the troop's most
image-forward public page — the one a prospective family scrolls.

The fix has two halves that ship independently: stop the bleeding at upload, then
repair what is already there.

## Problem / Opportunity

**Measured on production, 2026-08-21.** Worst offenders, in MB:

| Album | MB | Album | MB |
|---|---|---|---|
| summercamp2025 | 4.02 | Green-Bush-GroupOnLog | 2.68 |
| geocachinginkettlemorane | 3.60 | wintercamp-2025 | 2.60 |
| iceagetrailjune2025 | 3.50 | woodworkmb-april-26 | 2.57 |
| elroysparttrailmay2025 | 2.97 | summer-camp-2023-bear-skit | 2.48 |
| oakleaftrailcleanupapril-2025 | 2.93 | firsttroopmeeting2022 | 2.40 |
| courtofhonr2025 | 2.92 | waterballonlauncherpioneering2025 | 2.06 |
| summer-camp-2024-makajawan | 2.91 | governor-dodge | 1.99 |
| canoe-trip-may-2024 | 2.84 | bratfry2025 | 1.98 |
| MayaEagleProjectPart-1 | 2.75 | pancakebreakfast | 1.57 |

Fine as-is: `oa-elections` 0.85, `BoundaryWatersEndGroup` 0.63, `pumpkin-pavilion`
(JPEG) 0.40, `WinterCampAlbumCover` 0.20. **The one JPEG in the set is the smallest
file on the page** — that is the whole diagnosis in one line.

**Root cause.** `lib/bunny-storage.ts`'s `uploadToBunny()` sends the file exactly as
chosen — no resize, no re-encode, no format change. The Bunny **Optimizer is not
enabled** on the pull zone, so `?width=` is ignored (probed 2026-08-21). Nothing
between a leader's screenshot and a family's phone reduces a single byte.

**Why it matters beyond bytes.** This page's Largest Contentful Paint is one of these
covers. It is also the page the SEO work (v1.74.0) now actively invites crawlers to,
and Core Web Vitals is a ranking input. On a phone on a campout parking lot, 62 MB is
not a slow page — it is a page that does not load.

**Two side findings from the same audit, both cheap:**
- **Every album cover has empty `alt` text.** An accessibility defect and a wasted
  SEO signal on the most visual page on the site.
- One cover URL contains an unencoded space
  (`Klondike Team-BoyScoutChallenge-03-22.jpg`) and **does not load at all**.

## Acceptance Criteria

- [ ] A newly uploaded cover of any size lands in Bunny at **≤ 250 KB** without the
      uploader doing anything.
- [ ] The uploader sees the before/after size, so the reduction is visible rather than
      silent.
- [ ] The 26 existing heavy covers are re-encoded and `cover_url` repointed; `/photos`
      total transfer drops below **6 MB**.
- [ ] Original uploads are preserved — the derivative is a new object, never an
      overwrite.
- [ ] Every album cover has meaningful `alt` text, or a documented reason it is
      decorative.
- [ ] The unencoded-space URL loads.
- [ ] A non-image or a corrupt file still fails the way it does today; resizing never
      becomes a new way to lose an upload.

## Test Plan

Client-side resize is canvas work, so the pure part is the *decision* — what target,
what format, whether to touch the file at all. That is what gets tested; the canvas
call itself is verified in the browser.

- [ ] `ResizePlan_TargetsLongEdge1200_ForACoverImage()` — covers get the smaller box.
- [ ] `ResizePlan_TargetsLongEdge1600_ForAGeneralMediaUpload()`
- [ ] `ResizePlan_LeavesASmallImageAlone_WhenItIsAlreadyUnderTheTarget()` — never
      upscale, never re-encode a file that is already fine (the 0.20 MB cover must
      come out byte-identical).
- [ ] `ResizePlan_ChoosesJpeg_ForAPhotographicSource()`
- [ ] `ResizePlan_KeepsPng_WhenTheSourceHasTransparency()` — a logo with alpha must
      not get a black box behind it.
- [ ] `ResizePlan_RefusesANonImage_AndPassesItThroughUntouched()` — the library's PDF
      path shares this upload code.
- [ ] `FormatBytes_RendersTheBeforeAndAfterLine()`
- [ ] `BackfillScript_SkipsACoverAlreadyUnderTarget()`
- [ ] `BackfillScript_RepointsCoverUrl_OnlyAfterTheNewObjectExists()` — the failure
      that matters: a repoint with no object behind it is a broken album cover on the
      public page.
- [ ] `BackfillScript_IsIdempotent_WhenRunTwice()`

## Technical Approach

**Decision: resize in the browser before upload, not on the server, and not at Bunny.**

Three options were weighed:

| | Cost | Verdict |
|---|---|---|
| **Bunny Optimizer** | Paid add-on, per-zone. `?width=` starts working; originals stay huge in storage. | Rejected as the *only* fix — it is a monthly bill to keep shipping 4 MB originals, and it does nothing for the bytes already stored. Reconsider later as a convenience. |
| **Server-side (`sharp`) on upload** | New native dependency; must run in a Node runtime, not Edge; Vercel cold-start and bundle cost. | Rejected for the upload path. **Kept for the one-time backfill**, where it runs on Patrick's machine and none of that applies. |
| **Client-side canvas before upload** | ~60 lines, zero dependencies, zero runtime cost, and the 4 MB never crosses the wire at all. | **Chosen.** |

The client-side choice has a property the others do not: it also fixes the *upload*
being slow on a phone, which is where leaders actually add photos.

**Shape.** A `lib/image-resize.ts` with the pure planning function
(`resizePlan(file, {kind})` → target long edge, output MIME, quality, or `null` for
"leave it alone") plus a thin `resizeImageFile()` that does the canvas work. It is
called by the media manager, the album cover picker and the news hero picker — the
three places `uploadToBunny` is reached from a browser file input.

- Long edge **1200 px** for covers, **1600 px** general. Both are ~2× the largest box
  they render into, which is the retina case.
- **JPEG q≈0.82**, except sources with transparency, which stay PNG. WebP is better
  still and universally supported now, but JPEG keeps "right-click, save" behaving the
  way families expect from a photo. Revisit if the 250 KB target is missed.
- **Never upscale, never re-encode an already-small file.** Byte-identical passthrough
  is the default.
- Show the before/after ("4.0 MB → 180 KB") next to the filename. This is the part
  that teaches the behaviour.

**Backfill.** A `scripts/` one-shot using `sharp`, run against production with the
service-role key: read the 26 rows, pull the original, re-encode, upload the
derivative under a new path, verify the object is fetchable, *then* update
`media.cdn_url`/the album's cover. Originals are never deleted — storage is cheap and
this is reversible. Idempotent, so a partial run can simply be re-run.

## Implementation Steps

1. `lib/image-resize.ts` — pure `resizePlan()` first, with its tests, then the canvas
   helper.
2. Wire into the media manager upload; verify one real 4 MB screenshot in dev.
3. Wire into the album-cover and news-hero pickers.
4. Backfill script; dry-run mode that reports the byte table without writing.
5. Run the backfill against production; re-measure `/photos` total transfer.
6. Alt text: add the field to the album editor if absent, then fill the 30 covers.
7. Fix the unencoded-space URL.

## Open Questions

- [ ] **Q1 — Is 1200 px the right cover target once the restyle lands?**
      `Plans/Photo-Library-Restyle.md` has concepts with different geometry: the Print
      Shelf wants a 4:3 or square crop, the Ledger wants no images at all. Resizing to
      1200 px long edge is safe for every concept, but a *square* crop would want
      cropping at upload too. **Do the restyle decision first if it is close** —
      otherwise ship the resize at 1200 and crop later.
- [ ] **Q2 — WebP instead of JPEG?** Smaller at the same quality, universally
      supported. The only cost is that a saved file is a `.webp`. Patrick's call.
- [ ] **Q3 — Is anyone attached to the original screenshots?** The plan preserves them,
      but if the answer is "no, delete them", storage gets tidier and the backfill gets
      simpler. **This is the only question that blocks starting.**
- [ ] **Q4 — Enable the Bunny Optimizer anyway?** Not needed once uploads are sized,
      but it would make future `?width=` variants free. Monthly cost vs. never thinking
      about this again.

## Notes

- Measured on production 2026-08-21; the full byte table is in
  `Agents/Tracker/Memory/BACKLOG.md` and reproduced above.
- `uploadToBunny()` is shared with the Resource Library's **document** uploads
  (`app/admin/(workspace)/library/actions.ts:412`). The resize path must be a no-op
  for anything that is not an image — covered by the test plan, and the reason
  `resizePlan()` returns `null` rather than throwing.
- Related: `Plans/Photo-Library-Restyle.md` (Brad, 2026-08-22) — concepts 2 and 4 in
  that memo are only wins once cover derivatives exist, which is Q1's dependency in
  the other direction.
- Related: the SEO work shipped in v1.74.0 now lists `/photos` in the sitemap, which
  raises the stakes on its Core Web Vitals.

## Production run (2026-08-23, pending Patrick's go)

```
cd next-app && NEXT_PUBLIC_SUPABASE_URL=https://qyovupepjdxikyepieps.supabase.co SUPABASE_SERVICE_ROLE_KEY=<prod service role key> npm run backfill-photo-thumbnails -- --allow-remote            # dry run
cd next-app && NEXT_PUBLIC_SUPABASE_URL=https://qyovupepjdxikyepieps.supabase.co SUPABASE_SERVICE_ROLE_KEY=<prod service role key> npm run backfill-photo-thumbnails -- --allow-remote --write --alt
```
Prod service key: `npx supabase projects api-keys --project-ref qyovupepjdxikyepieps`. Bunny creds come
from `.env.local` (same zone). Re-running is a no-op. Eyeball one 4 MB screenshot through the media
picker in dev before relying on the browser resize (unit-tested + sharp-probed only).
