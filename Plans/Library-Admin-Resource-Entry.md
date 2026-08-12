# Library Admin Resource Entry

**Status:** BUILT 2026-08-12 — verified locally, not yet deployed
**Planned:** 2026-08-12
**Priority:** High — the library could not be stocked from the admin at all

## Build notes (2026-08-12)

All ten steps landed. Suite 115 → 131 (16 new: 10 integration + 6 pure).

**One deviation from the Technical Approach, taken deliberately.** The plan
called for extracting the News article editor's split-pane into a shared
component, with a documented fallback if extraction proved invasive. It did:
that editor's body surface is interwoven with article-only concerns (block-edit
prompts, gallery/gallerylink/video token builders, hero and tag state, slug
handling), and pulling it apart would have put a working, heavily-used editor at
risk for a feature that needs a fraction of it. The library post editor is
therefore its own smaller surface built on the SAME primitives — markdown
textarea, live `ArticleBody` preview, `MediaPicker` for image insert. It is not
a copy of the article editor's toolbar; it simply offers less.

**Debt recorded:** two split-pane markdown editors now exist. If the library
post editor grows toward the article editor's feature set (gallery tokens,
block editing), extract then rather than adding a third.

**Not verified in the browser:** the PDF upload path writes to the real Bunny
CDN, so it was exercised only through its pure guard tests
(`checkUpload`/`DOCUMENT_UPLOAD_TYPES`) and left untested end-to-end rather than
leaving a stray file on the production CDN. Worth one manual upload after deploy.

## Overview

Give the webmaster a first-class way to create library resources of every kind
(link, video, document, image, post) from `/admin/library`, with placements,
attribution and visibility set in the same pass — instead of the current
workaround of submitting through the family-facing form and approving your own
submission.

## Problem / Opportunity

`library_resources` rows can only be born in two places today:

1. **`/library/submit`** (public, family/scout gated) — `submitLibraryResourceAction`
   requires a URL, infers `kind` from that URL (`inferKind`), always writes
   `status='pending'`, and offers exactly one optional placement. It cannot
   produce a `post`, cannot attach a file, cannot set visibility, and cannot
   publish.
2. **`npm run import-sparkler`** — a one-purpose script that creates `post`
   resources from the newsletter archive.

Everything *around* creation already exists in admin: field editing
(`saveResourceFields`), approve / decline / archive / restore, placements with a
real target picker (topic shelves, rank requirements, whole badges, MB
requirements), pinning, topic CRUD, and requirement narratives. Creation is the
one hole, and it forces a role-play detour (submit as a family, then approve
yourself) for three of the five kinds it can't reach at all.

Two latent defects surfaced while scoping this, both in scope here:

- **`visibility` is unreachable and unenforced.** The column exists
  (`'public' | 'leaders'`, defaulted `'public'`) and is in the TS type, but no
  admin surface sets it and **no public loader filters on it** — every loader in
  `lib/library-data.ts` filters `status='published'` only. Exposing the control
  without adding the filter would leak leaders-only material to families, so the
  filter lands in the same change as the control.
- **Uploads are image-only.** `uploadMedia` allows `image/jpeg|png|webp|gif` at
  12MB; there is no path to a PDF.

## Acceptance Criteria

- [ ] The webmaster can create a resource of each kind — link, video, document,
      image, post — entirely from admin, without visiting the public site.
- [ ] Admin-created resources are `status='published'` on save (Patrick,
      2026-08-12); the queue stays exclusively for family/scout submissions.
- [ ] A "Save as draft" control parks an unfinished entry as `pending` without
      publishing it, and the queue distinguishes an admin draft from a family
      submission.
- [ ] Placements can be chosen during creation — zero, one, or several — using
      the existing target picker, and the resource lands on those pages
      immediately.
- [ ] A document can be created either by uploading a PDF or by pasting a URL.
- [ ] An image resource can be created by picking from the existing media
      library or uploading a new file.
