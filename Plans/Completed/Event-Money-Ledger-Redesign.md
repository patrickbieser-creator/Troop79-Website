# Event Money: Ledger + Person Panel Redesign

**Status:** SHIPPED v1.265.0 (2026-11-12, 40f7cac8; field font 3ac83813)
**Parked:** 2026-11-12
**Priority:** Medium

## Overview

Redesign the event Money tab (`/admin/rosters/[id]/money`, `money-panel.tsx`) around design direction **B, "Ledger with a person panel"**. The summary becomes one band instead of five tiles. "Who owes what" becomes a tight, read-only ledger with a totals row. Clicking a row opens a side panel for that person. Everything you can do to one person lives in that panel: set what they owe (tier / custom / not paying), record a payment (full or partial), refund, credit to account, and see and void history. The row-level Edit / Record payment / Refund / History buttons and the inline history rows go away.

Design reference (Claude Design canvas, two B artboards):
https://claude.ai/artifact/TtGbRDy2LeVj7HQMPEiKy3
- **B · Ledger: custom amount and history**: Adam Gabbard selected, custom amount, three-entry history.
- **B · Ledger: recording a part payment**: Edie Pasek selected, $15 of $25 being recorded.

The canvas uses the Troop 79 design system's leader-workspace (`admin-*`) tokens. Build with the existing workspace components and tokens. Do not copy the canvas's inline styles.

## Problem / Opportunity

- **The tiles repeat each other and bury the key number.** Income and Net both read $105. Total expected ($195), the number that gives the others meaning, sits at the far right.
- **Each row says the same thing several ways.** Owed / Paid / Balance / Status overlap.
- **There are too many row buttons.** Every row carries Edit, then Record payment or Refund + History. Eleven Edit buttons compete with the actions that matter.
- **History opens inline** and pushes the table around. Void is hard to find.
- **An override has no reason and no trail.** The history can't show who changed an amount, or why.
- **The bucket control takes the top of the page** although it rarely changes.

## Design spec (all elements in the two B artboards)

### 1. Event tab strip (unchanged)
- `EventNav` stays as is: Entry · Agenda · Signup · Roster · Assignments · **Money** · Snapshot · Roll Call.

### 2. Title row
- **Left:** page title "Money".
- **Right:**
  - **Bucket line:** "Bucket **Climbing MB '26** ▾". The ▾ opens the existing `EventBucketControl` (with "+ New bucket…") in a popover. Keep its "Takes effect immediately…" hint inside the popover.
  - **"+ Add expense":** a quiet forest Add button. It scrolls to the Expenses & reimbursements section and focuses the first field of its add row.

### 3. Summary band (replaces the five tiles)
One white card with two parts.

**Left part (headline):**
- **Big number:** "**$105** income, of **$195** expected". The figures are `totals.income` and `totals.owed`.
- **Progress bar:** filled to income ÷ expected, in forest green. Cap it at 100%.
- **Line 1:** "9 people owe something: **5 paid**, **4 still owe**". The counts come from `people.filter(owed>0)`, split by balance ≤ 0 vs > 0.
- **Line 2:** "By method: **Venmo $105** · PayPal $0 · Cash $0 · Check $0". Always show the four primary methods: Venmo, PayPal, Cash, Check. Add any other method only when it is non-zero (Scout account, Scholarship fund, Bank, Other). Bold the non-zero ones.

**Right part:** four figures, divided from the left part by a hairline.

| Figure | Value | Sub-line |
|---|---|---|
| Still due | `totals.due`, in gold (`admin-accent-gold`) | "from N people"; add "· $X overpaid" when `totals.overpaid > 0` |
| Expenses | `totals.expenses` | "incl. reimbursements paid" |
| To reimburse | `totals.reimbursementsPending` | "pending" |
| Net | `totals.net`, forest when ≥ 0 | "income − expenses − pending" |

- **Net when negative:** keep today's behaviour. The label becomes "Cost to the troop" and the figure shows `|net|` in danger red.
- **Narrow screens:** the band wraps, and the four figures stack under the headline.

