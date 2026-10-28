# Sign-Off Initials on the Person Record

**Status:** Parked
**Parked:** 2026-10-26
**Priority:** Medium

## Overview

Give the Roster's person record a **Sign-off initials** control. It lets a leader add initials to anyone who signs off advancement, change them, and retire them, with no database edit. The initials are `leaders.code`, and each ledger entry already stores them in `ledger_entries.by`. This plan adds a way to manage them and does not change what they mean.

## Problem / Opportunity

- **Add.** The app creates a code only through *Promote to adult* (`promoteScoutToAdult`, `lookups/actions.ts:1061`). A parent who starts signing off at a meeting can't appear in the Signed-Off By picker until someone inserts a `leaders` row by hand.
- **Edit.** A wrong or unwanted code can't be corrected.
- **Retire.** Every code ever issued stays in the Fast Entry and Audits pickers forever: 42 rows today, including adults who have left. There is also no way to free a code for a new adult years later.
- This is the "create implies edit and delete" rule applied to a record the app already creates.

## Decisions taken (Patrick, 2026-10-26)

- **A code may be reused after 5 years.** By then the old person's ledger entries are archival and of interest mostly to historians. Old entries that show the new holder's name are an accepted cost.

## Acceptance Criteria

- [ ] A person with no initials shows **Sign-off initials: none · Add**. Add pre-fills a suggestion from the name, using the same derivation as Promote to adult: first and last initial, plus 2, 3… if taken.
- [ ] A person with initials shows them, the number of ledger entries signed with them, and **Edit** and **Retire** buttons. A retired code shows as "PB, retired Oct 2026" with **Restore**.
- [ ] A code must be 2–5 letters. It is unique ignoring case, so `KP` and `Kp` can't both exist. It may not take a non-person source's code (Camp, Clinic, T105, …).
- [ ] A retired code drops out of every Signed-Off By picker (Fast Entry, Audits, Ledger edit). It still names its old entries on the Ledger and in history.
- [ ] **Reuse:** Add or Edit may take a *retired* code only if its newest ledger entry is at least 5 years old. The form says why it refused ("KP signed an entry on 2026-10-18; it can be reused from 2031-10-18").
- [ ] **Edit renames everywhere in one transaction:** the leaders row, the `leader_skills`, `library_superusers` and `merit_badge_counselors` links, and every `ledger_entries.by` row with the old code. The confirm step names the count: "Rename PB to PJB? 2,554 ledger entries signed PB will read PJB."
- [ ] A person can hold only one active code.
- [ ] Every add, edit, retire and restore lands in the person's change history, with from and to values.
- [ ] Only a leader with `roster.manage` may do any of this, checked on the server.
- [ ] Blocked saves follow the edit-screen standard: the button stays enabled, and a click marks the field and says why.

## Test Plan

Database (`tests/sign-off-initials.test.ts`, test-owned codes such as `ZQ{n}`, cleaned in `finally`):

- [ ] `Leader_CanAddInitials_ToAParentWithNone`: creates a leaders row linked to the person, with `can_login` false.
- [ ] `AddInitials_Refuses_ACodeHeldByAnotherActiveLeader_IgnoringCase`
- [ ] `AddInitials_Refuses_ANonPersonSourceCode`
- [ ] `AddInitials_Refuses_ARetiredCodeUsedWithinFiveYears_AndSaysWhen`
- [ ] `AddInitials_ReusesARetiredCode_UnusedForFiveYears`: the old row is archived under `{code}~{year}` and its links follow it; the new person gets the bare code.
- [ ] `RenameInitials_RewritesEveryLedgerEntry_AndEveryLink_InOneTransaction`
- [ ] `RenameInitials_LeavesOtherLeadersEntriesUntouched`
- [ ] `RetireInitials_HidesTheCodeFromSignOffPickers_ButKeepsTheRow`
- [ ] `RetireInitials_LeavesLedgerEntriesIntact`: row-for-row `toEqual`, like the teaching-skills test.
- [ ] `RestoreInitials_PutsTheCodeBackInThePickers`
- [ ] `NonManager_CannotChangeInitials`

Pure (`tests/initials-rules.test.ts`):

- [ ] `SuggestInitials_UsesFirstAndLastInitial_PlusANumberIfTaken`: extracted from `promoteScoutToAdult`, so both callers share it.
- [ ] `ReuseDate_IsFiveYearsAfterTheNewestEntry`

DOM (`tests/sign-off-initials-block.test.tsx`):

