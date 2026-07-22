# Resource Library

**Status:** Active
**Created:** 2026-07-21
**Priority:** High

## Overview

A troop-curated library of resources — videos, links, documents, posts — organized two ways at once: **by advancement requirement** (mirroring the rank and merit badge trees the site already tracks) and **by topic shelf** (Sparkler archive, Eagle Project trail, gear guides, the Bugle, fun). Any leader, scout, or family can submit a resource; everything passes through a webmaster review queue before publishing. Every requirement gets an optional landing page with a leader-written narrative, its resources, live troop context ("14 scouts still need this"), and — in Phase 2 — an "I did this" button that lets a scout submit proof (photo / written report / link) queued for leader review and, on approval, written to the ledger through the same duplicate-blocked path Fast Entry uses.

## Problem / Opportunity

Great teaching material (a knots video, a civic-visit explainer, a first-aid demo) currently lives in leaders' heads, group texts, and Google Classroom (barely used). There is no place keyed to *our* requirement structure where a scout stuck on First Class 9a can find what the troop recommends — or show a leader they've done it without waiting for a meeting. The site already has the requirement trees, the ledger addresses, the review-queue pattern (v1.16 `change_requests` + Needs Attention panel), the family/scout gates, Bunny CDN, and Resend email. The library is an enrichment layer over infrastructure that already exists.

## Decisions (made 2026-07-21 with Patrick)

