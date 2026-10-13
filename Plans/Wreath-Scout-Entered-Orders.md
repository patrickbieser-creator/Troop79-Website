# Wreath Sale — scout-entered orders ("My customer" mode)

**Status:** Active — prototype next (Brad, `prototypes/wreath-sale/`)
**Created:** 2026-10-13
**Priority:** High (round 1 cutoff Sun Oct 25, 2026)
**Part of:** `Plans/Wreath-Sale.md` Release C ("paper-order entry"), pulled forward on its own.

## Overview

Scouts sell to people they know and need to enter those orders on the website under their own name. Reuse the
scout's own store page (`/wreaths/<first>-<initial>`): when the signed-in viewer is that scout, or a parent in the
scout's household, a switch turns checkout into a short "my customer" form. There are no address fields, no fees and
no Venmo/PayPal instructions, and the scout collects the money.

## Decisions (Patrick, 2026-10-13)

| Question | Answer |
|---|---|
| Approach | **A:** a mode on the scout's own page, with the same product grid and cart. No separate quick-entry sheet for now. |
| Customer name | **Required**, one short field ("Grandma Sue"). Address, email and phone are optional. |
| Who can use it | Only someone signed in as **that scout or a parent in the scout's household**. The public link never offers it. |
| Money state | The scout records "collected from the customer"; the treasurer marks **Paid** when the troop has the money. |
| Turning money in | No turn-in workflow. Scouts pay the troop in many ways, so the order's paid flag stays binary, plus a free-text **payment note** ("Venmo'd Patrick 10/20", "cash at the 10/18 meeting") to settle confusion later. |
| Email | The customer gets **no email**. The person who entered the order (scout or parent) gets a confirmation. |
| Confirmation copies | The person signed in gets the confirmation; when a scout entered the order, the household's parents are copied. |
| Cancel | A scout or parent may cancel their own entered order until its round's cutoff; it stays visible in admin as Cancelled. |
| Donations | Donated wreaths **and** the cash gift are both available in this mode (Patrick overrode Brad's "no gift"). |
| Delivery list | The customer's name alone is enough; no address. |
| Paid vs collected | The treasurer may mark an order Paid even when the scout hasn't marked it collected (money came another way); Paid also sets collected. |
| Order notes | Keep both optional per-order fields: the order **Note** (e.g. delivery instructions) and the **Payment note**. |
| Scout's page message | **Dropped** from the public scout page (the quote such as "I'm saving for Philmont"). The DB columns stay. |
| Goal thermometer | **Added:** "N of G wreaths toward <first>'s goal" on the scout's public page and on Members › Wreath sale, only when a goal is set. It counts items in non-cancelled orders credited to the scout. Admin sets the goal on Sellers; the family can set it on Members › Wreath sale. |
| Delivery message | **Added:** a per-seller `delivery_message` (≤200 chars) shown on the scout's public page in place of the standard "<First> delivers your order in person…" line when set. No approval step. |
| Who edits goal + delivery message | Admin on Sellers (finance.manage), **and** the scout or a parent in their household on Members › Wreath sale. |
| After Paid | A Paid order is locked for the scout and parent; any later change is handled manually by a leader. |

## Acceptance Criteria

- [ ] On `/wreaths/<slug>`, a signed-in scout (or parent in their household) sees "Order for someone I know — I'll collect the money". Anyone else, including a signed-out visitor, never sees it.
- [ ] With the mode on, checkout asks for customer name (required), optional phone, email and note, and whether the money is collected yet. It shows no address, delivery choice, delivery fee, card fee or payment instructions.
- [ ] The order saves with `source = 'paper'`, `fulfillment = 'scout'`, credited to that scout, no delivery or card fee, and `entered_by_person_id` = the signed-in person.
- [ ] The server action re-checks the viewer's right to that scout; a forged form field cannot enter orders for another scout.
- [ ] No email goes to the customer. The person who entered it gets a confirmation email.
- [ ] Members › Wreath sale lists the order; the scout or parent can edit it (items, customer, collected yes/no, payment note) until the round's cutoff.
- [ ] Admin › Wreath Sale › Orders shows scout-entered orders with "Collected by scout" and the payment note; the treasurer's Paid toggle and note work as for other orders.
- [ ] After a round's cutoff, new scout-entered orders for that round are refused, as on the public store.

## Test Plan

- [ ] `ScoutOrderMode_IsOffered_WhenTheViewerIsTheScout()`
- [ ] `ScoutOrderMode_IsOffered_WhenTheViewerIsAParentInTheScoutsHousehold()`
- [ ] `ScoutOrderMode_IsNotOffered_ToASignedOutVisitor()`
- [ ] `ScoutOrderMode_IsNotOffered_ToAnotherFamily()`
- [ ] `PlaceScoutOrder_Refuses_WhenTheViewerHasNoRightToTheScout()`
- [ ] `PlaceScoutOrder_RequiresACustomerName()`
- [ ] `PlaceScoutOrder_ChargesNoDeliveryOrCardFee()`
- [ ] `PlaceScoutOrder_SavesAsPaperScoutFulfilled()`
- [ ] `PlaceScoutOrder_EmailsTheEnterer_AndNotTheCustomer()`
- [ ] `PlaceScoutOrder_Refuses_AfterTheRoundCutoff()`
- [ ] `EditScoutOrder_Refuses_AfterTheRoundCutoff()`
- [ ] `AdminOrders_ShowsCollectedByScoutAndThePaymentNote()`

## Technical Approach (TBD after prototype; tech-lead to confirm)

- Schema (DB-first, additive): `wreath_orders.collected_by_scout boolean not null default false`, `payment_note text`,
  `entered_by_person_id bigint references people(id)`. Paid stays `payment_status`.
- Viewer rights: reuse the Members identity (`lib/member-viewer.ts` / household resolution) to decide "this viewer may
  sell as this scout". Leaders proxying are read-only, so they get no mode.
- Order placement: a sibling of `lib/wreaths/place-order.ts` (or a mode flag on it) with its own validation in
  `checkout-validate.ts`; same idempotency key and round/cutoff logic.
- Edit: Members › Wreath sale (`(public)/member/wreaths/`) gains edit for `source = 'paper'` orders the viewer entered or owns.

## Open Questions

All answered 2026-10-13 (see Decisions). Builder notes from Brad's prototype review:
- "Cutoff" = the order's own round cutoff: an order placed in round 1 locks at the round 1 cutoff (Oct 25); a new order after that is a round 2 order.
- Cancelled orders must stay out of totals, seller stats and the Rose order (check the existing cancel handling).
- Scout-share posting at close (Release C) happens regardless of collected/paid; not in scope here.

Prototype: `prototypes/wreath-sale/{scout-entry,my-orders-entry,admin-orders-entry}.html` (Brad, 2026-10-13).

## Notes

- Existing pieces: `source` already allows `'paper'`; `fulfillment` allows `'scout'`; `paid_method` exists.
- Key files: `src/app/(public)/wreaths/_components/{store-page,store-view,checkout-form}.tsx`, `src/lib/wreaths/{place-order,checkout-validate,emails,my-orders,admin-data}.ts`, `src/app/(public)/member/wreaths/`.
- Existing prototype set: `prototypes/wreath-sale/{scout,checkout,my-orders,admin}.html`.
