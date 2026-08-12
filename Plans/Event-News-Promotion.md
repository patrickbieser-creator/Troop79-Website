# Event → News Promotion (port of OMG D-011)

**Status:** SHIPPED through v1.30.0 (2026-08-09). Two follow-ups parked below — this plan stays open until both land.

## Follow-ups (designed 2026-08-09, Patrick's decisions — build next sessions)

### 1. calendar_categories lookup table — BUILT 2026-08-12, not yet deployed
Patrick: "no more hardcoded categories — a lookup table so I can enter it dynamically."

Built as designed, with both open questions answered by Patrick on 2026-08-12:
**photo albums SHARE the lookup** (not frozen), and the name-coupled code gets
**behavior flags** (not pinned rows).

- Migration `20260812000000_calendar_categories_lookup.sql`: table (label PK,
  color, sort_order, behavior), seeded from the 14 hardcoded categories with
  their Bugle legend colors; FK from BOTH `calendar_entries.category` and
  `photo_albums.category` with ON UPDATE CASCADE (the rename tool) / ON DELETE
  RESTRICT; both old CHECK constraints dropped; FK-column indexes; RLS enabled
  with a read-all policy, matching the tables it classifies.
- `behavior` ('meeting' | 'no_meeting', partial-unique, delete-guarded by
  trigger) replaces the three name comparisons: `lib/meetings.ts`'s hardcoded
  `['Troop Meeting','No Meeting']`, the Event Signups screen's
  `.neq('category','No Meeting')`, and meeting-view's `category === 'No Meeting'`
  (now an `isNoMeeting` flag resolved server-side).
- `CalendarCategory` union deleted; `CATEGORY_COLORS`/`CATEGORIES`/`categoryColor`
  replaced by `lib/calendar-categories.ts` (pure helpers) +
  `loadCalendarCategories()` in `lib/calendar.ts`; 18 files rethreaded to take
  the rows/color map as props. CSV import validates against the lookup per run,
  so a new category is importable the moment it's created.
- Admin CRUD: "Calendar Categories" card in Lookups & Admin (add / rename /
  recolor / reorder; behavior rows have no Delete button; in-use delete comes
  back refused with a reason).
- Tests: `tests/calendar-categories.test.ts`, 13 cases (cascade to entries AND
  albums, delete-restrict, behavior guard, behavior uniqueness, FK rejection on
  both tables, color fallback, sort order). Suite 102 → 115.
- **Deploy order: migration goes to prod BEFORE the code push** — new code
  queries `calendar_categories` on nearly every page, and old code is unaffected
  by the table's existence. No second (drop_legacy) migration needed.
- Still Patrick's to do after deploy: create "Merit Badge Opportunity" /
  "Service Opportunity" himself, worded his way.

### 2. Full-page story editor for events (the "big event" layer)
Approach A confirmed: progressive enhancement on one spine — no event types.
- `details_md` gets the news editor's split-pane markdown experience (editorShell,
  ArticleBody preview, media picker, gallery tokens) in an event workbench
  reachable per calendar entry REGARDLESS of signup (note: /admin/events/[id] is
  keyed by SIGNUP id today — the workbench needs an entry-keyed route).
- Promotion fields surface there too; the quick-entry Events dialog stays as-is
  with an "Open full event page →" escalation link.
- Decision rule shipped in the taxonomy: family needs to DECIDE something →
  story layer; just needs to KNOW → calendar line is the whole treatment.
- End-state noted 2026-08-09 (admin rename): "Event Signups" eventually folds
  into the workbench as a layer, resolving the Events/Event Signups nav pair.

