# Wreath Sale — Release B: card payments through Stripe Checkout

**Status:** Active
**Activated:** 2026-10-15
**Priority:** High (round 1 closes Tue Oct 20, 11:59 PM — moved from Oct 25 in admin on 10/14)
**Supersedes:** Release B "PayPal Checkout" in `Plans/Wreath-Sale.md` (step 4). Venmo / PayPal stay as the
manual, Mark-paid route from Release A.

## Overview

Customers pay for a wreath order by card (plus Apple Pay / Google Pay / Link, which Stripe's dynamic payment
methods add) on a Stripe-hosted Checkout page, right after placing the order or later from the order's receipt
page. A signature-verified webhook marks the order paid and books the money into the finance ledger. Leaders
can refund a card-paid order from admin.

Stripe's implementation planner (2026-10-15, guide `iguide_61VaQdvPQw6sy4B4241GuBP2EMXDp`, account
"Troop 79 sandbox") chose: Stripe only → web browser → physical goods → no invoices → no payment links →
**hosted Checkout** (blueprint "Accept a one-time payment with Checkout"), with Link, dynamic payment methods
and Adaptive Pricing on.

## Decisions (Patrick, 2026-10-15)

| Question | Decision |
|---|---|
| Card fee | **Optional "cover the card fee" box**, the existing `coverFeeFor` rule (`fee_percent` / `fee_fixed` on the sale), shown only with card payment. |
| Ledger | **Gross + fee expense** per order: +total `fundraiser` income and −Stripe fee `expense`, both method `card`, account checking. Bank match pairs the net with Stripe payouts. |
| Refunds | **Refund button in admin**: cancelling a card-paid order offers "Refund $X to the card". |
| Earlier orders | **Pay-by-card button on every unpaid order's receipt page**; no new emails. |
| Order of options | **Venmo / PayPal to the treasurer stay FIRST and are the default** — the no-fee option. Card is the second choice, below them, everywhere it appears (checkout and receipt page). |

## Acceptance Criteria

- [ ] Checkout offers "Venmo / PayPal to the treasurer" FIRST and selected by default (no fee), then "Pay by card" (with the cover-fee box); card goes to Stripe and back to the receipt page.
- [ ] Every unpaid, placed order's receipt page (`/wreaths/order/[token]`) keeps the Venmo / PayPal instructions first and adds a Pay-by-card button below them.
- [ ] The Stripe charge is built only from the order row in the database; the amount Stripe reports must equal the order total or the order is NOT marked paid (flagged in the audit log instead).
- [ ] The webhook rejects any request without a valid Stripe signature, and fails closed (503) when the secret is not configured.
- [ ] A redelivered or duplicate event changes nothing (event-id dedupe + conditional claim).
- [ ] A card payment books exactly one +income row and one −fee row, linked by `wreath_order_id`.
- [ ] Admin refund refunds the card in Stripe and, on `charge.refunded`, marks the order refunded and books the reversal.
- [ ] With no Stripe keys configured the site behaves exactly as Release A (feature off).

## Test Plan

Unit (pure, `tests/wreath-stripe.test.ts`):
- [ ] `Checkout_BuildsLineItemsThatSumToTheOrderTotal` — wreath lines, delivery fee, gift, fee cover.
- [ ] `Checkout_RefusesWhenLineItemsDoNotSumToTheTotal`
- [ ] `Checkout_OmitsPaymentMethodTypes_SoDynamicMethodsApply`
- [ ] `CardLedger_BooksGrossIncomeAndFeeExpense`
- [ ] `CardLedger_BooksRefundAsNegativeIncome_FeeNotReturned`
- [ ] `PaymentCheck_RefusesAmountOrCurrencyMismatch`

DB (`tests/wreath-stripe-db.test.ts`, Stripe client faked at the module edge):
- [ ] `StartCardCheckout_RefusesPaidCancelledOrUnknownOrders`
- [ ] `StartCardCheckout_StoresTheSessionId_AndUpdatesFeeCoverWhileUnpaid`
- [ ] `Webhook_RejectsAMissingOrBadSignature`
- [ ] `Webhook_FailsClosed_WhenTheSecretIsNotConfigured`
- [ ] `Webhook_CompletedSession_MarksPaidOnce_AndBooksTwoLedgerRows`
- [ ] `Webhook_DuplicateEvent_ChangesNothing`
- [ ] `Webhook_AmountMismatch_LeavesUnpaid_AndAudits`
- [ ] `Webhook_ChargeRefunded_MarksRefunded_AndBooksReversal`
- [ ] `RefundCardOrder_RequiresFinanceManage_AndOnlyCardPaidOrders`
- [ ] `MarkPaid_StillWorksForVenmoPayPalCashCheck` (regression)

