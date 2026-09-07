# Person Editor Rethink — adult, leader, and scout editing screens

**Status:** research + prototypes in progress (2026-09-07). Patrick to approve a direction.
**Trigger:** Patrick, 2026-09-07: "There is too much going on and it's confusing to end users. We need a
thorough rethink of how this is displayed. I am open to different patterns than what we have done
before." Same day, editing Marita Stollenwerk Active → Inactive: "there's no way to save" — Status acts
immediately via a small inline "Mark inactive" button while the Demographics form below has a
dirty-gated Save that stays grey.

**Who:** Jenna (audit, below) → Brad (prototypes under `prototypes/person-editor/`) → Patrick picks.

---

## Jenna's audit (2026-09-07)

### A. Inventory

| Section | Adult/Leader (`people-table.tsx`) | Scout (`scout-form.tsx` + `scout-relations.tsx`) | /profile counterpart | Save model |
|---|---|---|---|---|
| Status | Radio → reveals reason box → secondary **"Mark inactive"** button; Active radio fires instantly, no confirm (:637–696) | One radio pair, part of FormSection 6, folded into the ONE bottom-of-dialog Save (:531–568) | n/a | **Two different models for the identical job** |
| Demographics | Own `FormPanel` + dirty-gated `SaveButton`/`DiscardButton`, scoped to just this section (:700–860) | Part of the single whole-dialog Save with Identity/Contact/Notes (:333–404, :620–636) | Dirty-gated **proposal** (Submit/Discard), not a save — creates a change request (`profile-editor.tsx`, `adult-editor.tsx`) | **Three models**: section-save / whole-form-save / propose-for-approval |
| Email addresses | Immediate, one-click add/promote/remove, explicitly labeled "not a save form" (:862–929) | n/a (scout has no own email UI) | Immediate, one-click — `email-editor.tsx` | Consistent (rare win — keep this) |
| Household | `<select>` fires mutation on `onChange`, no confirm, no visible "previous value" (:939–956) | n/a | n/a | Immediate, no undo |
| Roles | Add/End/Delete all immediate, no confirm — "End" silently moves person off the current tab (:1034–1089) | n/a | n/a | Immediate |
| Relationships / Parents | Immediate add/remove, own picker (:1092–1165) | Immediate add/link/create/remove **inside** the scout's single-Save form (`scout-relations.tsx`) — already committed before the bottom Save is ever clicked | Not editable by family | Immediate, but visually nested inside a form that implies "not saved yet" |
| Merge / Delete | Delete: `window.confirm()` naming consequence. Merge: **zero confirmation**, fires on search-result click (:1188–1217) | Promote-to-adult: detailed `window.confirm()` (:586–615) | n/a | Inconsistent gating for equally irreversible actions |
| Pending Update | Table diff + Approve/Reject panel, rendered twice (adult + adult_added) above everything else (`pending-update-panel.tsx`) | Same component, one instance | Origin of the proposal (`editor-actions.tsx`) | Confirm-then-act |
| Create | `adult-form.tsx` — separate dialog, one dirty-irrelevant Save, closes on success | Same `ScoutForm`, `isNew` flag | n/a | Consistent with each other |

### B. Top confusions (ranked)

1. **[High] Two save models coexist unlabeled on one screen — the Marita bug itself.** `people-table.tsx:637–696` (Status: immediate, confirm-then-act, the word "Save" never appears) sits directly above `:845–859` (Demographics: dirty-gated, greyed "Saved" button). A user who just changed Status sees a grey, inert Save button below it and reasonably concludes nothing saved.
2. **[High] The identical job — toggling Active/Inactive — is built two different ways depending on which editor you're in.** Adult/leader: immediate two-step. Scout: folded into one whole-form Save. A leader who learned one model on the Scouts tab gets the opposite on Adults — exactly the seam Patrick tripped on.
3. **[High] `scout-form.tsx`'s single "Save" button doesn't actually save everything under it.** Parents/Guardians (`scout-relations.tsx`) commits every add/link/remove immediately, inside a dialog whose other five sections wait for one bottom Save and whose Cancel (:620–627) discards those five but cannot discard the parent link that already went through. Violates AGENTS.md's own "Cancel reverts to last-saved values."
4. **[Medium-High] Merge has no confirmation; Delete does.** `:1188–1217`. Merge is the more common and more silently destructive of the two.
5. **[Medium] Household reassignment is a live-firing `<select>` with no undo affordance.** `:939–956` — a toast says "Household updated" but nothing shows what it changed from.
6. **[Medium] "End" a role is immediate despite moving someone off the current tab; "Promote to adult" — same class of consequence — gets a detailed confirm.** `:1038–1044` vs `scout-form.tsx:586–615`.
7. **[Medium] Seven `.editorHint` paragraphs, none collapsible, all the same visual weight.** AGENTS.md's own instructions ladder says a "how this section behaves" paragraph belongs behind a disclosure. The wall of grey italic text is a direct contributor to "too much going on."

