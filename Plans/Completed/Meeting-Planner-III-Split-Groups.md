# Meeting Planner III — Split a rank group into Group 1, 2, 3

**Status:** SHIPPED v1.260.0 (2026-10-31/11-01, main 9aa9cc2f). S1–S6 done; follow-ups in BACKLOG (merge-confirm count, Suggestions teacher target, canonical-bypass test, MB Sp/Mg).
**Parked:** 2026-10-31
**Priority:** High

## Overview

Let a planner divide any rank group of the night (Scout, Tenderfoot, Second Class, First Class) into up to three
groups, **Group 1 · Group 2 · Group 3**. Each group has its own requirements to teach and its own teachers. Placement
puts each scout in the group that has the most of what they still need, so scouts who are further along end up together.
The planner can start a split by hand, or take the auto planner's proposed split, which they can preview before applying. **Merge** puts
the groups back together, and a later **Split** brings the same groups back as they were. Nothing is locked: planners
can try what-ifs for who shows up and which teachers are free, and save each version as a saved plan.

## Decisions (Patrick, 2026-10-31)

- **D1. Offer the auto-split, with a preview.** Nothing splits by itself.
- **D2. 8 placed scouts triggers the offer, and is never a limit.** A group of any size is allowed, split or not; no
  control is ever disabled or blocked by group size.
- **D3. One requirement may sit in more than one group.** Rare, but allowed (there may be subtle reasons to want it).
- **D4. Names are "Tenderfoot Group 2".** No custom names; the card's columns already say what the group covers.
- **D5. Merging after the emails went out is allowed,** with the confirm count.
- **D6. "N said yes" is enough for turnout.** It is information only and never filters placement: the troop expects
  low response at first (50–60% within six months would be a success), so a no-answer means "unknown", not "absent".
- **D7. Merit badge groups: later, same mechanism.** A merit badge night may run four to six groups in rotations; those
  are planned as focus sets, one per grouping. Splitting one badge's group into Group 2/3 may be needed if the troop
  grows. Not built now, but keys, storage and placement are designed so a badge group can split the same way.
- **D8. A Split or merge… button on each group card (left-hand column)**, besides the offer in the flow. One button:
  the dialog asks split (2 or 3, the auto planner re-run as a preview) or merge. It re-triggers the split logic any time.

## Problem / Opportunity

Each rank has one group per night (`lib/focus-plan.ts`, `GROUP_RANKS`), and every scout working on that rank lands in it.
This week's First Class group holds most of the troop: the local mirror counts 28 active scouts holding Second Class,
all of them placed there. One teacher can't run one lesson for 28 scouts at very different points: some need 1–3, some
are down to 8 and 9. The only workaround today is moving scouts to other groups by hand, one at a time, and that
can't give the moved scouts a different focus.

## Acceptance Criteria

- [ ] On This week, every rank group card in the left-hand column has one visible **Split or merge…** button (D8). It
      opens one dialog for the whole rank:
      - **Split into 2 / 3 groups**, which re-runs the auto planner's split for the rank from the current scouts,
        progress and focus, and shows the proposal as a live preview (who lands where, what each group teaches, the
        minutes). The planner can adjust which requirements go to each group before applying.
      - **Merge into one group**, shown when the rank is split.
      It works whether or not the offer was shown or dismissed, and on a rank that is already split (re-running it
      proposes a fresh split, replacing the current one only when applied).
- [ ] Each split group shows as its own card, **"Tenderfoot Group 2"**, with its own columns, members, minutes and
      teacher slots. Ask by email, Help teach, Move and Unassign all work on a split group exactly as on any group.