**Original status:** In progress 2026-08-08
**Source:** OMG-Website `Plans/Completed/Event-News-Promotion.md` + `Agents/Architect/Memory/DECISIONS.md` [D-011], shipped there 2026-08-08 (PR #11). Reference implementation: `OMG-Website/src/lib/feed-logic.ts`, `src/lib/home-feed.ts`, migration `20260808120000_event_news_promotion.sql`.
**Priority:** High — same double-entry disease, worse here (three overlapping representations).

## The problem, Troop 79 shape

1. `calendar_entries` — the real calendar; Event Signup hangs off it; `/events`, `/events/[id]`, ICS.
2. `articles type='event'` — parallel event representation with its own `event_start/end/location/registration_url`. The homepage "Upcoming Events" sidebar reads ONLY these — an event appears there only if someone hand-writes a duplicate article (the Rummage Sale currently exists as both).
3. `calendar_entries.article_id` — optional "read the full story" link (the same link OMG dropped).

## Decisions locked (Patrick, 2026-08-08)

1. **Convert existing `type='event'` articles to `news`**; where a matching calendar entry exists, set up its promotion and archive the duplicate article (data step, judged per row on prod).
2. **Homepage sidebar reads the real calendar — ALL upcoming categories**, weekly meetings included.
3. **Hero rule (diverges from OMG's recency rule): a featured, in-window promoted event WINS the hero slot for its window**; featured articles resume after.
4. **Include `auto_archive_at`** on both articles and calendar entries (view/loader-enforced, no cron; `current_date` is UTC → flips ~6-7pm Central, accepted as at OMG).

## Deliberate divergences from OMG

- No `time` column work — Troop 79's calendar deliberately has no time-of-day (documented in the calendar_entries migration header).
- No `active`/`is_recurring` checks in `isPromoActive` — the columns don't exist here; every entry is dated, so null `promo_end` = through `end_date ?? entry_date`.
- No public archive toggle page (OMG's `/news?archive=1`) — the homepage IS the news index here. `articles_archived` view is still created for a future surface; admin continues to see archived rows.
- Auto-archived calendar entries are hidden from lists/feeds/ICS but `/events/[id]` STAYS reachable by direct link — event pages carry live signups and links circulate in signup confirmations.
- Retiring `articles.type='event'` entirely (OMG never had an article-side event type): type CHECK tightens to `('news','recognition')`, the four `event_*` columns drop, editor loses the type option, `/news/[slug]` loses its event-meta block, sidebar loader switches source.

## Schema (one migration)

**articles:** add `auto_archive_at date`; `update … set type='news' where type='event'`; re-create type CHECK as `('news','recognition')`; drop `event_start,event_end,event_location,event_registration_url`; replace `articles_public` view (adds `and (auto_archive_at is null or auto_archive_at > current_date)`); add `articles_archived` view.

**calendar_entries:** add `show_on_homepage bool not null default false`, `featured bool not null default false`, `promo_start date`, `promo_end date`, `excerpt text`, `hero_media_id bigint FK media on delete set null`, `auto_archive_at date`; drop `article_id`; partial index `(promo_start) where show_on_homepage`.

## Code

- `src/lib/feed-logic.ts` — pure: `isAutoArchivedOn`, `isPromoActive`, `mergeFeed`, `pickHero` (event-wins rule), `eventCardExcerpt`. No Supabase/Next imports.
- `src/lib/home-feed.ts` — `loadPromotedEntries`, merged homepage feed; sidebar loader for upcoming calendar entries. All via `createAdminClient` (house rule).
- Homepage — hero may be an event (category chip + date, links `/events/[id]`); grid merges by date (page 1 only; promoted events exempt from tags/pagination counts); sidebar from calendar.
- `article_id` removal sweep — `calendar.ts` (join + `articleSlug`), `calendar-browser.tsx`, `month-grid.tsx`, calendar editor + actions, `types.ts`.
- Editors — article editor: drop event type/fields, add auto-archive date; calendar editor: promotion section (show-on-homepage → window/excerpt/hero picker/featured, auto-archive date) reusing `_components/media-picker.tsx`.
- Public loaders — exclude auto-archived from `loadCalendarEntries`/`loadAllCalendarEntries`/ICS; `loadEventDetail` unchanged (see divergences).

## Test plan (first: failing tests)

Port of OMG's suite, adapted: promo window (before/inside/after; null promo_end through event date; dateless entry promoted until unchecked), auto-archive date logic, merge sort, hero pick (event-wins + no-event + no-article + not-featured event loses), excerpt fallback (explicit / description-truncation / empty).

## Post-deploy data steps (prod — judge per row, data differs from local)

1. Migration converts event-articles to news automatically.
2. Rummage Sale: set promotion on its calendar entry; archive the now-duplicate article. Same judgment for Summer Camp / Court of Honor articles.

## Rollout — TWO migrations, split exactly as OMG's were

Live code depends on what gets dropped: `calendar.ts`'s `'*, articles(slug)'` join traverses the `article_id` FK, and `loadUpcomingEvents` filters on `event_start`. Dropping before the deploy breaks the live homepage/calendar.

- **Migration A (additive)** — new columns, views, type conversion. Prod BEFORE the code push (old code ignores new columns).
- **Migration B (drop_legacy)** — drop `article_id`, `event_*`, tighten type CHECK. Prod AFTER the new code is live (new code references none of it).