- [ ] A post is written in the same split-pane markdown editor News uses, with
      live preview and the media picker.
- [ ] `visibility` is settable in admin AND enforced by every public loader; a
      `leaders` resource never appears on a family-visible page.
- [ ] Entry is reachable two ways: an "Add Resource" tab for deliberate entry
      sessions, and a quick "+ Add Resource" button from the Published tab.
- [ ] Existing behavior is untouched: family submissions still queue, approval
      still works, no change to how published resources render.

## Test Plan

Integration tests against local Postgres (`tests/library-admin-entry.test.ts`),
matching the existing `resource-library.test.ts` fixture discipline —
`ZZVITEST`-prefixed rows, cleaned up in `afterAll` regardless of failure.

- [ ] `AdminResource_IsPublishedOnSave_WhenCreatedByWebmaster()` — a created
      resource has `status='published'`, `reviewed_by` set, and never passes
      through `pending`.
- [ ] `AdminResource_IsPending_WhenSavedAsDraft()` — the draft path parks it in
      the queue instead.
- [ ] `AdminResource_AppearsOnItsTargets_WhenPlacementsChosenAtCreation()` —
      placements written in the same transaction show up through
      `loadPublishedFor` for each target.
- [ ] `AdminResource_RejectsNonHttpUrl_WhenUrlSupplied()` — the scheme guard
      applies to the admin write path as it does to the public one (D-060: guard
      on BOTH write and render paths).
- [ ] `AdminResource_RequiresBodyForPostKind_WhenNoUrlGiven()` — kind-specific
      completeness is enforced at publish, not at insert.
- [ ] `AdminResource_RequiresUrlOrFileForLinkKinds_WhenPublishing()` — same rule
      from the other side.
- [ ] `LeadersOnlyResource_IsHiddenFromPublicLoaders_WhenVisibilityIsLeaders()` —
      the new filter, asserted through `loadPublishedFor` and search.
- [ ] `LeadersOnlyResource_IsVisibleToLeaders_WhenSessionIsLeader()` — the
      counterpart, so the filter isn't simply "hide everything".
- [ ] `PdfUpload_IsAccepted_WhenUnderSizeLimit()` and
      `Upload_RejectsDisallowedType_WhenNotImageOrPdf()` — pure unit tests over
      the extracted type/size guard, no network.
- [ ] `SearchIndex_IncludesAdminCreatedPost_WhenBodyMdSupplied()` — the `fts`
      vector covers `body_md` (the coalesce fix), so posts are findable.

## Technical Approach

**Reuse, don't rebuild.** The form is mostly assembly of parts that already
exist: `TargetSelect` (placement picker), `MediaPicker` (image browse/upload),
the article editor's split-pane shell, and `saveResourceFields` (field
validation/update). The genuinely new code is the create action, the kind
switch in the form, the PDF upload path, and the visibility filter.

**One action, kind-driven validation.** `createResourceAction` takes the whole
form, validates per kind (`post` → `body_md` required; link/video/document/image
→ `url` or an uploaded file required; every kind → title), writes the resource
and its placements, and returns to the tab it was called from. Completeness is
enforced at *publish*, not at insert — the schema deliberately leaves
`url`/`body_md` nullable so a messy family submission can still land
(migration header, D-059); a draft save keeps that latitude, a publish does not.

**Documents do NOT get `media` rows.** A PDF uploads to Bunny and its CDN URL is
stored on `library_resources.url` directly. Putting PDFs in `media` would push
them into the image picker that News, photo albums and hero selection all use,
where every row is assumed to be a displayable image (thumbnail grid, alt text,
width/height). The library resource IS the index record for its file, so the
second index would be redundant — this is the same "don't add a parallel
system" instinct as D-082's rejection of a separate event-type lookup.
Images keep using `media` and the MediaPicker, because there the reuse is real.