Missing states: no "what changed" confirmation before household reassignment; pending-vs-live is a separate table in admin but inline per field on /profile (`edit-field.tsx`) — two solutions to one problem.

### C. Best-practice patterns

- **Google/Apple Contacts** — single global Edit toggle, one Save/Cancel for the whole card. Two states only, but requires batching ~10 separate mutations into one payload — biggest backend lift.
- **Stripe customer page** — read-mostly by default; each section has its own "Edit" that opens just that section inline, saves independently, everything else stays inert and legible. Closest fit to what Troop 79 already half-has; it only lacks the "read view first, Edit to unlock" gate.
- **HubSpot/Salesforce record** — persistent summary header + tabs + activity history. Best at scale; this app has no history concept and 25 families doesn't need it yet.
- **Linear/Notion** — click-to-edit, autosave, small status toast. Elegant but risky for a Status/Merge/Delete-heavy screen where consequence needs a visible gate.

**Fit for a 25-family volunteer troop on phones and laptops:** Stripe's pattern. No new global mode to learn, "am I editing or looking" is unambiguous per section, and destructive actions stay deliberately separate from editing.

### D. Three candidate directions

**1. View Card + Scoped Section Edit** (Stripe-style). Read-only summary by default; every section shows its current value plus one Edit affordance. Edit turns that section into a form with Save/Cancel; everything else stays inert. Status becomes a read row with Edit, not a live radio. Pending Updates surface as a banner inside the relevant section. One save model, repeated per section. **Cost:** medium — reuses `FormPanel`/`SaveButton`/`DiscardButton`.

**2. Single Edit Mode, Whole-Person Form** (Google Contacts-style). One Edit toggle for the whole dialog; one Save/Cancel for the whole person. Simplest mental model. **Cost:** high — collapses ~10 independent server actions into one atomic payload; merge/delete stay outside it.

**3. Timeline/Activity Record** (HubSpot-style). Persistent header (name, status badge) + tabs (Details / Household & Roles / History); each tab keeps whatever save model fits. Adds a change log. **Cost:** highest — new IA, new data; most durable as the roster grows.

**Recommendation: Direction 1.** Fixes the Marita bug directly, resolves #2/#3 by giving Scout and Adult/Leader the same wrapper behaviour section by section, buildable on existing primitives. Bank Direction 3 as a later move.

**Must stay constant:** the people-spine/roles/household/relationships model; Pending Update as the only channel a family's edit reaches the record; merge/delete/promote harder to reach than an ordinary edit; AGENTS.md Save-button semantics (labelled state, Saving → Done) wherever a Save exists. Proposed amendment to the house rule: bless "Edit → per-section Save/Cancel" as a valid model alongside the whole-form dirty gate.

### E. Open questions for Patrick

1. Fix the Scout editor's "one giant form + separately-saving Parents section" contradiction (#3) in this same rework?
2. Do leaders ever bulk-edit many fields on one person in one sitting (after an import), or is it one field at a time? Decides whether one-section-at-a-time is a win or friction.
3. Is Merge's one-click-no-confirm intentional, or should it match Delete's confirm?
4. Should Pending Update review move inside each section, even though leaders expect it at the top today?
5. Merge Scout and Adult/Leader into one shared editor shell now (a scout can be promoted mid-life)?

---

## Brad's research (2026-09-07)

**How often a volunteer touches each action**

| Frequency | Actions |
|---|---|
| Weekly | Open from roster; read contact details; apply/reject a Pending Update; acknowledge "added by a family"; send sign-in link |
| Seasonal (recharter, new families) | Edit demographics; add email / make primary / remove; health form + YPT dates; add/link parent or guardian; assign or rename household; mark inactive with reason; reactivate; grade/patrol/swim class; promote scout to adult |
| Rare | Grant or end a role; delete an ended role; sibling/emergency-contact relationship; merge duplicate; delete person; change internal ID |

