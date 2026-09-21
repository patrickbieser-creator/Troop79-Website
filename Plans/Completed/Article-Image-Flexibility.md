# Article Image Flexibility

**Status:** Complete — v1.129.0 (A+B), v1.130.0 (C renderer), v1.131.0 (C authoring), all 2026-09-21
**Parked:** 2026-09-21 · **Activated:** 2026-09-21 (Patrick: "Go!", show_hero OK, no-caption labels OK)
**Priority:** High — a live article (`/news/rummage-sale`) was showing a cropped flyer

## Overview

Give news and event **detail pages** more room for images than the homepage feed cards get.
Three author-facing changes, all on the shared markdown renderer (`src/lib/article-body/`) and
the article editor: (A) let an author keep a hero for the card/social preview but hide it at the
top of the article; (B) show body images at full height, width-constrained, instead of cropping
them to a 16:9.5 letterbox; (C) let a body image be a link — to its own full-resolution file or
to an internal/external URL — with a visible affordance and a real insert/edit dialog.

The homepage cards keep their crops (`news-cards.module.css:22,98`). Out of scope by decision.

## Problem / Opportunity

`/news/rummage-sale` carries the sale flyer twice. The **hero** renders width-fixed / height-free
(`article-detail.module.css:30-38`, fixed 2026-08-14 — the CSS comment even names this poster).
The **inline body image** does not: `FigureImage` (`ArticleBody.tsx:56-66`) renders into
`.figImg { aspect-ratio: 16/9.5; object-fit: cover }` (`article-body.module.css:42-43`) via
`<Image fill>`, so a portrait flyer loses most of itself. The hero fix never reached body figures.

Two adjacent gaps surfaced while diagnosing:

- The article editor has Choose/Change Hero Image but **no Remove and no hide**
  (`article-editor.tsx:202-213`); the calendar entry form has Remove (`entry-form.tsx:370-380`).
  The hero also feeds `og:image` (`news/[slug]/page.tsx:47`), JSON-LD (`:74`) and the card
  thumbnail, so "just remove it" has a hidden cost for a volunteer author.
- A linked image is native markdown (`[![alt](src "cap")](href)`), and react-markdown emits
  `<p><a><img/></a></p>` for it (verified with a probe 2026-09-21). With our `img` → `<figure>`
  override that becomes `<p><a><figure>` — invalid nesting, a real hydration error. Today an
  author who tries it gets a broken page.

No test covers `ArticleBody` rendering at all (`tests/article-tokens.test.ts` is design tokens,
not markdown). This plan adds the first one.

## Acceptance Criteria

**A — Hero control (articles only; `/events/[id]` renders no hero)**
- [x] Article editor hero field has **Remove** (clears `hero_media_id`, parity with calendar).
- [x] Article editor has a checkbox **"Show hero image at top of article"**, default checked,
      placed directly under the Choose/Change/Remove buttons, with the hint
      *"Still used as the card thumbnail and social preview image even when hidden here."*
- [x] Unchecked → `/news/[slug]` renders no `.articleHero`; `og:image`, JSON-LD `image`, and the
      homepage/category card thumbnail still use the hero. Existing articles unchanged.