DOM:
- [ ] `CheckoutForm_ListsVenmoPayPalFirst_AndSelectedByDefault`
- [ ] `CheckoutForm_ShowsCoverFeeOnlyWithCard`
- [ ] `ReceiptPage_ShowsPayByCard_OnlyWhenUnpaidAndPlaced`

## Technical Approach

- **Package:** official `stripe` Node SDK, pinned to the version OMG runs (^22, apiVersion `2026-03-25.dahlia`).
  Server-only module `lib/wreaths/stripe.ts` (client factory, faked in tests). Env: `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET`; `cardCheckoutLive()` = both present (replaces the `PAYPAL_CHECKOUT_LIVE` constant).
- **Schema (DB-first, one additive migration):**
  - `wreath_orders`: `stripe_session_id`, `stripe_payment_intent_id` (unique), `stripe_fee`, `refunded_at`;
    `paid_method` CHECK gains `card`.
  - `financial_transactions.method` CHECK gains `card` (lockstep with `lib/finance.ts TRANSACTION_METHODS`).
  - `stripe_events (id text primary key, type, received_at)` — webhook dedupe; RLS on, service role only.
  - The live-row unique index on `wreath_order_id` (v1.223.0) becomes unique per (order, kind-of-row) so an
    income row and a fee row can coexist — e.g. a `ledger_role` column ('payment' | 'fee' | 'refund').
- **Start checkout** (server action, by `public_token`, no sign-in): order must be `placed` + `unpaid`; recompute
  the fee cover server-side and update `fee_covered` / `total` while unpaid; build `line_items` with
  `price_data` from the order lines (no Stripe Products per order); assert they sum to `total`;
  `client_reference_id` = order id, metadata = order id + number; `customer_email`; idempotency key =
  order id + total; success → `/wreaths/order/<token>?card=return`, cancel → same page. Store
  `stripe_session_id`. No `payment_method_types` (dynamic methods).
- **Webhook** `src/app/api/stripe/webhook/route.ts`: raw body + `constructEvent`, always; 503 when the secret is
  missing. Insert `stripe_events.id` on conflict do nothing → already seen = 200. Events:
  `checkout.session.completed` (only when `payment_status = 'paid'`), `checkout.session.async_payment_succeeded`,
  `checkout.session.async_payment_failed` / `expired` (clear the session id), `charge.refunded`.
  Paid path: verify `amount_total` = `toCents(total)` and currency `usd`; fee from the PaymentIntent's
  `latest_charge.balance_transaction.fee`; then the shared payment recorder.
- **One payment recorder:** extract the claim + ledger + audit body of `markPaid` into
  `lib/wreaths/record-payment.ts`, used by Mark paid (Venmo/PayPal/cash/check/other, actor = treasurer) and by the
  webhook (card, actor = system, plus the fee row). Same once-only claim.
- **Refund:** admin action `refundCardOrder` → `stripe.refunds.create({ payment_intent }, { idempotencyKey })` and
  cancel the order; the `charge.refunded` webhook records `refunded_at`, `payment_status = 'refunded'` and the
  −income row (Stripe does not return the fee, so the fee row stays).
- **Receipt page:** after return, shows "Payment received" once the webhook lands, else "Confirming your
  payment…" with a refresh (no client polling loop needed beyond a short meta refresh).
- **Stripe Dashboard setup (Patrick):** webhook endpoint `https://www.troop-79.com/api/stripe/webhook` with the
  six events (checkout.session.completed / async_payment_succeeded / async_payment_failed / expired,
  charge.refunded, charge.updated); turn on customer email receipts; branding (troop name/logo); confirm Link + dynamic payment
  methods are on.

## Review changes (tech-lead GO-WITH-CHANGES + qa-lead CONDITIONAL, 2026-10-15) — binding

1. **Ledger role:** `financial_transactions.ledger_role text not null default 'payment' check in ('payment','fee','refund')`;
   replace the v1.223 live-row index with unique `(wreath_order_id, ledger_role) where wreath_order_id is not null and voided_at is null`.
2. **Refunds:** one refund row per order — mark refunded and book the reversal only when `amount_refunded = total`;
   a partial or Dashboard-initiated refund is audited and books nothing.