- [ ] A split group can take more requirements (**+ Requirement** inside the card), hand a column to another group
      (**Move to Group n** on the column's menu), or share it (**Also teach in Group n**). A column may sit in any number
      of the rank's groups; removing it from its last group is refused with a reason (it would leave the night).
- [ ] No group size limit anywhere: a group of 20 stays allowed, split or not, and hand moves into a full group work.
- [ ] Placement puts a scout in the split group they fit best: the largest share of that group's minutes they still
      need (so a beginner who needs everything lands in Group 1, not in the group with the most to teach); ties go to
      the lower number.
      A planner's hand move, a family pick and a help-teach answer all keep outranking placement, as they do today.
- [ ] **Merge groups** on any split card brings the rank back to one group in one step, with an Undo. While merged,
      every hand move, pick, helper and teacher that pointed at Group 2 or 3 counts for the merged group. **Split** again
      restores the earlier groups with their requirements, teachers and hand moves.
- [ ] When a rank group has more than 8 placed scouts (the offer threshold, never a limit) and has more than one requirement to
      spread, its card offers **"Split into 2 groups?"**. Dismissing it hides the offer for that meeting. The preview shows the auto planner's proposal: which scouts in
      each group, what each group teaches, and the minutes, all computed by the real placement. Applying it is one click,
      and Undo is the same Merge.
- [ ] Families, teachers and Live at the meeting see the split group's name everywhere a group name appears today:
      the family page and email, the teacher's page, the checklist, the Tonight drawer and the Live cards.
- [ ] Saved plans save and load splits with the rest of the criteria. An older saved plan with no splits loads as it does today.
- [ ] Merging after families were emailed about Group 2 is allowed. The confirm says how many families have Group 2 in an
      email they already got, and their page shows the merged group from then on.
- [ ] Every new control has an Undo or a way back. A split never stops another planner's edit (it runs under the
      meeting's seed lock, like loading a saved plan).

## Test Plan

Pure engine (`tests/focus-plan-split.test.ts`):
- [ ] `Planner_SeesTwoTenderfootGroups_WhenTheRankIsSplit()` — groups `fr:tenderfoot` and `fr:tenderfoot~2` both exist, in that order.
- [ ] `Placement_PutsScoutInGroupWithMostOpenMinutes_WhenSplit()`
- [ ] `Placement_PicksLowerGroup_WhenOpenMinutesTie()`
- [ ] `Placement_LeavesUnclaimedFocusInGroup1_WhenGroup2ClaimsSome()`
- [ ] `SharedColumn_CountsInBothGroups_ScoutPlacedByMostOpenMinutes()` — D3.
- [ ] `NewFocusItem_LandsInGroup1_AfterSplit()`
- [ ] `NoSizeLimit_HandMoveIntoGroupOf20_Works()` — D2.
- [ ] `BadgeGroupKey_WithSectionSuffix_ParsesAndPlaces()` — D7 groundwork: the engine accepts `fr:mb:<id>~2`, no UI.
- [ ] `HandMove_ToGroup2_OutranksPlacement()`
- [ ] `Merge_ReadsGroup2KeysAsTheMergedGroup()` — roles, picks and helpers on `~2` count for `fr:tenderfoot` while merged.
- [ ] `Split_RestoresGroup2Members_AfterMergeThenSplit()`
- [ ] `SplitGroup_DropsItemsNoLongerInTheFocus()` — a section item whose focus set was removed is ignored; an empty section shows "nothing to teach".
- [ ] `WorkingAhead_StillStepsOneRank_WhenNextRankIsSplit()`

Auto-split proposer (`tests/group-split-proposal.test.ts`):
- [ ] `Proposal_Offered_WhenGroupExceedsCap()`; `Proposal_NotOffered_WhenOneColumnAndNothingElseNeeded()`
- [ ] `Proposal_BandsScoutsByRequirementsDone()` — fewer done → Group 1, more done → Group 2.
- [ ] `Proposal_Group2Focus_IsWhatBand2NeedsMost_UnderSixtyMinutes()` — uses class tags (no L-only) and teach_minutes.
- [ ] `Proposal_PreviewEqualsPlacement()` — the members shown are buildFocusPlan's own result for the proposed split.

Database (`tests/db/meeting-group-splits.test.ts`):
- [ ] `TopicConstraint_AcceptsSectionKeys_RejectsGroup4()`; `_meeting_topic_id_ResolvesSectionKey()`
- [ ] `SplitRpc_IsAtomic_UnderSeedLock()`; `MergeRpc_KeepsSectionRows_MarksMerged()`; `Resplit_Unmerges()`
- [ ] `SavedPlan_RoundTripsSplits()`; `SavedPlan_WithoutSplits_LoadsUnchanged()`

UI (dom):
- [ ] `Planner_CanSplitTenderfoot_FromSplitOrMergeButton()`; `Planner_CanMerge_FromSplitOrMergeButton()`;
      `SplitOrMerge_RerunsProposal_OnAlreadySplitRank()`; `Planner_CanMoveColumnToGroup2()`; `Planner_CanMergeAndUndo()`
- [ ] `Planner_SeesSplitSuggestion_WhenGroupOverCap()`; `Viewer_WithoutSeedRight_SeesNoSplitControls()`
- [ ] `FamilyPage_ShowsGroupTwoName()`; `LiveCard_ShowsGroupTwo()`; `Emails_NameGroupTwo()`

## Technical Approach

1. **Keys.** Group 1 keeps today's key, `fr:<rankId>`, so nothing that exists changes. Groups 2 and 3 are
   `fr:<rankId>~2` and `fr:<rankId>~3`. `isGroupKey` already matches; `rankOfKey`, `meeting-board-picklist` and the
   Suggestions `GROUPS` list learn the suffix. The `~` keeps clear of `fr:mb:` and of the `.` in sub-requirement codes.
2. **Storage: one table, `meeting_group_splits`** (calendar_entry_id, group_key — the base key, `fr:<rankId>` now and
   `fr:mb:<mbId>` later (D7) —, section 1|2|3, item_keys text[], merged_at timestamptz null, updated_by, updated_at).
   Every section lists its own columns, so a column can be in several (D3). A focus column that no section lists (a
   focus set added after the split) goes to Group 1. A merge is soft: `merged_at` on the rows hands everything back to
   one group, and clearing it restores the split as it was. Nothing is deleted except by **Remove split** (a later,
   explicit action).
3. **Placement (`buildFocusPlan`).** New input `splits` (active only). Rank groups become 1–3 sections; columns per section as
   above. A counted scout's own rank (or next rank, working ahead) resolves to the section with the most open minutes
   (as a share of the section's minutes, see review item 4); ties go to the lower section. A column shared by two
   sections counts in both. No size cap enters placement (D2). Precedence is unchanged. While a rank is
   merged, an alias map reads `~2`/`~3` keys in roles, picks and helpers as `fr:<rankId>`. Still computed on every
   read, still pure.
4. **Topics.** `meeting_topics_one_reference` widens for `focus_group_part` to
   `topic_key ~ ('^fr:' || rank_id || '(~[23])?$')`; `_meeting_topic_id` resolves the suffix. Teachers, invites and
   picks hang off section topics with no new code. While merged, the teacher list of Group 1 shows the section
   teachers too (a union at read time), so merging never loses a teacher.
5. **RPCs, under the meeting's seed lock:** `meeting_split_group(entry, rank, sections jsonb, actor)`,
   `meeting_merge_group(entry, rank, actor)`, `meeting_unmerge_group(…)`, `meeting_move_group_column(entry, key, to_section, actor)`.
   A **+ Requirement** inside a section seeds a single (the existing path) and claims it for that section in one call.
   Everything that changes bumps `meeting_board_stamp`, so the poller refreshes the other planners.
6. **Auto-split proposal (`lib/group-split-proposal.ts`, pure).** Offered when placed members > `SPLIT_CAP` (8) and the
   group has 2+ columns or the band ahead needs requirements not yet in the focus. Bands: sort members by rank
   requirements done; cut into k = min(3, ceil(n / cap)) bands at the largest gaps near equal sizes. Group 1 keeps the
   focus columns band 1 needs most. Group 2 takes the focus columns band 1 has mostly done, plus the requirements band 2
   needs most (from the Suggestions engine's needs, class-tag rules, `CLASS_MAX_MIN`), until about 60 minutes. The
   preview runs `buildFocusPlan` with the proposed splits, so what it shows is what placement will do.
7. **What-ifs.** Splits are ordinary draft state: split, merge, move columns and undo at will. For named scenarios,
   saved plans add `splits` to their criteria (criteria v2; v1 plans load unchanged). Group cards show
   `12 placed · 7 said yes` (D6: information only; a no-answer is unknown, not absent), and the Teachers line shows the
   asked and the confirmed teachers per group.
8. **Merit badge groups (D7): groundwork only.** Keys (`fr:mb:<id>~2`), the table's `group_key` and the engine's section
   logic are written for any group; the UI offers Split on rank groups only. Turning it on for badges later is the
   constraint widening for `fr:mb:` keys plus the menu item. Merit badge nights with rotations stay focus sets.

## Implementation Steps

Phased like Planner III; schema waits on a branch until Patrick says ship (D-404).

1. **S1 engine** — sections + alias in `focus-plan.ts`, key helpers, pure tests. No UI.
2. **S2 schema** — `meeting_group_splits`, constraint + `_meeting_topic_id`, the four RPCs, stamp, merge_people
   (updated_by), DB tests. DB-first, additive.
3. **S3 auto-split proposal** — the pure proposer and its tests (before the UI, since the dialog opens on it).
4. **S4 This week UI** — the **Split or merge…** button on each group card in the left-hand column and its one dialog
   (split 2 or 3 with the proposal pre-filled and adjustable column checkboxes per group, live preview; or merge), the
   "Split into 2 groups?" offer in the flow opening the same dialog, section cards, Move / Also teach in Group n,
   + Requirement in a section, Merge with Undo toast, Split again. Jenna review of the screen.
5. **S5 everywhere a group is named** — family page and email, teacher page, Emails screen, Live cards, Tonight drawer,
   Suggestions' "on the plan" test, Has/Needs add hook.
6. **S6 what-ifs** — saved plans criteria v2, the "said yes" count on group cards.
7. qa-lead pass, full gate, ship.

## Open Questions

All answered 2026-10-31 (Decisions above; tech-lead review below).

## Tech-lead review (2026-10-31): go with changes

1. **`~` is safe** (URL-unreserved; Idempotency-Key is `meeting-email-<row id>`). What breaks is code that treats the
   text after `fr:` as a bare id: `topicWords`, `_meeting_topic_id`'s `substr(p_key,4)`, the `fr:mb:` branch. One
   parser, `parseGroupKey`, fixes all (S1 TS, S2 SQL).
2. **Soft merge holds if one canonicalizer aliases everywhere:** `canonicalGroupKey(key, mergedBases)` used by the
   roles/picks/helpers loaders, the teacher union, teacher-week, Emails, Live, the drawer, planner-place. Invites
   already sent stay on their `~2` topic row; the teacher page names Group 1 while merged. A grep-style test fails if
   a group-key read bypasses it.
3. **Claim rule:** a section owns a focus key if it lists the key **or an ancestor** of it (focus edits reshape columns).
   Loading a saved plan with no splits **merges** the meeting's splits (soft, so Split brings them back); a plan with
   splits replaces them.
4. **Section choice by fit** (changed in S3 from "most open minutes", which sent beginners to the biggest group): the
   share of a section's minutes (`teach_minutes ?? 15`) the scout still needs; ties to the lower section.
5. **`FocusGroup.name` stays the rank or badge name** (code labels like "Tenderfoot 4a" use it); a new `label` carries
   "Tenderfoot Group 2". S5 moves display sites to `label`.
6. **Work ahead steps by rank, not by array index** (`family-week` `alsoFor` uses `ranks[i+1]`, which would land on Group 2).
7. **A family pick or helper aimed at the base key re-places by section fit;** a hand move names an exact section.
   (Group 1's key is the base key, so a hand move to Group 1 is exact; a pick of Group 1 is re-placed.)
8. **"Own rank has anything open" and `homeKey`** look across all of the rank's sections.
10. **Levels (S3, found on real data 2026-10-31):** fit alone couldn't group scouts by progress. This week's Tenderfoot
    group has one 120-minute focus (4a) all 11 need, so everyone fit Group 1. Each section now stores `from_done` (its
    level: rank requirements done to start there). A scout goes to the highest section their count reaches when
    something is open for them there, else by fit; all zero = by fit alone. The proposal sets the levels (each band's
    fewest done, rising) and gives each column to ONE band (sharing stays a planner's choice), so Group 2 gets a focus
    of its own. On real data: Tenderfoot Group 1 = 4 scouts on 4a, Group 2 = 7 scouts (4+ done) on 3d, 4b, 4c, 8.
9. **S2:** the stamp counts `meeting_group_splits` (count + max(updated_at), `updated_at` set on every change incl.
   merge); `updated_by` FK on delete set null + index + a `merge_people` line; the constraint uses
   `topic_key in ('fr:'||rank_id, …||'~2', …||'~3')`, not a regex.

## Notes

- Related: Plans/Completed/Meeting-Planner-III.md (placement, D-444–D-449), Plans/Completed/Meeting-Planner-III-Family.md
  (60-minute budget, `CLASS_MAX_MIN`), saved plans (D-455), Unassigned (D-459).
- Placement precedence stays: hand roles > help-teach > family picks > placement. A split only changes what "placement"
  means within a rank.
- No prototype yet. If Patrick wants one, the Split dialog and the side-by-side section cards are the screens to draw.

## Follow-ups (2026-10-31, after S5–S6)

- [ ] **D5 confirm count:** Merge doesn't yet say how many families were emailed about Group 2/3 (the Emails screen's
      "plan changed since sent" already flags them after a merge).
- [ ] **Suggestions' Teaching chip** puts a teacher on the rank's Group 1 card even when the requirement sits in Group 2
      (`planner-suggest.ts` teacherTarget uses rankGroupKey); needs the group a focus key sits in.
- [ ] **Tech-lead #7:** a grep-style test that fails when a group-key read bypasses `canonicalGroupKey`.
- [ ] Merit badge groups: Split on badge cards (D7 groundwork is in; constraint and RPC already take `fr:mb:` keys).