- [x] Checkbox is part of the dirty-gated Save / Discard standard (the editor's `draftKey`).

**B — Body figures show the whole image**
- [x] `.figImg` matches `.articleHero img`: `width: 100%; height: auto`, no `aspect-ratio`, no
      `object-fit: cover`, no max-height guard. Radius `var(--rad-sm)`, placeholder background
      `var(--border-light)` (both currently hardcoded/absent on `.figImg`).
- [x] `FigureImage` renders a plain `<img>` (same `eslint-disable no-img-element` as the hero).
      Design-system census test stays green (no new raw hex, no inline style).
- [x] `/news/rummage-sale` body flyer shows full height on desktop and phone (browser-verified).

**C — Linked images**
- [x] `[![alt](src "cap")](href)` renders `<figure><a href><img></a><figcaption>…</figcaption></figure>`
      — never `<p><a><figure>`. An image alone in a paragraph, linked or not, is unwrapped from `<p>`.
- [x] Link kinds: `href === src` → **full-size**, new tab; `href` starts with `/` → **internal**,
      same tab; anything else → **external**, new tab. New-tab links carry `rel="noopener noreferrer"`.
- [x] Affordance: when a caption exists it is rendered as the link text (standard `.articleBody a`
      styling — underline + `--forest`, visible `--focus-ring`); when there is no caption a small
      auto line is rendered: "View full size ↗" for full-size, "Open link ↗" for external, "Open →"
      for internal. The image itself is also inside the link (large tap target).
- [x] Insert Image no longer uses `window.prompt`: a small dialog with **Caption** and
      **Link to: None / Full-size image / A URL** (URL field revealed only for "A URL"), default None.
- [x] Body images get **edit-in-place** in the editor preview (Edit button, same as gallery/video),
      reopening the dialog prefilled and splicing the updated markdown over the original span —
      the *outer link span* when the image is linked.
- [x] Rendering is identical on `/news/[slug]`, `/events/[id]`, and the editor preview (shared
      `ArticleBody`; the public pages pass no `onEditBlock`, so no Edit button leaks).

## Test Plan

New `tests/article-body.test.tsx` (dom project — renders `ArticleBody` to static markup) and
additions to `tests/article-publish.test.ts` (db project). Stubs first, throw until filled.

Renderer (B + C):
- [x] `Reader_SeesPlainImg_WhenBodyHasAnImage` — no `data-nimg="fill"`, `<img src alt>` inside `<figure>`.
- [x] `Reader_SeesNoParagraphWrapper_WhenImageIsAlone` — regression guard for the existing unwrap.
- [x] `Reader_SeesNoParagraphWrapper_WhenLinkedImageIsAlone` — `<p>` never contains `<figure>` or `<a><figure>`.
- [x] `Reader_SeesImageInsideLink_WhenMarkdownLinksIt`
- [x] `Reader_OpensNewTab_WhenHrefEqualsSrc` — `target="_blank"` + `rel="noopener noreferrer"`.
- [x] `Reader_StaysInTab_WhenHrefIsInternal` — no `target`.
- [x] `Reader_OpensNewTab_WhenHrefIsExternal`
- [x] `Reader_SeesCaptionAsLinkText_WhenCaptionPresent`
- [x] `Reader_SeesViewFullSizeLabel_WhenLinkedWithoutCaption`
- [x] `Reader_SeesOpenLinkLabel_WhenExternalWithoutCaption`

Remark offsets (C edit-in-place):
- [x] `Remark_AnnotatesImageSpan_WhenImageStandsAlone` — `data-start`/`data-end` cover `![…](…)`.
- [x] `Remark_AnnotatesOuterLinkSpan_WhenImageIsLinked` — span covers `[![…](…)](…)`, not the inner image.
- [x] `Remark_LeavesTokenBlocksUntouched_WhenImagesAreAnnotated` — gallery/video still dispatch.

Markdown builders (C authoring, pure functions in `tokens.ts`):
- [x] `Author_GetsPlainImageMarkdown_WhenLinkIsNone`
- [x] `Author_GetsSelfLinkedMarkdown_WhenFullSizeChosen` — href === src.
- [x] `Author_GetsUrlLinkedMarkdown_WhenUrlChosen`
- [x] `Author_GetsCaptionQuoted_WhenCaptionContainsQuotes` — escaping round-trip.
- [x] `Parser_RoundTripsBuilderOutput_ForAllThreeLinkKinds` — `parseImageMarkdown(build(x)) ≡ x`.

Hero (A):
- [ ] ~~`Leader_SavesShowHeroFalse_WhenUncheckedOnSave`~~ — NOT written: the Server Action needs a
      session cookie this suite cannot mock (D-049). Browser-verified instead (uncheck → save →
      public page has no hero, `og:image` intact).
- [ ] ~~`Leader_ClearsHero_WhenRemovePressed`~~ — NOT written, same boundary; qa-lead confirmed the
      Remove path reuses the pre-existing absent-`heroMediaId` → null mapping unchanged.
- [x] `Loader_ReturnsShowHeroFalse_ThroughArticlesPublicView` + `Loader_DefaultsShowHeroTrue_…` —
      the recreated view exposes the column; default covers older inserts.
- [x] Browser-verified (not unit): hidden hero → no `.articleHero`, `og:image` still present.

## Technical Approach

- **A** — additive column `articles.show_hero boolean not null default true`. `articles_public`
  and `articles_archived` are `select *` views created 2026-08-09 — Postgres freezes `*` at
  creation, so the migration must `drop`/`create` both views (same pattern as
  `20260809010000_event_news_drop_legacy.sql:51-60`) or the loader never sees the column.
  **Deploy order: DB-first** — the code writes the column, code-first would break every article
  save (the v1.128.0 lesson). Remove = `setHero(null)`; the action already maps an empty
  `heroMediaId` to null (`articles/actions.ts:40-52`).
- **B** — one CSS rule change + `FigureImage` swaps `<Image fill>` for `<img>`. Accept layout
  shift on load; do not thread `media.width/height` through markdown (Jenna: machinery for a
  cosmetic concern markdown intentionally can't express; the hero has lived with it since 08-14).
- **C renderer** — add an `a` component override: when its sole child is a `FigureImage` element,
  render `<FigureImage {...child.props} href={href} />` instead of `<a>`; otherwise plain `<a>`.
  `FigureImage` gains an optional `href` and owns the link-kind logic (a small pure
  `classifyImageLink(href, src)` in `tokens.ts`). `ParagraphOrFigure` unwraps when its sole child
  is `FigureImage` *or* the `a` override whose sole child is `FigureImage`. No new `{{token}}` —
  the project rule (tokens only for what markdown can't express) and "simplify, don't layer" both
  hold; the DB body stays plain CommonMark.
- **C offsets** — extend `remarkArticleBlocks` with a `visit(tree, 'image', (node, i, parent))`
  pass that sets `hProperties['data-start'/'data-end']` from the node's position, using the
  parent `link`'s position when the image is that link's sole child. Only annotate images that
  are the sole child of their paragraph (inline mid-sentence images are not editable blocks).
- **C authoring** — `ImageDialog` component beside `MediaPicker` in `_components/`, used for both
  insert (after picking media) and edit (prefilled via `parseImageMarkdown(raw)`). Extend
  `EditableBlockInfo.type` with `'image'`; `FigureImage` renders `EditBlockButton` when given
  `onEditBlock` + offsets, exactly like the token blocks. Splice through the existing
  `insertAtCursor` / replace-range path in `markdown-block-tools.tsx`.
- Email is unaffected: `email-markdown.ts` excludes images by design.
- Other `ArticleBody` consumers (library resource pages, reports) inherit B and C automatically —
  desirable; they had the same crop.

## Implementation Steps

Ship in three commits so the rummage-sale fix lands first (Jenna's sequencing).

1. **v1.129.0 — B + A.** Write the renderer tests for B, then `.figImg` + `FigureImage`.
   Migration (`show_hero` + recreate both views) → push to prod DB → then code: loader type,
   editor checkbox + Remove + draftKey, action, page conditional. Quality gate, browser-verify
   rummage-sale on desktop + phone, deploy, changelog.
2. **v1.130.0 — C renderer.** Tests for link kinds/affordance/unwrap, then the `a` override,
   `FigureImage href`, `classifyImageLink`, caption-as-link CSS. Deploy. At this point Patrick can
   hand-type `[![…](…)](…)` and it works.
3. **v1.131.0 — C authoring.** Builder/parser tests, remark offset tests, then `ImageDialog`,
   replace the prompt, edit-in-place wiring. Styleguide specimen if the dialog introduces a new
   admin pattern (segmented control) — same commit, per AGENTS.md.

Each step: `npm run lint && npm run typecheck && npm run test && npm run build`, qa-lead review
before deploy (step 1 touches a migration + view recreation; step 3 touches shared parsing).

## Open Questions

- [x] Column name `show_hero` (checkbox reads "Show hero image at top of article") — OK, or prefer
      `hero_on_page`?
- [x] Rummage sale specifically: once A ships, Patrick unchecks the hero on that article himself
      (content decision, not a migration) — confirm that's the intent rather than deleting the
      duplicate body image.
- [x] "Open →" for an internal link with no caption — keep, or require a caption for internal links?

## Notes

- Jenna review 2026-09-21 (micro): both Remove and the toggle, because Remove-only "silently kills
  the Facebook-share thumbnail for a volunteer who never reads that far." Caption-as-link because
  hover doesn't exist on the troop's phones. Flagged but out of scope: `FigureImage` renders
  `alt ?? ''` — flyers uploaded without alt text are invisible to screen readers (owner: MediaPicker
  upload); `FigureImage` returns `null` on a bad `src` with no broken-image affordance.
- qa-lead 2026-09-21 (step 1, SHIP): body markdown images were previously constrained to the
  Bunny hostname by `next/image`'s `remotePatterns`; a plain `<img>` loads whatever URL an author
  typed, and the leader review preview renders it before any accept/reject. Not XSS (no
  `rehypeRaw`); worst case an external tracking pixel, blunted by `Referrer-Policy`. Acceptable
  for known families — revisit (server-side proxy/allowlist) if public submissions ever open wider.
- qa-lead 2026-09-21 (step 3, SHIP): the editor's inline-prompt family (`markdown-block-tools`:
  gallery link, video, and now the image form with its `.radio`/`.radioGroup`) has NO specimen on
  `/admin/styleguide/admin` — pre-existing debt, missed for the third time. Backfill the whole
  family in one pass (BACKLOG).
- Latent, not in scope: an image mid-sentence (not alone in its paragraph) still renders a
  `<figure>` inside `<p>` — same invalid nesting. Nobody has authored one yet. Fix if it bites.
- Jenna has no project memory yet (`Agents/Jenna/Memory/` empty); seed SURFACES/PATTERNS from this
  work at end-session if the directory convention is adopted.
- Related: D-? (2026-08-14 hero un-crop, `article-detail.module.css:30-36`), v1.126.1 proof-photo
  new-tab pattern, Save-button standard (`Plans/Completed/Save-Button-Rollout.md`).
