# Scout progress grid (Concept A2): build plan

Nov 8, 2026 · Patrick Bieser

## Goal and scope

Replace the Scout progress grid on every public merit badge page with Concept A2: one column per requirement option, choice brackets instead of "Req 1 / Req 2" headers, solid forest boxes for done, and earned scouts listed last. It should match the meeting planner's checklist style and fit the 1180px content column without sideways scrolling for a typical badge.

Reference design: [Merit Badge Scout Progress canvas](https://claude.ai/artifact/SE12nBHzJ1XUXEZNYENTH4), board **Concept A2 · earned scouts keep their checked boxes** (`project/Concept-A2.dc.html`). The **How each requirement rule reads** board on the same canvas shows every rule pattern.

**Changes**

- Remove the "Req 1", "Req 2"… top header row and the AWARD star column.
- Add a bracket row that marks choice groups ("any 1", "any 2", "all", "a + any 1 of b–c", "all of a–c or all of d–f").
- New cell states: done, still to do, not needed.
- Replace the star with a Progress column: "4 of 9" plus a bar, or an Earned pill.
- Earned scouts sort to the bottom. If their requirements were recorded they keep their checked boxes; if a counselor signed off the whole badge with no detail, they get one "All requirements complete" bar.

**Stays as is:** the page header and buttons, the Requirements list below the grid, the Superuser "view as" picker, and who appears in the grid (scouts in progress or earned; not-started scouts stay out).

## Data needed

The grid needs three things per badge: the requirement tree with a completion rule on each parent, each scout's completed requirement codes, and each scout's earned status. Check what the current schema already stores before adding anything (see also `Plans/Requirement-Classification.md` and `Plans/Library-MB-Consolidation.md`).

**1. Requirement rule on each parent requirement.** The bracket label and the "not needed" state both come from this rule. Suggested shape:

```json
{ "n": "1", "rule": { "kind": "pick", "count": 1 }, "subs": ["a", "b", "c", "d"] }
{ "n": "5", "rule": { "kind": "all" },              "subs": ["a", "b", "c"] }
{ "n": "6", "rule": { "kind": "required_plus_pick", "required": ["a"], "count": 1 }, "subs": ["a", "b", "c"] }
{ "n": "7", "rule": { "kind": "any_set", "sets": [["a","b","c"], ["d","e","f"]] }, "subs": ["a","b","c","d","e","f"] }
{ "n": "3" }   // no subs: a single requirement
```

The Requirements list already says "Do any one of the following", so this rule may already exist as text. If so, map that text to a structured rule; don't parse prose at render time. Report any badge patterns that don't fit these four kinds instead of guessing.

**2. Completions.** A list of completed codes per scout per badge (`1d`, `2b`, `3`…). Use whatever sign-off table already feeds the current grid.

**3. Earned status and whether requirements were recorded.**

- `earned`: the badge was awarded.
- `requirementsRecorded`: true when the scout's individual requirements are on file. Derive it as "earned and has at least one completion record" unless the schema already has an explicit field (see Open decisions).

**Rule evaluation (one function, used by both cells and progress):**

- `pick n`: met when done subs ≥ n.
- `all`: met when every sub is done.
- `required_plus_pick`: met when all required subs are done and at least `count` of the rest are.
- `any_set`: met when every sub in at least one set is done.
- A single requirement: met when its code is done.

Progress = parent requirements met ÷ total parent requirements ("4 of 9").

## Layout spec

The grid is a warm-white card on the public newsprint page, set in Open Sans, using public tokens only (no `admin-` tokens). Values below come from the A2 board.

**Card header (one line):** "Scout progress" (16px, 700, `text-head`), a count line ("3 earned · 6 working on it · 23 not started", 13px, `text-meta`), and a right-aligned legend: Done, Still to do, "Not needed, another option done".

**Columns, left to right**

| Part | Size | Notes |
| --- | --- | --- |
| Scout | 210px | First name + last initial, 14px 600 `text-head`; rank after it, 12px `text-meta` |
| Requirement cells | 26px each | One per leaf code (`1a`…`1d`, `2a`, `2b`, `3`…). 12px gap before the first code of each parent requirement |
| Progress | 150px | 20px left padding |

**Header rows**

1. Bracket row: one block per parent requirement, as wide as its cells. Groups get a label (11px, 700, `bark`) above a 5px bracket line (1px `khaki`, no bottom border). Single requirements get no bracket. Labels: `any 1`, `any 2`, `all`, `a + any 1 of b–c`, `all of a–c or all of d–f`.
2. Code row: codes centred over cells, 12px 700 `navy`, `rule` hairline below.

**Cell states** (20×20px box, 3px radius, centred in its 26px column)

| State | When | Look |
| --- | --- | --- |
| Done | Code completed | `forest` fill and border, white ✓ |
| Still to do | Not done and its group not met | White fill, 1px `border-mid` |
| Not needed | Not done, but its group's rule is already met | No box, "–" in `border-mid` |

**Rows:** 36px minimum, hairline between rows.

**Progress column**

- In progress: "4 of 9" (13px 600, tabular figures, 44px wide) + a 60×5px bar (`border-light` track, `forest` fill).
- Earned: an "Earned" pill, white 12px 700 on `forest`, fully rounded.

**Earned rows**

- Recorded requirements: the normal cells (done and not-needed states) + the Earned pill.
- Counselor sign-off only: one bar spanning all requirement columns, `status-success-bg` fill, 3px radius, 22px tall, "All requirements complete" in 12px 600 `forest` + the Earned pill.

**Sort order**

1. In-progress scouts, most requirements met first, then by name.
2. A `border-mid` divider line.
3. Earned scouts with recorded requirements, then counselor-only sign-offs, each by name.

**Accessibility:** build it as a real `<table>` with `<th scope>` for codes and scout names, or give each cell `role="img"` with an `aria-label` like "1d done", "1b not needed", "3 still to do". The bracket label belongs in the header cell's accessible name ("1a, any 1 of 1a–1d").

**Overflow:** a badge with more columns than fit wraps the grid in a horizontal scroll box inside the card, with the Scout column sticky. The page itself never scrolls sideways.

## Build steps for Claude Code

Work in `D:\Projects\Troop79-Website` (`next-app/`). Read `next-app/AGENTS.md` and the design tokens in `next-app/src/app/globals.css` first.

- [x] **Find the current grid.** Locate the component behind the Scout progress section on the public merit badge page and the query that feeds it. Note how requirements, sign-offs and awarded badges are stored.
- [x] **Confirm the rule data.** Check whether choice rules ("do any one", "do two") exist as structured data. If not, add a `rule` field per parent requirement (Data needed §1) and fill it for every badge. List any badge whose wording doesn't fit the four rule kinds, and stop to ask before inventing a fifth.
- [x] **Write `evaluateRequirement(rule, subs, doneCodes)`.** It returns `{ met, doneCount, needed }`. Unit-test all five cases with the examples on the canvas rules board.
- [x] **Write `buildProgressGrid(badge, scouts)`.** A pure function returning bracket groups, header codes, and sorted rows with per-cell state (`done` | `open` | `notNeeded`), progress, earned and `requirementsRecorded`. Keep it free of UI code so the meeting planner can reuse it.
- [x] **Rebuild the component** per the Layout spec: semantic table, public tokens only, no new icon library.
- [x] **Remove** the Req N header row and the AWARD star column.
- [x] **Overflow:** horizontal scroll box inside the card, sticky Scout column.
- [ ] **Check against the meeting planner:** box size, radius and ✓ weight should read as the same family. The planner uses `navy` for open-to-assign; this grid uses `forest` for done.
- [ ] **Run the acceptance checks** below on Communication, plus a long badge and a badge with nested rules, at desktop and 390px width.

## Acceptance checks

On the Communication page with today's data, the grid should match the A2 board exactly. Communication has 1 (any 1 of a–d), 2 (any 1 of a–b), 3–6, 7 (any 1 of a–c), 8 and 9: 15 code columns, 9 parent requirements.

| Order | Scout | Done codes | Shows |
| --- | --- | --- | --- |
| 1 | Anjali S. | 1d, 2b, 3, 8 | 4 of 9; 1a–c and 2a show "–" |
| 2 | Hazel S. | 1d, 2b, 8 | 3 of 9 |
| 3 | Jack P. | 1d, 2b, 8 | 3 of 9 |
| 4 | Oliver K. | 1d, 8 | 2 of 9; 2a and 2b still to do |
| 5 | Violet B. | 1d, 8 | 2 of 9 |
| 6 | Finn P. | 1d | 1 of 9 |
| 7 | Oliver V. | 1d, 2b, 3–6, 7a, 8, 9 | Earned pill; 7b, 7c show "–" |
| 8 | Veronica K. | 1d, 2b, 3–6, 7c, 8, 9 | Earned pill; 7a, 7b show "–" |
| 9 | Kevin P. | none recorded | "All requirements complete" bar + Earned pill |

**Also check**

- No "Req 1" header row and no star anywhere.
- A divider sits between Finn P. and Oliver V.
- The page doesn't scroll sideways at 1180px or at 390px (the grid scrolls inside its card on phones).
- Signing off one more code for a scout updates the grid without a page rebuild, if the page is live today.
- Screen reader: every cell announces its code and state.

## Open decisions

- [x] **Counselor-only flag:** DERIVED (Patrick 2026-11-08: outside counselor sign-offs with no detail are normal); an award whose records do not add up to the badge also gets the bar. derive it from "earned with no completion records", or store an explicit `signedOffWithoutDetail` on the award? Deriving needs no schema change; an explicit flag survives a partial import.
- [x] **Stat tiles:** KEEP all four (Patrick 2026-11-08); the card header carries no count line, it would repeat them. keep the four Earned / In progress / Not started / Active scouts tiles, or drop them for the one-line count in the card header (as on the A2 board)?
- [x] **Superuser "view as" scout:** HIGHLIGHT the row (Patrick 2026-11-08). highlight that scout's row in the grid, or leave the grid unchanged?
- [x] **Rule data source:** already structured — merit_badge_requirements.complete_rule + complete_n per node; compound kinds are nested parents (Camping 9, Archery 5, Rifle 2). No schema change, no backfill (Patrick OK 2026-11-08). A rule on a leaf (Emergency Prep 1b) is the counselor’s call, ignored. confirm where choice rules live today. Claude Code reports back before backfilling every badge.
