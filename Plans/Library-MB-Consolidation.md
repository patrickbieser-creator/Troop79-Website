# Library Merit Badge Page — one Requirements section, per-requirement suggestions

**Status:** Built — all 3 phases shipped 2026-09-07 (v1.122.0 phases 1–2, v1.122.1 phase 3). Deferred: the
Add Resource entry form's own placement picker still offers whole-badge only (not one of the two admin
call sites named in the plan); duplicate-URL detection remains a pre-existing gap.
**Priority:** High
**Trigger:** Patrick, 2026-09-07: "consolidate the 'Requirements', 'Whole-Badge Resources' and 'I Did This'
sections into one section using the display of Requirements. There's no reason for the redundancy. Draw a
prototype of a Merit Badge page where after the grid of scouts, the list of requirements display includes
the information previously found in the other two sections. Also, we will need a plan for how to attach a
video, link, doc etc. suggestion to the individual requirements, not whole badge."

**Prototype:** `prototypes/library-mb/index.html` (README beside it). Serve the folder and open it, or open
the file directly. Try: the viewer switcher (scout / household with two scouts / visitor), row 4c
(three resources, pinned YouTube thumbnail, a pending suggestion visible only to the submitter),
"I did this" on 1d, "Suggest a resource" on 6, Collapse all, the Handoff notes at the bottom.

**Headline finding (tech-lead):** no schema or write-path change is needed. `library_placements`,
`requirement_notes` and `requirement_submissions` already accept `target_kind='mb_req'` keyed
`{mbId}-{code}`; the public submit action and the admin placement action already accept it; the page
already loads every per-requirement placement for the badge in ONE query. What is missing is
presentation and two pickers that never exposed the option.

---

## Jenna's spec (2026-09-07)

### A. Inventory today

| Section | Data | Actions | Audience |
|---|---|---|---|
| Stats strip + Scout Progress grid | ledger × active scouts | read-only, links to `/scouts/[id]` | parent, leader |
| Requirements (`MbRequirementsTree`) | `merit_badge_requirements` tree, optionality notes | none | scout, counselor, parent |
| Whole-badge resources | placements `target_kind='mb'` | ResourceCard link-out; "Suggest one →" prefilled `mb:{id}` | scout, parent |
| Per-requirement resource groups | placements `mb_req` rolled up to TOP-LEVEL code, one SectionDivider each | ResourceCard | scout, parent |
| I did this (`MbProofPicker`) | every leaf, grouped by top-level | radio → `/library/submit-proof?target=mb_req:…` | verified parent / verified scout |

**Redundancies:** the requirement code + label renders three times for one leaf (tree; resource-group
divider truncated to 60 chars without the optionality note; proof-picker radio). The top-level grouping is
computed three times. "Suggest" and "I did this" hang off the same leaf from two distant scroll positions.
Whole-badge resources are the one thing NOT redundant with a leaf — do not lose them.

### B. The consolidated section

One list titled "Requirements" right after the Scout Progress grid. SectionDividers on the page go from 4
to 2. Row anatomy per leaf (and per parent with a note):

```
[code]  Label                                              [state badge if any]
  Note: "Do ONE of a, b, c"  (parent rows, unchanged)
  inline resources for THIS leaf — kind glyph · title · host — pinned first, "+N more" beyond 3
  narrative snippet if requirement_notes exists (2 lines, "Read more")
  Suggest a resource →     I did this →
```

- **Whole-badge resources → a "For the whole badge" group at the TOP of the list**, lighter inline header,
  not a SectionDivider, and NOT folded under requirement 1 (that misattributes scope).
- **"I did this" is a per-row action, not a mode toggle**; the row IS the selection, so the radio step goes.
  Parent rows with children get no claim action (no ledger row of their own; same rule as ranks).
- **Scout-login block:** one dismissible note at the top of the list, not repeated per row.
- **No accordions** (D-070: `<details>` shipped blank twice). Flat list; if length becomes a complaint, a
  sticky in-page jump nav, not disclosure widgets. Brad's Collapse all / Expand all is a JS toggle, not
  `<details>` — acceptable but still a judgement call for Patrick.
- **Mobile 375 px:** code + label + actions stack; full label wraps (no 60-char truncation).
- **Disappears:** Whole-badge divider, per-group dividers, the standalone "I did this" h2 + FormCard, the
  picker intro sentence. **Stays:** the BSA-pamphlet disclaimer paragraph. The `#i-did-this` anchor from the
  header's jump link must move to the consolidated list.
