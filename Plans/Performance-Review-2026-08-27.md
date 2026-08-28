# Performance Review — 2026-08-27

**Status:** Releases 1–4 shipped 2026-08-27 (items 1–6, 8, 9, 13 — marked DONE below); the rest open. Patrick: "some forms take 3–4 s, signup clicks
are delayed, the calendar consolidation made admin screens slow — top ten places to refactor."

## What the numbers say

- **The database is not the bottleneck.** Production `pg_stat_statements`: every app query is
  cheap (PostgREST RPCs 1–18 ms mean; `set_config` 0.1 ms × 280k requests). Tables are tiny:
  ledger 10.6k rows / 5 MB, people 141, calendar_entries 110, event_attendance 1.3k, signup_entries 36.
- **The cost is round trips × latency.** Vercel functions run in `iad1` (Virginia); Supabase is
  `us-east-2` (Ohio) — ~10–15 ms per trip. A page that makes 30 sequential trips spends ~450 ms
  waiting before it renders anything. Nothing in `src/lib` uses `React.cache()`; nothing uses
  `unstable_cache`; `createAdminClient()` is a fresh client per call.
- **Almost nothing is cached at the edge.** Build: **72 of 80 routes are dynamic (ƒ)**; only
  `/events`, `/about`, `/join`, `/meeting-plan`, `/calendar.ics` are static. Every other public
  page pays a function invocation + its full waterfall per visit, and cold starts add ~1 s.
- **Measured (prod, warm):** `/events/[id]` 600–780 ms TTFB, `/events/[id]/signup` 590–815 ms,
  home 270–400 ms, `/library` 270–360 ms, `/scouts/[id]` 360–420 ms. Cold: home 1.2 s, library 2.0 s.
- **Signup page = ~68 DB round trips per render**: `loadSignupContext` (~33 reads) runs twice —
  once in `generateMetadata`, once in the page body — plus 2 layout reads.

## Ranked list (worst first)

