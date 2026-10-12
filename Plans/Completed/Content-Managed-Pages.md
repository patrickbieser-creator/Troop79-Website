# Content-Managed Pages

**Status:** SHIPPED v1.209.0 (2026-10-11, b3e4cd2) — phase 3 (nav from the tree) not built
**Parked:** 2026-10-11
**Priority:** High

## Overview

Patrick edits the copy of the public site's static pages himself — Join first, then About, later new child
pages — from an admin **Pages** tree (WordPress-style), using the editor the news CMS already has. No new way to
edit content: the same markdown split pane, block tools, save-state pieces and ArticleBody pipeline.

## Problem / Opportunity

Join and About are hard-coded JSX. Every copy change is a Claude session and a deploy.

## Acceptance Criteria

- [ ] `/join` and `/about` render from `site_pages` rows and look the same as today (steps, FAQ, CTA banner,
      stat strip, sidebar fact card and notes).
- [ ] `/admin/news/pages` lists pages as an indented tree (parent → children), status, quiet Edit.
- [ ] The page editor is the article editor's machinery (split pane, block tools, preview, dirty-gated Save +
      Discard, Saving… → Done); the preview renders the page's own look.
- [ ] Saving a published page updates the public page within seconds (tag + path revalidation).
- [ ] Every save writes an audit entry with from/to for changed fields (`/admin/audit`, area "pages").
- [ ] Only editors with the page capability can open or save; the table is RLS-on, service-role only.

## Test Plan

- [ ] `PageBody_RendersH2_AsSectionDivider`
- [ ] `PageBody_RendersTopLevelOrderedList_AsNumberedSteps_WithBoldLeadAsTitle`
- [ ] `PageBody_RendersH3PlusParagraph_AsFaqQuestionAndAnswer`
- [ ] `CtaToken_ParsesHeadlineSubAndButtons` / `CtaToken_RendersBanner`
- [ ] `StatsToken_ParsesValueLabelPairs` / `StatsToken_RendersStatStrip`
- [ ] `Sidebar_SplitsOnH2_IntoModules_AndLabelValueListIntoFactRows`
- [ ] `PagesTree_OrdersByParentThenSortOrder_WithDepth`
- [ ] `SavePage_RequiresPageCapability` / `SavePage_WritesAuditDiff` / `SavePage_RevalidatesTagAndPath`
- [ ] `JoinPage_RendersFromRow` (seed content round-trips: steps, FAQ, CTA, sidebar present)
- [ ] `SitePages_HasRlsEnabled_WithZeroPolicies` (db project)
- [ ] `PageEditor_SaveDisabledUntilDirty_DiscardRestoresLastSaved` (dom)

## Technical Approach

- **Table `site_pages`:** id, parent_id (self-FK), slug, path (unique), title, headline, lede, body_md,
  sidebar_md, meta_description, status draft|published, sort_order, timestamps, updated_by. Seeded with today's
  Join and About copy converted to markdown. **DB-first deploy** (code reads rows; no JSX fallback).
- **Not the articles table** — `articles_public` feeds the home page, news index, categories, sitemap.
- **Rendering:** `PageBody` beside `ArticleBody` in `src/lib/article-body/` — same remark pipeline, page-shaped
  components. Conventions: `##` → section divider; top-level `1.` list → numbered steps (leading **bold** = step
  title); `###` + paragraph → FAQ; `{{cta: Headline | sub | Label->/href | Label->/href}}` and
  `{{stats: 2022::Founded | ~30::Scouts}}` are two new block tokens beside gallery/video. Sidebar markdown splits
  on `##` into modules; a `- **Label** value` list is the fact card. Step/FAQ/CTA/fact CSS moves to a shared
  `page-body.module.css` (article prose crossing) so the admin preview matches.
- **Admin:** "Pages" under News & Events. Editor = article editor minus hero/byline/categories;
  `MarkdownPreview` gains a `render` prop (3 consumers). Draft preview via the news `loadForVisitor` pattern.
- **Cache:** `unstable_cache` tagged `site-pages` + `updateTag` and `revalidatePath(path)` on save.

## Implementation Steps

Phase 1 (this plan): table + seed migration → PageBody + cta/stats tokens → `/join` and `/about` read rows →
Pages tree + editor → audit + cache → gate → browser check → release.
Phase 2: catch-all `(public)/[...slug]` for new child pages, Add page, drag reorder (reuse `front-page-order.tsx`),
cta/stats insert buttons in the toolbar.
Phase 3 (only if asked): site nav from the tree.

## Decisions (Patrick, 2026-10-11)

- **Who edits:** anyone with `news.write` — no new capability.
- **Going live:** Save on a published page goes live (article rule); `status` gates new pages only.
- **New child pages: in phase 1.** Catch-all `(public)/[...slug]/page.tsx` renders any published row whose path
  isn't a code route; Add page (title, parent → path = parent path + slug); reorder within a parent.
- **Navigation from the tree: yes, eventually** — phase 3. Add `show_in_nav boolean default false` to the table
  now (no UI) so phase 3 needs no migration.

## Notes

Design by Fable (2026-10-11). Reuses D-081/D-088 shared editor. Pages in scope: only Join and About carry static
copy; home, events, photos, advancement, library, member are data-driven.
