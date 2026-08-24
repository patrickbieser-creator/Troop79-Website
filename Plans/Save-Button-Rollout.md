# Save-Button Standard — workstation rollout

**Created:** 2026-08-24 · **Status:** COMPLETE 2026-08-24 — v1.88.0 (infra + Calendar) through v1.88.6 (Finance, notes, patrol board, Library narrative). Move to Plans/Completed/ at end-session.
**Rule:** next-app/AGENTS.md "Save buttons" (Patrick, 2026-08-23). Shared pieces:
`admin/(workspace)/_components/save-state.tsx` — `useSavedSnapshot(draftKey)`, `SaveButton`,
`useSavePhase` + `SaveFeedback`. Demo: /admin/styleguide/admin → Save Buttons.

## Audit result (65 controls, 2026-08-24)

Only 6 had a real dirty gate; 2 fully compliant (public sign-up forms). Triage:

### A — edit forms that need the full standard (19)
| Form | File | Status |
|---|---|---|
| Calendar entry details | `calendar/entry-form.tsx` | ✅ v1.88.0 |
| Calendar event story | `calendar/[id]/workbench.tsx` | ✅ v1.88.0 |
| Builder: edit price tier / edit job | `events/[id]/builder-panels.tsx:474, 741` | ✅ |
| Tent/car group editor | `rosters/[id]/assignments/assignments-board.tsx:392` | ✅ |
| Roster Edit dialog (claims + notes) | `rosters/[id]/roster-table.tsx:1047` — diff exists (`diffClaimEdits`), just not used to gate | ✅ |
| News article editor | `news/articles/[id]/article-editor.tsx:266` | ✅ |
| Media alt/caption | `news/media-manager/media-manager-view.tsx:287` | ✅ |
| Photo album row | `news/photo-albums/albums-editor.tsx:338` | ✅ |
| Library narrative | `library/page.tsx:992` — uncontrolled `<form action>`; needs a client wrapper | ✅ |
| MB editor | `advancement/lookups/mb-editor.tsx:349` | ✅ |
| Req-code row | `advancement/lookups/req-codes-table.tsx:173` | ✅ |
| Category rename | `advancement/lookups/categories-editor.tsx:266` | ✅ |
| Skill assign | `advancement/lookups/skill-assign-editor.tsx:136` | ✅ |
| Household rename (lookups + people-table) | `households-manager.tsx:133`, `roster/people-table.tsx:792` | ✅ |
| SEO settings | `advancement/lookups/seo-editor.tsx:134` | ✅ |
| Reminder-email wording | `advancement/lookups/site-text-editor.tsx:99` | ✅ |
| Ledger entry edit | `advancement/ledger/row-actions.tsx:308` | ✅ |
| Scout record | `advancement/roster/scout-form.tsx:615` | ✅ |
| Person demographics | `advancement/roster/people-table.tsx:741` | ✅ |
| Meeting logistics / agenda item | `advancement/meetings/[id]/meeting-editor.tsx:216, 615` | ✅ |
| Finance: edit transaction / reconciliation | `finance/edit-transaction-dialog.tsx:246`, `finance-workspace.tsx:892` | ✅ |
| CoH note / weekly report note | `court-of-honor-workspace.tsx:186`, `report/report-workspace.tsx:173` | ✅ |

### B — gated already, label/feedback polish only (4)
Front-page order (`news/articles/front-page-order.tsx`), Article style tokens
(`lookups/article-tokens-editor.tsx`), Patrol board (`roster/patrols/patrol-board.tsx`),
public Profile change-request (`(public)/profile/editor-actions.tsx` — "Submit update" is its own verb; fine).

### C — leave alone (~40)
Create-once/Add forms (own verb, "anything filled" gate); actions not drafts (Approve, Deny,
Mark paid, Accept, Merge, Decline, Return, Fill In, Apply bundle, Grant); 13 auto-save-on-blur
groups (Builder Settings, Roll Call, records checkboxes, capability grid, calendar inline cells);
2 GET filters mislabelled Apply/Update (cosmetic).

## Rollout order (one gated commit per area)
1. ✅ Infra + Calendar (v1.88.0)
2. ✅ Events/Rosters (v1.88.2): builder price/job editors, roster Edit dialog, tent/car groups
3. ✅ News/Media (v1.88.3): article editor, media alt, album row, front-page order label
4. ✅ Lookups (v1.88.4): MB editor, req-code, category, skill, household, SEO, reminder email, style tokens label
5. ✅ Roster/People (v1.88.5): scout form, demographics, household rename
6. ✅ Meetings (v1.88.5): logistics, agenda item
7. ✅ Finance (v1.88.6) — reconciliation left as a create-once form (each record is new): edit transaction, reconciliation
8. ✅ Notes, Library narrative, patrol board (v1.88.6): CoH, weekly report; Library narrative (client wrapper); patrol board label

## Dialog pattern
Dialogs close on save, so "Saved" state = closed dialog. Standard applies as: dirty gate + label
while open; `SaveFeedback` rendered by the PARENT (phase 'saving' during the transition, 'done'
flash after close + `router.refresh()`).