3. **Method types:** `card` joins `TRANSACTION_METHODS` and the `paid_method` CHECK but NOT `PAID_METHODS` (the treasurer
   can't "mark paid by card"); separate `PaymentMethod` type for the recorder; `METHOD_LABEL.card`.
4. **Recorder:** `requireCapability` stays in `markPaid`; recorder takes `actorPersonId | null`, `collectedByScout` as a
   parameter (false for card); the fee row is booked idempotently on its own and never reverts a paid order (fee may
   arrive late; failure to fetch it books income now and the fee on a later event).
5. **Webhook dedupe:** the `stripe_events` row is written only AFTER the handler succeeds (the conditional claim is the
   real guard); any ledger/claim failure returns 500 so Stripe retries. `runtime = 'nodejs'`, `request.text()`;
   `proxy.ts` matches only `/admin/:path*`, so the route is not gated (test it).
6. **Open sessions:** reprice / reassign / cancel / Mark paid / fee-cover change / `wreath_replace_order` all expire the
   open Checkout Session (`checkout.sessions.expire`) and clear `stripe_session_id` first. A card payment that lands on
   a cancelled order, an already-paid order (lost claim), or with a mismatched amount sets `needs_refund` (new column)
   and audits — shown to the treasurer in admin with the refund button.
7. **Flag:** `cardCheckoutLive()` computed on the server and passed to `checkout-form` as a prop; no env logic in client
   modules, no `NEXT_PUBLIC_*`; the start action checks it too.
8. **Refund order:** `refundCardOrder` calls Stripe first, then cancels; `finance.manage`; card-paid orders only; amount
   from the DB.
9. **Start action hardening:** DB-counted rate limits per token / IP / global (as `place-order.ts`); fee cover
   recomputed from `items_subtotal + delivery_fee + gift`; idempotency key = order id + hash of the line items; the
   token is a bearer credential — receipt page sends `Referrer-Policy: no-referrer`.
10. **PII / secrets:** only `customer_email` goes to Stripe (no name/address/phone in metadata or descriptions);
    `lib/wreaths/stripe.ts` is `server-only`; never log raw event bodies. **Adaptive Pricing OFF** (USD only, so
    `amount_total` always compares in USD).

Added tests: `Reprice_ExpiresOpenSession`, `Cancel_ExpiresOpenSession`, `MarkPaid_ExpiresOpenSession`,
`Webhook_PaidOnCancelledOrder_FlagsRefund`, `Webhook_LostClaimAfterMarkPaid_FlagsRefund`,
`Webhook_HandlerFailure_Returns5xx_AndRetryProcesses`, `Webhook_RefundedEvent_ForUnknownIntent_IsNoOp`,
`Webhook_PartialRefund_AuditsOnly`, `StartCheckout_RateLimited`, `Refund_Repeat_IsIdempotent`,
`Webhook_ProxyDoesNotGate_ApiRoute`, `MarkPaid_RefusesCardMethod`, `StripeModule_IsServerOnly`.

### Implementation review (qa-lead SHIP-AFTER-FIXES, 2026-10-16) — fixed

- Stray card payments (on a cancelled order, an already-paid order, a second card payment, or the wrong amount) are
  queued in `wreath_card_refunds_due`; the refund button returns exactly those, never the order's own payment.
- The card fee cover drops when its session expires unpaid and when the treasurer marks paid another way; the
  receipt's Venmo / PayPal amount never includes it.
- Session save re-checks `status = 'placed'`; the webhook checks the session's metadata matches the order.
- Per-IP (20/h) and global (300/h) limits on session creation (`wreath_checkout_starts`); refund idempotency key is
  per PaymentIntent.

## Implementation Steps

1. Governance: tech-lead (schema, recorder extraction, route), qa-lead (webhook threat model).
2. Migration + `lib/finance.ts` method lockstep + shared payment recorder (Mark paid regression green).
3. `lib/wreaths/stripe.ts` + pure line-item / ledger / payment-check functions (unit tests).
4. Start-checkout action + checkout-form card choice + receipt-page Pay-by-card.
5. Webhook route (DB tests with faked Stripe), then Stripe CLI end-to-end against the sandbox locally.
6. Admin refund + cancel dialog; admin order list shows "Card" and the Stripe fee.
7. Patrick: Dashboard webhook + Vercel env (test keys first, then live keys when the account is verified).

## Open Questions

- [ ] Live Stripe account verification status (only the sandbox is connected today).
- [ ] Payment-received email from us, or rely on Stripe's receipt email? (Plan: Stripe's receipt.)

## Notes

- Do NOT copy from OMG: its webhook accepts unsigned events when `STRIPE_WEBHOOK_SECRET` is unset, trusts the
  client's total and card fee, never checks `amount_total`, and has no event dedupe.
- Venmo/PayPal (Release A) stay; their Mark-paid ledger row is v1.223.0.
