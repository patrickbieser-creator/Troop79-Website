# People-Spine Audit — production DB, 2026-08-26

**Status:** Findings only — nothing changed by the audit. Patrick to pick which recommendations to act on.
**Requested by:** Patrick, 2026-08-26 ("do a full audit of the people table and any other tables related, and look for dead or duplicate or conflicted fields"), after finding that a scout's roster email edit never reached sign-in.
**Scope:** `people`, `scouts`, `leaders`, `households`, `household_members`, `scout_parent_emails`, `person_roles`, `person_capabilities`, `relationships`, `login_tokens`, `login_events`, `passkey_credentials`, `signup_entries` (person columns). `scout_parents` was dropped by `20260815200000_retire_scout_parents.sql`.
**Prod counts:** people 143, scouts 48, leaders 42 (11 are non-person org codes — `is_person=false`, `person_id` null by design), households 42, household_members 95, scout_parent_emails 30.

Same-day context: v1.106.3 added `src/lib/person-mirror.ts`, wired into `createScout`/`updateScout`/`createLeader`/`updateLeader` — a one-way roster → `people` sync on save. Reads are still split by table (see Truth table). `scouts.email` / `scouts.bsa_member_id` vs `people.*` were resynced the same day (0 disagreements).

## Truth table — which side each code path treats as truth

| Fact | Live reader | Live writer | Note |
|---|---|---|---|
| Scout contact (email/phone/address/birthdate/gender/health/notes) | `scouts.*` (scout-form.tsx) | `scouts.*`, mirrored → `people.*` | `lookups/actions.ts` |
| Adult contact (same fields) | `people.*` (Roster directory, `person-actions.ts`) | `people.*` only | leader-form.tsx deleted 2026-08-17; adult edits moved to `PersonEditor` on the spine |
| `leaders.email/phone/address/birthdate/health_form_date/things_we_should_know/ypt_completed` | **`roster-print-data.ts:82-84,134-143`** reads these for the printed adult roster — no `people.*` fallback | **nothing** — `createLeader`/`updateLeader`/`deleteLeader` are exported but have zero callers in `src/` | Live bug: printed adult addresses are frozen pre-2026-08-17 and blank for any adult with no `leaders` row |
| Sign-in identity | `people.*` (households.ts, identity-challenge.ts) | n/a | — |

## Dead candidates

| Column | Evidence |
|---|---|
| `households.notes` | 0/42 non-null; no code reference |
| `household_members.is_primary_contact` | 0/95 true; no code reference |
| `people.health_form_date` | 0/143 non-null (scouts has 3, leaders 0) — read/written but never populated |
| `scouts.auth_user_id` | 0/48; type-only reference |
| `scouts.last_activity`, `scouts.joined_date` | 0/48; set null on insert, never updated |
| `*.address_line2` (scouts/leaders/people) | 0 non-null across all three |
| `leaders.birthdate`, `leaders.health_form_date` | 1/42, 0/42; only referenced in the uncalled `createLeader`/`updateLeader` |
| `leaders.login_name` | 9/42; login-label override, mostly vestigial |
| `leaders.scout_id` | 6/42, 100% redundant — always equals `scouts.id` where `leaders.person_id = scouts.person_id` (2 readers: `authorized-adults.ts`, `households.ts`) |

## Duplicate pairs (prod rows that DISAGREE, case/trim-insensitive)

| Pair | Disagree | Examples |
|---|---|---|
| scouts.phone vs people.primary_phone | 13 | Paddy Joyce, Roman Kramer, Lucy/Leo Haslam, Jasper Stollenwerk |
| scouts.birthdate vs people.birthdate | 12 | same set |
| scouts.gender vs people.gender | 10 | same set |
| scouts.address_line1/city/state/zip vs people.* | 33 | Robbie Haessley, Lily Porter, Anita Bendre, Lucy Lyden, Violet Babby |
| leaders.email vs people.primary_email | 19 | Jack Porter, Jamie Lynn Tatera, Nina Bendre, Michelle Porter, Melissa Rader |
| leaders.address_line1 vs people.address_line1 | 7 | Dan Bieser, Jamie Lynn Tatera, Nina Bendre, Mike Black, Patrick Bieser |
| leaders.bsa_member_id vs people.bsa_member_id | 11 | Maya Sankpal-Tatera, Jack Porter, Oliver Vest, Veronica Kleinfeldt, Hazel Stollenwerk |
| leaders.name vs people.display_name | 3 | Dan/Daniel Bieser, Mike/Michael Babby, Mike/Michael Black |
| scouts.email, scouts.bsa_member_id vs people.* | 0 | resynced 2026-08-26 |
| scout_parent_emails.email (primary) vs people.primary_email | 1 | Summer Kimble (merge artifact) |