**Reference products** (web-fetched unless noted): HubSpot contact record (About card with hover-pencil inline edit per field, timeline, associations; archive under header Actions); Stripe customer page (two columns, most-used actions in the header, everything else under Actions, edits in small focused dialogs); Salesforce Lightning record (Highlights panel + Details tab + related lists; inline edit puts a sticky Save/Cancel footer with an unsaved-changes count); Google Contacts (strict view mode, pencil enters one full edit form, repeating groups with "+ add", explicit Save); Scoutbook Plus (one long form, Save at bottom — volunteers complain they cannot find it); TroopTrack (household is a first-class screen; two emails max); PatternFly inline-edit guidelines (field-level for small edits, section-level toggle for many fields, modal when complex); Linear/Notion property sidebar (knowledge).

**Three patterns worth prototyping:** (1) record page, not a form — read-only page, one bounded "Edit details" form, immediate actions in a sidebar with their own confirms; (2) property sidebar — every field click-to-edit with per-field commit, status popover asks the reason, no page-level Save; (3) tabbed record with a single sticky Save bar — status becomes a draft field, one footer "Save N changes · Discard".

**Brad's open questions:** full admin page (`/admin/people/123`) instead of a modal? Is status a draft field or an immediate action with its own confirm? Unify scout's fixed inactive-reason list with adults' free text? Lookup-dominant or batch-edit-dominant use? Household as its own screen? Merge/delete in the editor or on a roster row Actions menu?

## Brad's prototypes

Built 2026-09-07 under `prototypes/person-editor/` — open `index.html` for the chooser and comparison table.

| File | Direction | Try first |
|---|---|---|
| `a-record-page.html` | Jenna's Direction 1: read-only record page, per-section Edit → Save/Cancel, Status is a read row with Edit → reason → confirm, Pending Updates as banners inside the section they touch, Danger zone disclosure with real confirms | The Marita test: Dana Whitlock → Status → Edit → reason → Mark inactive → confirm. Then Details → Edit (Save opens disabled), blank the last name to see the block. Approve the pending phone inside Contact & sign-in. Change household, Undo on the toast. Merge Corey into Priya. |
| `b-property-sidebar.html` | Click-to-edit properties, per-field commit with tick + undo toast, Status popover asks the reason first, no page-level Save | Click Dana's phone, type, Enter; Undo. Click City, type, Esc (nothing saved). Judge it against a bulk clean-up: count the saves. |
| `c-tabbed-save-bar.html` | Tabs Overview / Details / Contact & sign-in / Household & family / Roles / History; one sticky "N unsaved changes · Save · Discard" bar; Status is a draft field; History tab shows a mocked change log | Dana → Details, change first name + flip Status: bar reads 3 unsaved, Details gets a dot. Blank last name for "Fix 1 problem". Household change shows "was: …". Save, read History. Back while dirty → three-way dialog. |

Common to all three: pages with Back nav, not modals (every reference product is a page and the layouts need the width); same invented sample people in adult and scout views; emails and relationships stay one-click but visually separated as lists; at most one "How this works" disclosure per section; 375 px clean; handoff notes disclosure at the bottom of each file.

Brad's deviations to rule on: A and B approve Pending Updates per section/field (today a change request is one unit; C keeps whole-request approval). In C roles stay immediate rather than joining the draft, since granting a role moves someone between roster tabs. "Things we should know" folded into Details. Scout inactive reason stays a required list, adult stays free text.

## Decision

**Patrick, 2026-09-07: Direction A, plus Direction C's History.** Prototype A updated the same day:
a History card in the fact strip (last change · by whom · count; click scrolls to the log) and a
History section above Danger zone, newest first, this session's actions highlighted, fed by every
save / status change / approval / role / email / household action. In the build this is `audit_log`
filtered to the person.

**Sign-in status, as clarified for Patrick:** "Can sign in" is derived, not a switch — any address
on file that has not bounced can request a code or link at /signin; a scout without an address signs
in as a household parent. "Verified" is stamped automatically the first time a code or link sent to
that address is redeemed (`markEmailVerified` in `lib/identity-challenge.ts`); there is no manual
verify, and the Roster's "Send sign-in link" is how a leader gets an address verified. Leaders'
admin access is a separate `leaders.can_login` flag managed on Access & Permissions. The prototype's
Sign-in card now carries a "How this works" disclosure saying exactly this and an Admin access line
for leaders.