- **No completion state per row this pass** — the grid above already answers it; `?viewScout=`
  personalization stays parked (Patrick to confirm).

### C. Per-requirement suggestions, UX

Row-level "Suggest a resource →" prefills `/library/submit?target=mb_req:{mbId}-{code}` (the action
already accepts it). The general submit form stays. Pending state to the submitter: the existing
"Sent for review" confirmation; **no pending badge visible to other viewers** (curation before exposure).
Moderation queue unchanged except the target display should read "{Badge} — Requirement {code}: {label}".

### D. Risks / don'ts

Cap inline resources per row (3, "+N more" expands in place). Distinguishable accessible names per row
action ("Suggest a resource for 4a"). Keep the no-embeds rule. Preserve study → do → claim ordering within
the row. One consolidated server load, no per-row fetches.

### E. Jenna's open questions

1. "For the whole badge" group: always fully shown, or collapsible once it has many resources?
2. Should `/library/submit`'s dropdown gain per-leaf MB targets, or is the row deep link enough?
3. Does a parent-level requirement need to explain why it has no "I did this"?
4. Confirm no per-row completion state this pass.

---

## Tech-lead's plan (2026-09-07)

### What already exists
- Schema: all three library tables accept `mb_req` with key `{mbId}-{code}`.
- MB page fetches ALL published `mb_req` placements for the badge in one `LIKE '{mbId}-%'` query
  (`page.tsx:121–132`) and groups by top-level code (`topGroups`). No N+1 exists; the gap is grouping
  granularity (top-level, not leaf) and missing per-viewer state.
- Proof submission already targets leaves (`submit-proof/actions.ts` VALID_TARGET_KINDS; `resolveRequirementLabel`).
- Rank leaf pages are already one consolidated section per leaf; no rank-side change needed.

### What is missing
1. `/library/submit`'s target `<select>` has no `mb_req` option, though `submitLibraryResourceAction`'s
   `TARGET_KINDS` already includes it (`submit/actions.ts:23`). Pure UI omission.
2. Admin moderation's `TargetSelect` takes `includeMbReq` but both call sites pass `false`
   (`admin/library/page.tsx:774`, `:973`) and the `true` branch is a disabled placeholder;
   `addPlacementAction` already accepts `mb_req` writes.
3. No row-level suggest entry point at leaf granularity (`suggestHref` is whole-badge, `page.tsx:212`).
4. No per-viewer pending state on the page (new behaviour, stretch).
5. No duplicate-URL detection anywhere (pre-existing, out of scope unless asked).
6. MB leaf-code rename has no UI; `cascadeLibraryReqRename` is only ever called with top-level codes —
   must stay that way.

### Acceptance criteria
- [ ] One requirements section: each row shows label, its resources, suggest + claim entry points; one consolidated load, no N+1.
- [ ] A row-level deep link (and/or the submit picker) can target an individual `mb_req`, write path unchanged.
- [ ] Admin "+ Place" and narrative pickers can target an individual `mb_req`, write path unchanged.
- [ ] Rank pages, rank submit targets, whole-badge placements unaffected.
- [ ] Moderation and Proof queues show the specific requirement label.
- [ ] lint + typecheck + test + build green; browser check as visitor, verified parent, scout session.

### Test plan
`Visitor_SeesResourcesGroupedByLeafRequirement_WhenViewingMbPage`, `Visitor_SeesWholeBadgeResources_AlongsideLeafResources_OnOnePage`,
`Family_SeesSuggestLinkPrefilledWithLeafTarget_OnRequirementRow`, `Family_SubmitsResourceForSpecificMbRequirement_AndItQueuesWithMbReqPlacement`,
`Webmaster_PlacesResourceOnIndividualMbRequirement_ViaAdminPicker`, `Webmaster_RetargetsResourceFromWholeBadgeToSpecificRequirement`,
`Webmaster_WritesNarrativeForIndividualMbRequirement_ViaAdminPicker`, `RankPages_Unaffected_WhenMbReqOptionsAddedToTargetSelect`,
`AnonKey_CannotReadLibraryTables_Regression`.

### Technical approach
- `loadMbPageResources(supabase, mbId, isLeader)` in `lib/library-data.ts` → `{ wholeBadge, byLeafCode }`
  re-keyed from the SAME query already fetched; pending-submission surfacing is an additive second query
  scoped to the viewer's own scout(s) and `target_key LIKE '{mbId}-%'`.