## Integrity

| Finding | Count | Examples |
|---|---|---|
| `leaders.person_id` null | 11 | all `is_person=false` org codes — by design |
| `scouts.person_id` null | 0 | — |
| **Merged people still `active=true`** | 13/13 | Mindy Stollenwerk, Maya Sankpal-Tatera, Kristin Paltzer, Jamie Lynn Tatera, Patrick Bieser (66), Nina Bendre (81), Tim Radtke, Kara Pitt-D'Andrea, Margie Schires, Summer Kimble, Melissa Rader, Jack Kosmoski, Lisa Pieper. **Root cause: `merge_people()` (current def in `20260815200000_retire_scout_parents.sql`, unchanged in `20260823140000`) never sets `people.active=false` on the loser.** |
| Merged-but-still-linked (scouts/leaders/household_members/roles pointing at the loser) | 0 | merge re-points correctly; only `active` is stale |
| Genuine unmerged duplicate people | 1 pair | ids 148/149 "Fred" — no email/links, likely test rows |
| Near-duplicate not caught by exact match | 1 pair | Mark Carrol (93) / Mark Carroll (128), household 33, both inactive — typo split |
| Orphan people (no scouts/leaders/household_members link) | 45 | 13 = merge-active rows above; 26 already inactive; **6 active with no link**: Fred (149), Michael Kramer, Cory Weber (@scouting.org — council contact?), Moriah Weingrod, Debby Taylor, Miles Knaebe |
| `household_members` → inactive person | 7 | Sarah Juchemich, Ellen Manning, Jennifer Brumm-Maciejewski, Paul Pasquesi, Mark Carrol, Amy Joyce, Mark Carroll |
| Households with zero members | 1 | id 18 "Stollenwerk (Jasper)" |
| `scout_parent_emails` orphaned (no related scout) | 2 | person_id 144, 145 (no display_name — likely guest/test) |
| `person_roles` / `person_capabilities` / `relationships` → inactive person | 2 / 2 / 9 | historical; tied to legitimately-inactive people |
| `scouts.household_id` vs `household_members` | 0 | consistent |
| Shared email across parent + child | several | real family sharing, not duplicate identities |

## Recommendations (ranked)

1. **Fix `merge_people()` to set `active=false` on the loser** + one-time UPDATE for the 13. Migration-only. Highest priority: 13 "dead" people appear active in every active-filtered list (rosters, pickers, directory).
2. **Printed adult roster reads `leaders.*` that nothing writes** (`roster-print-data.ts`). Either point it at `people.*` (1 file) or delete the uncalled `createLeader`/`updateLeader`/`deleteLeader` cluster and its mirror wiring.
3. **Stop both sides being editable.** `people.*` is truth for reads; the mirror keeps scouts.* in step going forward, but 33 address / 13 phone / 12 birthdate / 10 gender scout disagreements and 19 leader email disagreements already exist. Options: (a) one-time resync `people ← scouts` for scouts (scout-form is the only editor) and `leaders ← people` for adults (PersonEditor is the only editor), then (b) retire the roster-side duplicate columns in a later pass. Cross-cutting — tech-lead pass before touching.
4. **Drop dead columns** after one more soak: `households.notes`, `household_members.is_primary_contact`, `scouts.auth_user_id`, `scouts.last_activity`, `scouts.joined_date`, all three `address_line2`, `leaders.birthdate`, `leaders.health_form_date`.
5. **Manual hygiene:** merge/delete "Fred" 148/149, Mark Carrol/Carroll, the 6 active orphans (verify Cory Weber first), household 18, scout_parent_emails 144/145.
6. `leaders.scout_id` — derivable; drop once its 2 readers use the person_id join.

Files of record: `supabase/migrations/20260720100000_people_identity_spine.sql`, `20260720120000_merge_people_and_bulk_accept.sql`, `20260815200000_retire_scout_parents.sql`, `20260823140000_guest_mode_and_guest_people.sql`; `src/lib/person-mirror.ts`; `src/app/admin/(workspace)/advancement/lookups/actions.ts`; `src/lib/roster-print-data.ts`; `src/app/admin/(workspace)/advancement/roster/{scout-form,people-table,person-actions}.tsx|ts`.