**Patrick, 2026-09-07 (later): "Option A looks good now. Let's make the plan and start the build."**

---

# Build Plan (tech-lead, 2026-09-07)

**Status:** Active — Phase 1 in progress 2026-09-07
**Priority:** High
**Spec:** `prototypes/person-editor/a-record-page.html`

## Acceptance Criteria

- [ ] `/admin/advancement/roster/[personId]` renders one record page for both scouts and adults/leaders, read-only by default, each section with exactly one Edit.
- [ ] Status is a read row → Edit → reason → confirm dialog, identically for scouts and adults (retires #1, #2 — the Marita bug).
- [ ] Every section Save is dirty-gated (`save-state.tsx`), shows Saving…→Done, Cancel restores last-saved values; no immediate action sits inside a form that also has a Save.
- [ ] Emails, roles, relationships/parents are visually distinct "Takes effect immediately" lists outside any form (retires #3).
- [ ] Merge and Delete both confirm naming consequences; Delete refused while anything is attached (retires #4).
- [ ] Household reassignment is a draft field; Save toast "Household: A → B" with Undo (retires #5).
- [ ] End role confirms and names the tab move; Promote-to-adult keeps its confirm (retires #6).
- [ ] At most one "How this works" disclosure per section; no standing hint paragraphs (retires #7).
- [ ] History: fact-strip card (last change · who · count) + History section (latest 4, chips with hover tooltip + click dialog, field-level old→new) fed by `audit_log`, plus a "Full log" modal.
- [ ] `?tab=X&open=ID` still deep-links (redirects into the new page); Add Adult and Add Scout unaffected.
- [ ] lint + typecheck + test + build pass at the end of every phase; browser check of the Marita scenario after Phase 1, full flow after Phase 6.

## Test Plan

`Leader_SeesNoContradictorySave_WhenStatusJustChanged`, `Leader_MarksScoutInactive_SameFlowAsAdult`, `Leader_ReactivatesPerson_ReasonCleared`, `Leader_CancelsSectionEdit_RestoresLastSavedValues_NotPageLoadValues`, `Leader_OpensSecondSectionWhileFirstIsDirty_IsPromptedToDiscard`, `Leader_BlanksRequiredName_SaveStaysDisabledWithReason`, `Leader_RemovesOnlyEmail_ButtonDisabledWithReason`, `Leader_EndsSoleLeaderRole_SeesTabMoveNotice`, `Leader_MergesPerson_SeesConfirmNamingWhatMoves`, `Leader_DeletesPersonWithAttachments_ButtonRefused`, `Leader_ChangesHousehold_ToastOffersUndo`, `Leader_OpensDeepLinkFromRoster_LandsOnRecordPage`, `Family_SubmitsChangeRequest_BannerAppearsInTouchedSection`, `Leader_ViewsHistory_SeesFieldLevelOldToNew_ForActionsLoggedAfterCutover`, `Leader_ViewsHistoryForPreCutoverAction_SeesSummaryOnly_NoDetailsCrash`; extend `tests/audit-coverage.test.ts` to the new action files.

## Technical Approach

**Route.** `next-app/src/app/admin/(workspace)/advancement/roster/[personId]/page.tsx` — one dynamic route for both kinds; `sectionsFor(kind)` picks the section list. Server loader: `getPersonDetail` + scout-only columns (via `loadScoutRows` filtered to one) + `getPersonEmails` + `getPendingChangeRequest` + new `getPersonHistory`. `roster/page.tsx`'s `?open=ID` becomes a redirect to `/admin/advancement/roster/${id}?from=${tab}` for every tab; the roster list itself is untouched.

**Reused as-is:** addRole/endRole/deleteRole, setHousehold, add/removeRelationship, the four email actions, sendSignInLink, mergePersonInto, deletePerson, createHouseholdForPerson/renameHousehold, approve/rejectChangeRequest, createPerson (Add Adult), createScout (Add Scout).

**Changed:** `setPersonActive` gains a `details` diff passed to `recordAudit`; new `setScoutActive(scoutId, active, reason)` mirrors it (today `updateScout` in `lookups/actions.ts` conflates active with every other field — extend, don't duplicate). `updateScout` splits by section: `updateScoutIdentity` (first/last/patrol/bsa) + `updateScoutFields` (school/grade/swim/jl/things-we-should-know); person-side fields reuse `updatePersonDemographics`. Every changed/new action's `recordAudit` gets `details: [{field, from, to}]` computed from the row read before the write.

**Retirement (Phase 6):** `PersonEditor` deleted from `people-table.tsx`; `ScoutForm` keeps only `isNew`; `scout-relations.tsx` UI moves into the Family section's immediate block; `AdultForm` untouched; `PendingUpdatePanel` data reused, rendering inlined per section.

**History data.** `recordAudit` today writes `summary` only; no roster call site populates `details`. D-257's rule (summaries name people and field NAMES, never values) governs `summary`; `details` carries the field-level diff. No backfill: entries with `details IS NULL` show summary only. History starts when this ships.

**Reused UI:** save-state pieces, FormPanel/FormSection, Button, Dialog, PageTitle with `back: {label, href}` (depth-2, gets the dirty-nav guard for free), one "How this works" disclosure per section.

## Phases

| # | Scope | Size | Retires |
|---|---|---|---|
| 1 | Shell + Status parity. New `[personId]/page.tsx`, `person-record.tsx`, `status-card.tsx`, `load-person-record.ts`; `roster/page.tsx` redirect on `?open=`; `setPersonActive` details; new `setScoutActive`. Old editors stay live in parallel. Tests: MarksAdultInactive, MarksScoutInactive same flow, Reactivates, DeepLink. Gate + browser check of the Marita scenario. | L | #1 #2 |
| 2 | Section forms: `identity-section.tsx` (scout), `details-section.tsx`, `contact-section.tsx`, `family-section.tsx` (household draft + relations immediate block); split `updateScout`; `setHousehold` details for Undo. Tests: EditsDetailsSection, CancelsSectionEdit, SecondSectionWhileDirty, BlanksRequiredName, ChangesHousehold Undo. | L | #1 #3 |
| 3 | Immediate blocks + Danger zone: `emails-block.tsx`, `roles-block.tsx`, `relationships-block.tsx`, `danger-zone.tsx`; confirms for End role and Merge. Tests: EndsSoleLeaderRole, MergesPerson, DeletesWithAttachments refused, RemovesOnlyEmail disabled. | M | #4 #6 |
| 4 | History: `get-person-history.ts`, `history-card.tsx`, `history-section.tsx`, `history-dialog.tsx`; backstop that every action from phases 1–3 passes `details`. Tests: FieldLevelDiff post-cutover, PreCutover summary only, FullLog newest first. | M | Direction C add |
| 5 | Pending Update banners per section: split `pending-update-panel.tsx` into `pending-banner.tsx` mounted per section, filtering proposed keys to that section; approve/reject stay whole-request. Tests: BannerAppearsInTouchedSection, ApprovesFromOneSection applies whole request. | S | top-of-page pending |
| 6 | Retirement + sweep: delete PersonEditor, ScoutForm edit branch, scout-relations.tsx, dead imports; AGENTS.md amendment; styleguide "Person Record Page" specimen + scoreboard row. Full gate + browser check of the complete flow on a scout and an adult/leader, deep link, Back-with-dirty prompt. | S | #7 |

## AGENTS.md amendment (Phase 6, add to "Save buttons" after point 5)

> **Per-section Edit is a valid alternative to one whole-form dirty gate (2026-09-07):** a record page may give each section its own Edit → dirty-gated Save/Cancel using the same `save-state.tsx` pieces, rather than one Save for the whole page — provided only one section is editable at a time (opening a second section's Edit while another is dirty prompts to discard) and one-click actions (emails, roles, relationships) are visually separated as a labelled "Takes effect immediately" block, never inside a draft form. Reference: `roster/[personId]/`.

## Risks

Concurrent Claude sessions share this repo and the local DB — stage explicit files, never `git add -A`. `people.primary_email` is a trigger cache — email writes go through `lib/person-emails` / `write-person-demographics`, never a raw `people` update. `PendingUpdatePanel` is shared with change requests. D-257 keeps values out of `summary`; `details` is where they go.

## Open Questions

- **Per-section approve (Brad's deviation):** `change_requests` is one row per entity approved/rejected whole (D-098/D-103); no field-level entry point. **Assumed for Phase 5:** banner per touched section, but Approve/Reject from any section acts on the whole request. True per-field approve is a follow-on if this proves confusing. Does not block Phases 1–4.
- Nothing blocks Phase 1.