- [ ] `Leader_SeesNoneAndAdd_WhenThePersonHasNoInitials`
- [ ] `BlockedAdd_MarksTheFieldAndSaysWhy`
- [ ] `RenameConfirm_NamesTheEntryCount`
- [ ] `RetiredCode_ShowsRestore`

## Technical Approach

- **Schema (one migration):**
  - `leaders.retired_at timestamptz null`.
  - A unique index on `lower(code)`.
  - The three foreign keys into `leaders.code` are recreated with `ON UPDATE CASCADE`. They stay `ON DELETE CASCADE`, but nothing deletes a leaders row any more.
- **One RPC per write** (`add_leader_initials`, `rename_leader_initials`, `set_leader_initials_retired`). Each takes a lock and does its checks and writes in one transaction, the same shape as `set_teaching_skills`. The 5-year rule lives in the RPC, keyed on `max(ledger_entries.date) where by = code`.
- **Reuse archives, not deletes.** The old row keeps its person link, its role and its counselor links under `{code}~{year}`, so the old person's record still says what they held. Old ledger entries keep the text `PB`, which now resolves to the new holder. That is the accepted cost.
- **Pickers:** Fast Entry, Audits and Ledger add `.is('retired_at', null)` to their `leaders` read for the picker only. Name lookup for display keeps reading every row.
- **Rank refresh:** `ledger_rank_award_refresh` fires on every UPDATE. A rename of PB would recompute ranks 2,554 times, harmlessly but slowly. The migration narrows it to `UPDATE OF scout_id, kind, code, date` (confirm the column list against `trg_refresh_scout_rank`), so a `by` rewrite skips it.
- **UI:** a small block in the person record's sign-in card, next to "Admin access", built with the shared AddButton, SaveButton, `.bad`/`.badNote` and SaveProblem. It shows on every tab, because youth leaders (JPII, OV, VK, MST) are scouts.
- **What a leaders row also does:** it adds the person to the authorized-adults pool, with `can_login` false so they get no admin access, and to Menu Monster's "leader" grouping. Neither changes who appears on the Leaders tab, which comes from roles. Retire does not touch `can_login` or capabilities; those stay on Access & Permissions.

## Implementation Steps

1. Extract `suggestInitials(name, taken)` from `promoteScoutToAdult`, with tests.
2. Write the migration: `retired_at`, the case-insensitive unique index, FKs with `ON UPDATE CASCADE`, the narrowed rank trigger, and the three RPCs. Then write the DB tests.
3. Add server actions with a `roster.manage` guard that call the RPCs and log to person history.
4. Filter retired codes out of the Fast Entry, Audits and Ledger pickers.
5. Add the person record block, with DOM tests.
6. Run the full gate, then qa-lead, then add the changelog entry.

## Open Questions

All three answered YES by Patrick, 2026-10-26: Edit rewrites old entries; the clock starts at the newest entry; a retire clean-up pass happens through the new control after shipping. Ready to activate.

- [x] **Edit: rename the old entries (recommended) or not?** Recommended: rename them, since `by` means the person and PB → PJB still names Patrick. The alternative is to leave old entries on the old code. That needs the old code kept as a retired alias, which is the reuse problem in reverse.
- [x] **The five-year clock:** this plan starts it at the newest ledger entry. Starting it at the retire date is simpler, but it lets a code that was signed last month become reusable in five years from now, regardless of when it was last used. Since the two rarely differ, the newest entry is the safer choice.
- [x] **Clean-up pass after shipping:** retire codes for adults who have left (for example SK, SM, PP, KM)? That's a judgment call for Patrick, made through the new control and not by migration.

## Notes

- Today: 42 leaders rows (31 people, 11 non-person sources). 11,328 ledger entries, and every non-blank `by` resolves to a leaders row (0 orphans).
- One ledger entry has date `0025-11-08` (signed BV), which is a typo for 2025. It doesn't affect the 5-year rule, which reads the newest date, but it's worth fixing.
- First real case (2026-10-26): Gene Brown (person 171) was given the adult-leader role but has no leaders row, so he can't appear in any Signed-Off By picker. A role and a sign-off code are separate records; Add on the person record closes that gap.
- Session sign-in matches by label, code or name (`matchAuthorizedAdult`), so a rename doesn't sign anyone out.
- Related: [[Person-Editor-Rethink]], the "create implies edit and delete" rule, and the teaching-skills ledger-safety test (v1.255.0).