### 4. Ledger table ("Who owes what")
- **Columns:** Name · Owes · Paid · Balance · Method · Paid on · Status.
- **Alignment:** money columns right-aligned with tabular figures; Method, Paid on and Status left-aligned.
- **Name:** bold, followed by the existing status/participation chips (e.g. "no", "day only").
- **Owes:**
  - Shows `owed`. Add a `*` when `amountOverride != null`.
  - The footnote under the table reads "* custom amount".
  - Hovering or focusing the `*` shows "Tier <label> $X".
- **Paid:** `paid`, keeping the "$X credited to account" chip.
- **Balance:**
  - "—" when 0. (Today's code leaves it blank; the design shows an em dash.)
  - Positive balances are bold.
  - Overpaid stays red, in parentheses, with a minus sign. This is an existing rule; keep it.
- **Method:** `paymentSummary().methods`, comma-joined, using `METHOD_LABEL`.
- **Paid on:**
  - The last payment date in a new short format: **"Nov 12 '26"**. Add `fmtDateShort()` to `lib/format-date`.
  - Leave it blank when nothing has been paid.
- **Status badge:** keep `standingBadge()` logic and wording. Add two cases:

| Badge | When it shows | Colors |
|---|---|---|
| Paid | settled | success (existing) |
| $X due | balance > 0 | warning (existing) |
| Behind · $X | behind a payment milestone | danger (existing) |
| On schedule | milestones exist and not behind | info (existing) |
| Not going (new) | status `no`, owed 0 | neutral |
| Nothing owed (new) | owed 0 | neutral |

- **Row behaviour:**
  - The whole row is clickable and opens the person panel.
  - The selected row gets the info-tint background (`admin-status-info-bg`) and a 3px navy inset edge on the left.
  - Rows are keyboard-reachable. Up/Down moves the selection while the table has focus. Enter opens the panel; Esc closes it.
  - Each row gets `aria-selected` and a real focus target, e.g. the name as a `<button>`.
  - No action buttons in rows.
- **Totals row (`<tfoot>`):** "11 people" · Owes total · Paid total · Balance total (in gold) · then "5 paid · 4 owe · 2 not paying" across the last three columns.
- **Footnote under the table:** "Click a row, or use ↑ ↓, to open that person. * custom amount. A person paid in parts shows their latest payment."
- **Remove** the long panel hint ("Owed = tier (or a per-person override)…"). The panel and the footnote now carry that information.

### 5. Person panel (right side; stacks under the table below ~1000px)
The panel uses the form-surface background (`admin-form-bg`), with white cards inside it.

**a. Header**
- The person's name, with a × button to close the panel.
- **Status line:** "Owes $20 · paid $20 · **✓ Paid in full**" (forest), or "· **$25 due**" (gold), or "· **($5) overpaid**" (red).

**b. Amount owed card.** The design shows this two ways. Use both: closed when the amount is the tier, open when the amount is custom or not paying.
- **Closed state** (owes the tier): one line, "Owes the tier, **$25**", with a "Change amount" link on the right. The link opens the card.
- **Open state:** a card titled "What <first name> owes", with a segmented control: **Tier $25** | **Custom** | **Not paying**.
  - **Tier:** clears the override (`amount_override = null`).
  - **Custom:**
    - Shows an **Amount** field and a **Reason** field.
    - The hint under them reads "The tier is $25. A custom amount stays put if the tier changes later."
  - **Not paying:** sets the override to 0. Reason is optional.
- **Save button:** dirty-gated, per house rules. It reads **Saved** (disabled) until something changes, then **Save amount**. While saving it reads "Saving changes…", then flashes "Done". Show **Discard changes** beside it while dirty.
- **Validation:** an amount below 0 blocks the save in place ("Can't save yet: Amount must be zero or more").

**c. Record a payment card** (shown when `canRecordPayment(p)`)
- **Amount:** defaults to the balance, editable.
  - When the amount is less than the balance, an info notice appears under the fields: "Part payment: **$10 will still be due**. Pay the full $25". "Pay the full $25" is a link that refills the full balance.
  - When the amount is more than the balance, the notice reads "That's $X more than owed; it will show as overpaid."
- **Paid on:** a date field, defaulting to today. Today's dialog has no date field, so this needs `occurredOn` plumbing; see Technical Approach.
- **Method** segmented control: **Venmo | PayPal | Cash | Check | Other ▾**.
  - "Other ▾" opens Scout account balance, Scholarship fund, Bank transfer and Other.
  - Picking Scout account or Scholarship fund shows the existing `PayFrom` / `PayGuard` UI inline, including the negative-balance acknowledgement.
- **Note:** optional; saved as the transaction memo.
- **Primary button:** names the action, e.g. "Record $15 Venmo payment". It is disabled until the amount is greater than 0, and while the guard is unacknowledged.
- **When the balance is ≤ 0:** the card collapses to the line "Nothing left to pay." with these buttons on the right:
  - **Record a payment:** expands the form for an extra payment.
  - **Refund:** danger outline.
  - **Credit to account:** shown when `uncreditedOverpayment > 0`.
- **Refund and Credit to account** reuse the same card layout with their own titles. They replace the modal dialog.

**d. History**
- Every entry for this person, newest first, as a white list.
- **Each entry:** date (short format) · "Payment $20 · Venmo" or "Refund $20 · Venmo" · sub-line "Recorded by PB". Add "(Smith family account)" when `accountOf` is set, plus the memo if there is one.
- **Live payments and refunds:** a quiet red **Void** on the right. Void asks first: "Void the $20 Venmo payment from Nov 12 '26? It stops counting toward Adam's paid total. Reason (optional): ___".
- **Voided entries:** struck-through, muted, with a neutral "Voided" badge. The sub-line reads "Voided by PB: "<reason>"".
- **Amount changes** (new): "Amount changed $25 → $20" · "Custom · "Sibling discount" · by PB". "Tier → Not paying" and "Custom → Tier" read the same way.
- **Empty state:** "No payments yet."

### 6. Below the ledger (layout unchanged in this plan)
These sections keep their current function. Restyle them only as far as needed so they don't clash:
- **Expenses & reimbursements:** keep the panel and its add row. The header button "+ Add expense" jumps here.
- **Deposit schedule & deadlines:** keep the panel, the milestones, "N behind…" and the reminder email flow.

## Acceptance Criteria

- [ ] The five tiles are replaced by the summary band. Every figure the tiles showed is still visible: income, income by method, expenses (+ pending note), still due (+ overpaid), net / cost to the troop, total expected, and people who owe.
- [ ] The By-method line always lists Venmo, PayPal, Cash and Check; other methods appear only when non-zero.
- [ ] The ledger shows Name, Owes, Paid, Balance, Method, Paid on and Status, plus a totals row, with no per-row action buttons.
- [ ] Paid on renders as "Nov 12 '26"; an empty cell means nothing has been paid.
- [ ] A custom amount shows `*` in Owes, with the tier on hover/focus.
- [ ] Clicking a row, or pressing ↑/↓ then Enter, opens the person panel. Esc closes it, and the selected row is highlighted.
- [ ] In the panel, a leader can switch between Tier, Custom (amount + reason) and Not paying, and save with the dirty-gated Saved / Save amount button.
- [ ] Every override change writes a history entry showing the old amount, the new amount, the reason, who made it and when.
- [ ] Recording a payment defaults to the balance. Lowering the amount shows the "Part payment: $X will still be due" notice.
- [ ] The date field defaults to today; a past date is saved as the transaction's `occurred_on`.
- [ ] The method control offers Venmo, PayPal, Cash and Check directly. Scout account, Scholarship fund, Bank transfer and Other sit under Other ▾, and the existing PayFrom/PayGuard behaviour still works.
- [ ] Refund and Credit to account work from the panel, with the same rules as today.
- [ ] History lists payments, refunds, credits, voids and amount changes newest first, with the actor's sign-off initials.
- [ ] Void asks first, takes an optional reason, and shows "Voided by XX: "reason"".
- [ ] Below ~1000px the panel stacks under the table, and the table scrolls sideways inside its card.
- [ ] The bucket picker still works (popover) and still moves the event's own rows into the bucket.
- [ ] Expenses & reimbursements and Deposit schedule & deadlines behave exactly as before.
- [ ] Finance-only leaders (`finance.manage`) can still use everything on the page.

## Test Plan

- [ ] `Leader_SeesSummaryBand_WithAllOriginalFigures()`: income, by-method, expenses, still due, net and expected all match `summarizeEventMoney`.
- [ ] `Leader_SeesFourPrimaryMethods_WhenOnlyVenmoUsed()`: PayPal, Cash and Check show $0.
- [ ] `Leader_SeesOtherMethod_OnlyWhenNonZero()`: Scout account appears only after one is used.
- [ ] `Leader_SeesCostToTroop_WhenNetNegative()`
- [ ] `Leader_SeesShortPaidOn_WhenPaid()`: "Nov 12 '26"; blank when unpaid.
- [ ] `Leader_OpensPersonPanel_WhenRowClicked()` and `Leader_MovesSelection_WithArrowKeys()`
- [ ] `Leader_SetsCustomAmount_WithReason()`: the override is saved, `*` appears, and a history entry is written.
- [ ] `Leader_ClearsOverride_WhenTierChosen()`: the override is null, and the history reads "Custom → Tier".
- [ ] `Leader_SetsNotPaying_OverrideZero()`
- [ ] `Leader_CannotSaveAmount_WhenNegative()`: the bad field is marked in place.
- [ ] `Leader_SeesSavedDisabled_WhenAmountUnchanged()`
- [ ] `Leader_RecordsPartPayment_BalanceRemains()`: $15 of $25 leaves $10 due, and the notice shows.
- [ ] `Leader_RecordsPayment_WithPastDate()`: `occurred_on` equals the chosen date.
- [ ] `Leader_RecordsPayPalPayment()`: method `paypal`; By-method shows PayPal.
- [ ] `Leader_PaysFromScoutAccount_GuardStillApplies()`
- [ ] `Leader_VoidsPayment_WithReason()`: the entry shows struck through with "Voided by XX".
- [ ] `Leader_Refunds_FromPanel()` and `Leader_CreditsOverpayment_FromPanel()`
- [ ] `FinanceOnlyLeader_CanUseMoneyPanel()`
- [ ] `fmtDateShort_FormatsTwoDigitYear()`: unit test in `lib/format-date`.

## Technical Approach

- **Client components:** split `money-panel.tsx`, which is ~800 lines today, into the following:

| Component | What it holds |
|---|---|
| `MoneySummaryBand` | the summary band |
| `MoneyLedger` | the table, selection and keyboard handling |
| `PersonMoneyPanel` | the panel: amount owed, payment/refund/credit card, history |
| `EventExpensesPanel` | existing code, moved |
| `EventMilestonesPanel` | existing code, moved |

`MoneyPanel` keeps the shared `run()` / `pending` / error state and the selected `entryId`. Reuse `summarizeEventMoney`, `paymentSummary`, `milestoneStanding`, `canRecordPayment`, `uncreditedOverpayment` and `refundAccountDefault` unchanged.
- **Selected person in the URL:** `?person=<entryId>`, so a refresh or a shared link keeps the panel open. Clear the parameter when the panel closes.
- **The modal goes away:** retire the `Dialog` for pay/refund/credit. The same server actions are called from the panel card.
- **Payment date:** add an optional `occurredOn` to `recordEventFeePaymentAction` and `refundEventFeeAction`, defaulting to Central today (`centralToday()`), validated ≥ `EARLIEST_DATE` and not in the future.
- **Override reason + audit (new data):**
  - Add `amount_override_reason text` to `signup_entries`.
  - Add a table `signup_entry_amount_changes`: `id`, `signup_entry_id`, `old_amount`, `new_amount`, `old_mode` (tier/custom/none), `new_mode`, `reason`, `changed_by_person_id`, `changed_at`.
  - `setAmountOverrideAction(entryId, amount, signupId, reason?)` writes the override and the change row together, through one RPC or a transaction.
  - "Not paying" means override = 0. Keep using `status` for "not going".
- **Void reason:** add `void_reason text` to `financial_transactions`. `voidEventFeePaymentAction(id, signupId, reason?)` sets it, alongside the existing `voided_by_person_id`.
- **Who recorded / voided:**
  - `financial_transactions.created_by_person_id` and `voided_by_person_id` already exist. Surface them in `EventMoneyPerson.transactions` as initials, using the sign-off initials from `Plans/Sign-Off-Initials.md`.
  - Merge the amount-change rows into the same history list, sorted by timestamp.
- **Date formatter:** add `fmtDateShort(iso)` → `"Nov 12 '26"`. Use it only in the ledger's Paid on column and the history list. All other dates keep `fmtDate`.
- **Methods:**
  - Add `PRIMARY_PAY_METHODS = ['venmo','paypal','cash','check']` in `lib/event-money.ts`. The segmented control and the By-method line use it. The rest of `PayMethod` sits under Other ▾.
  - Keep one `METHOD_LABEL`. The panel currently has its own copy beside `PAY_METHOD_LABEL`; consolidate them.
- **Layout:**
  - Table and panel sit in a `flex-wrap` row: table `flex: 999 1 640px; min-width: 0`, panel `flex: 1 1 360px; max-width: 420px`.
  - The table sits in an `overflow-x: auto` card.
  - The panel is not sticky.

## Implementation Steps

1. Migration: `signup_entries.amount_override_reason`, the `signup_entry_amount_changes` table (RLS matching `signup_entries`), and `financial_transactions.void_reason`.
2. Server actions: add `occurredOn` to pay and refund; add `reason` to `setAmountOverrideAction` (writing the change row) and to `voidEventFeePaymentAction`; extend `getEventMoneyAction` to return actor initials, the void reason and amount changes per person.
3. `lib`: add `fmtDateShort` and `PRIMARY_PAY_METHODS`, consolidate `METHOD_LABEL`, and add unit tests.
4. Split `money-panel.tsx` into the five components without changing behaviour; check that nothing has regressed.
5. Build `MoneySummaryBand`, replacing the tiles.
6. Build `MoneyLedger`: new columns, totals row, footnote, row selection, keyboard handling, `?person=`.
7. Build `PersonMoneyPanel`: header, Amount owed card (closed/open, dirty-gated save), Record payment card (part-payment notice, date, segmented methods with Other ▾, PayFrom/PayGuard), Refund and Credit cards, History with Void confirm.
8. Move the bucket control into the title-row popover; wire "+ Add expense" to jump to the expense row.
9. Remove the old row buttons, the inline history rows and the pay/refund/credit `Dialog`.
10. Responsive pass at 390px, 900px and 1440px; keyboard and screen-reader pass on the ledger and panel.
11. Write and fill the Test Plan tests; run the suite.

## Open Questions

All answered by Patrick, 2026-11-12:

- [x] **Panel on load:** opens on the first person at the top of the list (no `?person=` → select row 1).
- [x] **Custom amount reason:** optional, never required.
- [x] **Initials:** build `Plans/Sign-Off-Initials.md` first; the history reads `leaders.code`. Check 2026-11-12: the only money-capable person without a code is Kara Pitt-D'Andrea (person 120, `finance.manage`) — give her one through the new control. Anyone still without a code shows as "First L." rather than guessed initials (guesses can collide with real codes such as KP).
- [x] **Method column:** every method used, comma-joined (today's behaviour).
- [x] **Not paying vs Not going:** separate facts, both shown in the ledger. "Not going" comes from status `no`; "Not paying" from override 0. Someone can be both — show both (e.g. the "no" chip on the name and the Not paying badge).

## Notes

- **Design source:** the Claude Design canvas "Event money screen concepts" (link above), artboards "B · Ledger: custom amount and history" and "B · Ledger: recording a part payment". Directions A (triage list) and C (families / bulk pay) are on the same canvas and are not part of this plan. C's family bulk-pay could be a later add-on to the panel ("Also pay for: Lee Pasek $20").
- **Sample history on the Adam Gabbard artboard:** the voided $25 entry, the Nov 10 amount change and the "Sibling discount" reason are illustrative. They are not real data.
- **Related plans:** `Plans/Completed/Event-Logistics.md` §C (original Money tab), `Plans/Completed/Buckets-Lookup.md`, `Plans/Troop-Finances.md`, `Plans/Ledger-Tweaks.md`, `Plans/Sign-Off-Initials.md`.
- **House rules followed:** the Troop 79 design system's leader-workspace palette, sentence case throughout, dirty-gated Save, problems marked in place, segmented controls for 2–4 choices, one primary action per card.