1. **`/library` is canonical.** New section owns search, topic shelves, and requirement landing pages. Existing advancement/MB pages grow small "N resources" links into it — they do not duplicate content.
2. **Everything is queued.** All submissions — including leaders' — wait for webmaster approval before publishing. Maximum curation control.
3. **Tests deferred.** "Take a test" = a resource linking to a leader-made Google Form; the scout submits a score screenshot as photo proof. Native quizzes revisit in Phase 3 if wanted.
4. **Proof via both gates.** Family password (household device recognition scopes the scout picker to their own kids) and the shared scout password (scout picks their name; leader review catches misuse).
5. **Google Classroom: not the platform.** It can't key content to our requirement tree, feed the ledger, or match our curation/search. Google Docs/Slides stay on Drive and are *linked* as resources — the library is an index, not a file server.
6. **No YouTube iframes.** Video resources are thumbnail cards that link out (consistent with the news CMS no-embed decision; keeps tracking iframes off a kids' site). Bunny-hosted video may use the existing player.
7. **Proof media is private.** Photos of minors go to a private Supabase Storage bucket, service-role access, signed URLs in admin only — never the public Bunny CDN.

## Acceptance Criteria

Phase 1 (library core):
- [ ] `/library` home: search, topic shelves, rank + MB drill with per-node resource counts read live from `rank_requirements` / `merit_badge_requirements` (no parallel taxonomy).
- [ ] Requirement landing pages (rank reqs; MB pages grouped by top-level req anchor) showing narrative + published resources; pages render even when empty ("nothing here yet — suggest something").
- [ ] Topic shelf pages, webmaster-manageable (create/rename/reorder topics).
- [ ] Submit flow (leader / scout / family gated) targeting a requirement or topic; lands in queue, never publishes directly; troop inbox notified.
- [ ] Admin curation workstation: review queue (approve / edit / decline w/ note), placements editable (one resource on many pages), pin + reorder, archive (no hard delete), narrative editor per requirement.
- [ ] Search returns only `published` resources; pending/archived never render publicly.
- [ ] Dashboard "Needs Attention" gains a "Library submissions" category.

Phase 2 (proof of completion):
- [ ] "I did this" on requirement pages: gate → scout identity → photo / report / link → queued confirmation.
- [ ] Proof review queue (Needs Attention category + review screen): shows submission, scout's current ledger state for that code, duplicate warning.
- [ ] Approve writes exactly the ledger row Fast Entry would (entered_by, dup-blocked); Return-with-feedback emails the household; both record reviewer + timestamp.
- [ ] Proof media in private bucket; signed URLs only in admin.

## Test Plan

Vitest, integration-style against local Postgres (D-049 pattern):

- [ ] `Visitor_SeesOnlyPublishedResources_WhenBrowsingLibrary()` — pending/archived excluded from public queries.
- [ ] `Webmaster_PublishesResource_WhenApprovingQueuedSubmission()` — status transition + reviewed_by stamped.
- [ ] `Renaming_RequirementCode_CascadesToPlacementsNotesAndSubmissions()` — D-019 rename-cascade extended to the three new keyed tables.
- [ ] `Leader_ApprovingProof_WritesLedgerEntry_WithEnteredBy()` — approval creates the row; `ledger_entry_id` back-linked.
- [ ] `Leader_ApprovingProof_IsBlocked_WhenScoutAlreadyHasCode()` — duplicate protection identical to Fast Entry.
- [ ] `Family_ProofScoutPicker_IsScopedToOwnHousehold()` — household membership validated server-side on submit.
- [ ] `AnonKey_CannotRead_AnyLibraryOrSubmissionTable()` — RLS zero-policy verification (D-051 pattern).

## Technical Approach

**Addresses, not copies.** Resources, narratives, and proofs key off `(target_kind, target_key)` addresses mirroring the ledger's composite codes: `rank_req` + `{rankId}-{code}` (NOT bare code — "9a" repeats across ranks; tech-lead HIGH finding 2026-07-21), `mb` + id, `mb_req` + `{mbId}-{code}`, `topic` + slug. `target_kind` values are a new discriminator — map explicitly from `updateReqCode`'s `source` ('rank'→'rank_req', 'mb'→'mb_req'); never reuse the ledger `kind` variable. The drill-down reads `rank_requirements` / `merit_badge_requirements` directly, so the library mirrors advancement by construction. The D-019 internal-code rename cascade must be extended to `library_placements`, `requirement_notes`, `requirement_submissions`.

**Schema (all tables RLS-enabled, zero policies — service-role only, D-051):**

```
library_topics          slug unique, title, blurb_md, sort_order
library_resources       title, blurb, kind(link|video|document|image|post), url, body_md,
                        thumbnail_url, host, visibility(public|leaders), status(pending|published|archived),
                        submitted_by_label, submitted_person_id?, submitter_note,
                        reviewed_by, reviewed_at, created_at, updated_at,
                        fts tsvector GENERATED (title+blurb+body_md), GIN index
library_placements      resource_id FK, target_kind, target_key, pinned, sort_order,
                        UNIQUE(resource_id, target_kind, target_key)
requirement_notes       target_kind, target_key UNIQUE together, narrative_md, updated_by, updated_at
requirement_submissions scout_id FK, target_kind(rank_req|mb_req), target_key, proof_type(photo|report|link),
                        body_md, link_url, media jsonb[], submitted_via(family|scout),
                        status(pending|approved|returned), feedback_md, reviewed_by, reviewed_at,
                        ledger_entry_id FK NULL, created_at
```

**Routes.** Public: `/library`, `/library/rank/[rankId]`, `/library/rank/[rankId]/[code]`, `/library/mb/[mbId]` (per-badge page, resources anchored by top-level req — not 1,735 pages), `/library/topic/[slug]`, `/library/submit`. Admin: `/admin/library` (tabs: Resource Queue, Proof Queue, Topics, Narratives); Dashboard Needs Attention deep-links in.

**Search.** Postgres FTS (`websearch_to_tsquery`) over a generated tsvector that MUST `coalesce()` each field (`title`/`blurb`/`body_md` — a NULL operand nulls the whole vector; tech-lead HIGH finding), plus a plain `ilike` fallback on title (pg_trgm deliberately NOT introduced — unused in this codebase; avoid a new extension dependency). Narratives searched in a parallel query. Filters: rank / badge / topic / kind.

**Tech-lead review 2026-07-21: ship-with-fixes — all adopted.** Besides the two HIGH items above: every public library page sets `export const dynamic = 'force-dynamic'` (D-040); secondary index on `library_placements (target_kind, target_key)` (reads lead with the page, not the resource); `media jsonb not null default '[]'` (codebase convention, not `jsonb[]`); and note that D-019's cascade today only renames TOP-LEVEL codes — sub-requirement renaming has no UI yet, so when it ships it must carry the same 3-table cascade (comment left at the extension site).

**Proof flow.** Requirement page → gate (family or scout role) → scout picker (household-scoped for family; roster picker for scout session, validated at review) → proof form → `requirement_submissions` insert + troop-inbox email (field/requirement names only, no media). Review: approve → insert ledger row via the shared dup-blocked path, link `ledger_entry_id`; return → feedback email to household primary contact. Retention: proof media auto-deletable after review + N days (align with the existing `change_requests` retention backlog item).

**Sparkler / Bugle.** Sparkler is a topic of `post`-kind resources (body_md holds the joke); the weekly Bugle workflow can append to it. Bugle-subscribe is a pinned link resource on that shelf.

## Implementation Steps

1. Migrations: five tables + RLS + FTS + rename-cascade extension; seed initial topics.
2. `/library` home (search + shelves + drill) reading requirement tables live.
3. Requirement / badge / topic landing pages with narrative + resource rendering (link cards, post cards, video thumbnails).
4. Submit flow (gated, queued) + troop-inbox notification.
5. Admin workstation: queue review, placements, pin/reorder/archive, topic CRUD, narrative editor.
6. Needs Attention category + "N resources" links on existing MB detail + clipboard pages.
7. Vitest suite for Phase 1 criteria; lint + build; deploy Phase 1.
8. Phase 2: submissions table flow, private bucket, proof review screen, ledger write-through + emails, tests; deploy.

## Open Questions — RESOLVED (Patrick, 2026-07-21)

- [x] **Attribution:** webmaster-editable label per resource; defaults to "Shared by {name}" (scouts as first-name last-initial per publicScoutName convention).
- [x] **Sparkler backfill:** yes — Patrick will supply the archive for pre-population.
- [x] **Visibility:** launch the whole section publicly right away, even while sparse — empty states entice submissions. Keep the `visibility` column in schema, but no leader-only UI until there's real content for it.
- [x] **Proof-media retention:** delete 3 months after review, as a routine job.
- Prototypes reviewed and approved by Patrick 2026-07-21 — all four match expectations.

## Notes

- Prototypes: `prototypes/resource-library/` — `index.html` (home), `requirement-page.html` (First Class 9a + proof flow), `topic-page.html` (one renderer, multiple shelf configs), `admin-review.html` (webmaster workstation).
- Related: D-019 rename cascade, D-033/D-041 dup protection, D-049 test approach, D-051 RLS pattern, D-055 change_requests / Needs Attention extensibility, news CMS no-embed decision.
- Live troop context on requirement pages reuses the Has/Needs computation (v1.6.0).
- Parked ideas: QR codes on printed clipboards → requirement pages; "most-used resources" analytics; native quizzes (Phase 3); link-health checker.