- Row-level `suggestHref(mbId, code) = /library/submit?target=mb_req:{mbId}-{code}`.
- Generic submit dropdown: a flat option per leaf across all badges is ~1,500 options — recommend the row
  deep link is the only path to a specific `mb_req` (same precedent as rank sub-requirements).
- Admin `TargetSelect`: flip `includeMbReq` at both call sites and build a badge → requirement two-step.
- **No write-path changes**: `submitLibraryResourceAction`, `addPlacementAction`, `createResource`,
  `cascadeLibraryReqRename` stay untouched; a PR touching them is scope creep unless a bug surfaces.

### Phases
| # | Scope | Size |
|---|---|---|
| 1 | Consolidated loader, no visual change: `lib/library-data.ts`, `mb/[mbId]/page.tsx` re-key by leaf + pending query. | S |
| 2 | One consolidated section + row-level suggest: `mb-requirements-tree.tsx` takes resources-by-code + hrefs; `page.tsx` drops three dividers; `mb-proof-picker.tsx` retired or folded per the shipped spec. Browser check visitor / parent / scout. | M |
| 3 | Picker parity: admin `TargetSelect` two-step (+ optional submit dropdown if Q2 says yes). | S/M |

### Risks
1000-row cap not at risk per badge (First Aid ~83 leaves); `fetchAllRows` if the admin two-step ever loads
troop-wide. Leaf-code rename stays UI-less. `visibility='leaders'` filtering already correct; the new
pending query must be scoped to the viewer's own scout. Concurrent sessions: explicit paths.

### Tech-lead's open questions
1. Per-row "I did this" folding `mb-proof-picker.tsx` entirely? (Jenna: yes.)
2. Generic submit dropdown listing `mb_req`, or row deep link only? (Recommendation: deep link only.)
3. Ship per-requirement narratives in the same admin picker fix (falls out for free)?

---

## Brad's prototype notes (2026-09-07)

Built on Chemistry's real tree (public BSA text, paraphrased as production does); scouts, household,
counselor and resources invented. Demonstrates viewer switching, row 4c with a pinned YouTube thumbnail
(links out, no embed) and a submitter-only pending line, "I did this" with per-scout pre-selection and a
greyed already-signed-off scout, "Suggest a resource" pre-targeted to the row, Collapse all / Expand all,
375 px, keyboard focus, and a Handoff notes disclosure (schema mapping, 7-step attachment plan, open
questions). Deviations: scout viewer shows "I did this" enabled (Phase 0 auth refuses scout-session
proof today); proof and suggest are in-page dialogs, mapped to the real routes in the notes.

### Brad's open questions
1. Scout-login "I did this": enabled as prototyped, or greyed "ask a parent" per Phase 0?
2. Suggest form: allow re-targeting within the badge, or strictly pre-targeted with a go-back link?
3. Group-level placements (`chemistry-4`) still allowed, or leaf-only (needs a migration pass)?
4. Visitor suggestions: name label only, or require an email?

---

## Decision

**Patrick, 2026-09-07 (prototype rev 2), "reduce the noise":** a requirement row at rest is code · label ·
a small Done/Pending pill WITH the completion date · up to three icons at the right edge, in this order
(Patrick's refined wording, same day):
1. **View Resources (##)** — with the count; displayed ONLY when the requirement has resources. Clicking
   it, or the requirement text, accordions the row open to reveal its resources and note.
2. **I Did This** — displayed ONLY when the requirement is not already complete for the viewer's scout(s)
   (hidden, not greyed, once every own scout is done or pending; never shown to visitors). Opens the
   proof dialog.
3. **Suggest a resource** — always shown; icon-only with a hover state that says what it does.
Nothing else is visible at rest. The old legend strip (Done / Pending / Not yet / Pinned) is gone; one
quiet legend at the top names the three icons. Pinned is a ★ before the title. The Scout Progress grid's
header rule is one continuous line under Scout and Award.

**Scout selector (Patrick, same day):** when a household with two or more scouts is signed in, a
pull-down like the library superuser's scout picker sits directly under the Scout Progress grid and
above the Requirements header. The rows personalise to the selected scout only (Done pill without
initials, "I did this" only where that scout still needs it, proof dialog pre-selects that scout). One
scout in the household → no pull-down. Maps to the existing `?viewScout=` mechanism in the build.

_Next: Patrick approves rev 2 or redirects; then the tech-lead phases above become the build plan._