| # | Surface | Where | Mechanism | Growth | Fix | Effort |
|---|---|---|---|---|---|---|
| 1 | Public event + signup pages (DONE v1.111.0) | `events/[id]/signup/page.tsx:54,107`; `events/[id]/page.tsx:54,127,158` | `loadSignupContext` / `loadEventDetail` / `loadSeoSettings` run **twice per request** (generateMetadata + body); no `React.cache()` anywhere | ×2 of a growing number | Wrap `loadSignupContext`, `loadEventDetail`, `loadHouseholds`, `loadSeoSettings`, `loadArticleTokens`, `loadCalendarCategories`, `getIdentitySessionIfValid`, `loadPersonAuthz`, `resolveAdminActor` in `cache()` from `react`. Single highest-value change, touches no behaviour. | S |
| 2 | Signup click ("delayed") (DONE v1.111.0) | `events/[id]/actions.ts:306` | `sendSignupConfirmations` (config + 2 templates + snapshot ×2 + 6 reads + Resend HTTP + log writes) is **awaited before the redirect** | Grows with recipients | Run it in `after()` from `next/server`; redirect immediately. | S |
| 3 | Every gated event/signup view (DONE v1.111.0) | `signup-context.ts:88` `loadHouseholds()` | Loads the **whole troop** (households, household_members, people, scouts, relationships, leaders — 6 unbounded selects) then keeps one household for non-superusers | O(troop) per view | When `canSwitchHousehold` is false call `loadHouseholdByKey(sessionKey)` (exists, `households.ts:315`) and skip `loadHouseholds`. | S |
| 4 | Admin Signup Roster (DONE v1.111.1) | `rosters/[id]/roster-view.tsx:122-123` | `signup_slot_claims` and `signup_answers` selected with **no signup filter** — whole tables; also full `scouts`/`households`/`people` | Grows per person per event; **silently truncates at 1,000 rows → wrong roster** | Filter claims by `slot_id in (slots)`, answers by `signup_entry_id in (entries)`. Correctness fix, not only speed. | S |
| 5 | Roll Call › "Mark everyone who signed up" (DONE v1.112.0) | `calendar/[id]/roll-call/actions.ts:187-191` | `for … await markAttended()` — each iteration re-runs `requireCapability` (RPC), `loadEntryContext`, credit sync, and 4 `revalidatePath` | ~8 trips × N signups (30 scouts ≈ 240 trips + 120 revalidations) | Hoist auth + context out of the loop; one batch upsert RPC; revalidate once. | M |
| 6 | Roll Call checkbox (DONE v1.112.0) | `roll-call/roll-call.tsx:122` | `router.refresh()` after every toggle → full workbench RSC re-render (~10 queries incl. whole `person_directory`) | 30 taps per meeting | `useOptimistic` local state; refresh on tab exit; debounce qty. | S |
| 7 | Calendar workbench load | `calendar/[id]/page.tsx:81-88 → 93-102 → 110-155` | Three **serial** query phases (entry+categories → meeting/signup/count → tab data) plus `resolveAdminActor` ×3–4 per render (`layout.tsx:37`, `page.tsx:71`, `roster-view.tsx:93`, `money-view.tsx:12`) | Fixed ~3× RTT floor before tab data starts | `cache()` the actor (item 1); one RPC for entry+category+meeting+signup+count; then tab load in parallel. | M |
| 8 | Public layout, every page (DONE v1.113.0) | `(public)/layout.tsx:16`; `article-body/ArticleStyleTokens.tsx:17`; `passkey-offer-gate.tsx` | `site_settings` + `article_style_tokens` read uncached on every request and force every page dynamic; `@simplewebauthn/browser` statically imported into the shared layout chunk | Constant tax on all traffic | `unstable_cache` both with tags bumped by Lookups saves; `next/dynamic` the offer with `ssr:false` inside the `show` branch. Then the home/library/about-style pages can become ISR. | S |
| 9 | `revalidatePath` fan-out | `events/actions.ts` (37 sites), `lookups/actions.ts:131-140,1058-1066`, `roll-call/actions.ts:26-31`; public `actions.ts:316,371` | **Corrected 2026-08-27 (v1.113.0):** on a dynamic route `revalidatePath` only refreshes the client router cache, which admin screens rely on — the fan-out is not a server cost. What hurt: signup writes purging `/events` (the one ISR page) and three `revalidatePath('/', 'layout')` site-wide purges (patrols, and the two settings saves that legitimately change every page). | Only on static/ISR pages | DONE: signup submit/cancel no longer purge `/events`; patrol saves no longer purge the site; the settings saves keep their layout purge and additionally `updateTag`. Tag migration of the other 30+ sites is not worth doing. | S |
| 10 | Audits | `advancement/audits/page.tsx:72-77` | 7 check modules each re-read `scouts`, `rank_requirements`, and paginate `ledger_active` independently (~30–40 queries; +1 trip per 1000 ledger rows per check) | Doubles per 5k ledger rows | Load once, pass a shared snapshot into each `run(input)`; or SQL views. | M |
| 11 | Agenda tab | `meeting-plan/load-input.ts:22-82` via `load-agenda.ts:52` | Opening Agenda runs the meeting-plan engine's 13-query fan-out incl. 4 `fetchAllRows` loops (`merit_badge_requirements` 1.7k rows, `mb_progress`, `ledger_active` twice) | Ledger-linear, weekly | `unstable_cache` the catalog half (ranks/MB reqs/skills) with a tag; make candidates a lazy client fetch on tray open. | M |
| 12 | Signup write path | `events/[id]/actions.ts:173-306` | ~20 sequential awaits: two guard cookie reads + two `person_authz`, two `signup_entries` updates, per-slot claim read/delete/RPC, per-set unplace/place | O(slots × people) | Batch claim deletes `.in()`; one entry update; pass session through guards (item 1 covers the reads). | M |
| 13 | Missing indexes (DONE v1.111.1 — only four were really missing; see migration) | `supabase/migrations/*` | No index on `event_signups(calendar_entry_id)` (filtered on every workbench/roll-call/calendar load), `signup_slots(event_signup_id)`, `signup_questions(event_signup_id)`, `event_prices(event_signup_id)`, `signup_answers(*)`, `signup_group_sets(event_signup_id)`, `signup_groups(set_id)`, `signup_group_members(set_id)`, `signup_slot_claims(slot_id)`, `reimbursement_requests(calendar_entry_id)` | Slow bleed on the fastest-growing tables | One migration, ten single-column indexes. | S |
| 14 | Admin Calendar list | `calendar/page.tsx:42` + `calendar-editor.tsx:150-151` | Every `calendar_entries` row ever (21 cols + `hero_media(*)`) serialized into a client component that shows one tab | Unbounded, weekly | Rolling window server-side (`entry_date >= now − 1y`) or paginate Past by URL. | S |
| 15 | Signup forms (client) | `person-first-form.tsx` (1016 lines, 14 `useState`), `slot-first-form.tsx` (741) | Whole household + slots + groups + questions as RSC props; `useMemo` over the full party at `:370,:406`; every keystroke in a note re-renders the whole tree | O(household × slots) | Memoized per-person row components; uncontrolled text inputs. | M |
| 16 | Ledger admin + Dashboard | `advancement/ledger/page.tsx:80-89,118`; `dashboard/page.tsx:101-107,115,139` | Five catalogs re-read per navigation; `count: 'exact'` over `ledger_active` each time; dashboard paginates all rank-requirement rows and awaits a `people` read after its `Promise.all` | `count exact` is O(rows), weekly | `unstable_cache` catalogs (tag from lookups); `count: 'estimated'`; readiness as an RPC/view. | M |
| 17 | Admin roster + Signup Roster loaders | `advancement/roster/page.tsx:115,198`; `rosters/[id]/roster-view.tsx:139-371` | `person_directory` `select('*')` (3-CTE view) then `directory.find()` inside a loop over every membership (quadratic); roster-view runs six serial awaits after its `Promise.all` and reads `person_directory` a second time (money-view reads it again) | 100 people × 100 memberships today | `Map` by person_id; `Promise.all` the independent reads; one `cache()`d directory loader. | S |
| 18 | `/advancement`, `/library/mb/[mbId]`, `/photos`, `/scouts/[id]` | `advancement/page.tsx:29,45`; `library/mb/[mbId]/page.tsx:64,108-137`; `photos/page.tsx:32`; `lib/scout-detail.ts:75,169` | `force-dynamic` full-table reads with no cache; MB page duplicates a count query (`:137`) and re-reads `merit_badges` in metadata; photos unbounded `select('*')`; clipboard paginates `ledger_active` then a serial `merit_badge_requirements` tail | Roster/ledger-linear | `revalidate` + tag-invalidated `unstable_cache` for catalogs and summaries; drop the duplicate count; paginate albums; fold the MB fetch into the `Promise.all`. | M |

## Suggested order

1. **Cache the loaders (#1) + `after()` the email (#2) + own-household loader (#3)** — one
   small release; should roughly halve signup-page time and remove the click delay.
2. **Fix the unfiltered roster reads (#4) + the ten indexes (#13)** — correctness + cheap.
3. **Roll Call seeding loop (#5) + optimistic checkbox (#6)** — the admin "consolidation is
   slow" complaint, most of it.
4. **Layout caching (#8) + tag-based revalidation (#9)** — unlocks ISR for the public site and
   stops writes from clearing the one static page.
5. Then the workbench RPC (#7), Audits/Agenda snapshots (#10, #11), and the rest as they bite.

Not on the list on purpose: moving the Supabase project to `us-east-1` (same as Vercel) would cut
every round trip by ~10 ms but is a one-way migration; do the caching first and see.

Sources: pg_stat_statements + curl timings on prod (2026-08-27), `next build` route table, two
read-only code sweeps (admin, public); items #2 and #4 verified by hand.