**Upload guard extraction.** `ALLOWED_TYPES`/`MAX_BYTES` in
`news/media/actions.ts` become a small exported helper taking an allowed set, so
the image path keeps its current rules and the document path allows
`application/pdf` — without either path drifting from the other. `SYNCABLE_EXTENSIONS`
(the Bunny sync in Utilities) stays image-only on purpose: syncing the CDN into
`media` should not sweep up library PDFs.

**Visibility filter.** Add `.or('visibility.eq.public,...')`-style filtering to
the loaders in `lib/library-data.ts`, driven by a `viewerIsLeader` argument
resolved from the existing leader session (the same check `/admin` uses). Public
pages pass `false` unless a leader session is present. The filter is added with
its tests in the same step as the control, never later.

**Post editor.** The article editor's split-pane is currently one component
bound to `articles`. Extract the editing surface (textarea + `ArticleBody`
preview + media/gallery insert buttons) into a shared component both callers
use, rather than copying it. If extraction proves invasive on contact, fall back
to mounting the existing editor in "body only" mode and note the debt — the
sequencing below puts posts last so this risk can't block the other four kinds.

## Implementation Steps

1. **Failing tests first** — `tests/library-admin-entry.test.ts` with the cases
   above, plus the two upload-guard unit tests. Confirm red.
2. **Visibility enforcement** — thread `viewerIsLeader` through
   `lib/library-data.ts` loaders and search; make the leaders-only tests pass.
   This ships correctly on its own even if the rest slips.
3. **`createResourceAction`** — kind-driven validation, publish-by-default with
   `reviewed_by`/`reviewed_at` stamped, draft path, placements written with the
   resource. No UI yet; tests drive it.
4. **Add Resource form (link + video kinds)** — new tab on `/admin/library`,
   URL + title + blurb + attribution + visibility + placements. The two kinds
   that need no file machinery, so the form's shape is proven first.
5. **Quick-add entry point** — "+ Add Resource" button on the Published tab
   opening the same form in a dialog (matching the Events/Photo Albums pattern).
6. **Image kind** — MediaPicker integration, existing library or new upload.
7. **Document kind** — extract the upload guard, allow `application/pdf`, wire
   the upload-or-paste toggle.
8. **Post kind** — extract the split-pane editor and mount it for `body_md`.
9. **Verification** — `npm run lint`, `next build`, full Vitest suite, then
   browser-verify each kind end to end on `/admin/library` and confirm each
   appears on its target page (test rows reverted afterward).
10. **Docs** — changelog entry; note in `Plans/Resource-Library.md` that admin
    entry closed the gap; retire the "submit as a family, approve yourself"
    workaround from any leader-facing instructions.

## Open Questions

All four design forks were answered by Patrick on 2026-08-12 (publish
immediately + draft option, both upload and paste for files, reuse the news
editor, both entry points). Two smaller ones can be settled during the build:

- [ ] Should the quick-add button also appear on the Topics tab (pre-filling
      that topic as the placement)? Cheap to add once the dialog exists.
- [ ] Does `import-sparkler` stay as the path for bulk newsletter backfill once
      posts are enterable by hand? Assumed yes — it is idempotent and prod-safe,
      and hand entry is not a bulk tool.

## Notes

- Related: `Plans/Resource-Library.md` (parent plan, Phase 2 proof flow still
  pending), D-059–D-063 in Architect memory, migration
  `20260721100000_resource_library.sql`.
- The no-embeds rule (D-060) applies to anything this form creates: videos
  render as a derived static thumbnail linking out, never an iframe.
- Composite target keys are unchanged and must stay exact — `rank_req` is
  `{rankId}-{code}`, never a bare code. The existing `TargetSelect` already
  emits them correctly; the create path must not hand-roll its own.
- `requirement_submissions` (Phase 2 proof) is deliberately live-but-empty
  schema. Nothing here touches it.
