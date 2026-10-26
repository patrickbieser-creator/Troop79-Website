# Wreath Sale — online store, scout pages, and the sale's books

**Status:** ACTIVE — Release A building (2026-10-12)
**Parked:** 2026-10-12
**Priority:** High (the sale is seasonal: round 1 must open by early November to be worth building)

## Overview

An online store for the troop's annual Christmas wreath sale, plus the admin to run it. The
general store is at `/wreaths`. Every scout gets a personal link, `/wreaths/<first-name-last-initial>`,
which opens the same store with the sale credited to that scout. Customers see a photo, size and
price for each of the 19 Rose items, add them to a cart, choose how the wreaths reach them, and
pay online through PayPal Checkout (cards, PayPal and Venmo in one button). Scouts and parents
can also enter orders taken in person. The site **replaces the Google Sheet** as the books:
per-scout counts, Amt Paid/Due, the order to Rose (two rounds), the cost and profit, and the
70/30 split. When the sale closes, each scout's 30% goes into their scout account.

Source of the current process:
[2026 wreath sheet](https://docs.google.com/spreadsheets/d/1IpJ1VTsCc-WKqs3sofeibLk5nlIU5DOxq9AKZfhb9qM/edit?gid=866415686).

## Problem / Opportunity

Today every order is on paper, rolled up into a sheet by hand. Customers can't see what they're
buying, nobody can pay ahead, and scouts can't share a link with relatives out of town (who can
still order a wreath to donate, or to be delivered to family here). The sheet's own columns
(Amt Paid, Amt Due, Payment Methods, Check = OK) show the hard part is reconciling money,
which online prepayment mostly removes. `/member` already advertises "Wreath sale: your orders, totals,
and what's owed" as coming soon.

## Decisions taken (Patrick, 2026-10-12)

| Topic | Decision |
|---|---|
| Payment | Pay online at checkout, through **PayPal Checkout** (cards + PayPal + Venmo). Orders scouts enter themselves may be marked cash/check instead. |
| Fulfillment | Three ways. **Scout-link orders: the scout delivers, always.** General-store orders choose **pickup** (set place/time) or **troop delivery** (named zip codes only). |
| Scout link | Personal link per scout: first name + last initial, no photo, no surname (youth protection). |
| The sheet | **The site replaces it.** Admin carries orders, payment status, the Rose order, cost/profit, and the split. |
| Donations | **Both:** "Donate a wreath" (the troop gives it away) and "Add a gift to Troop 79" (cash). |
| Donation credit | A donated wreath is a sale: the scout gets their 30% of its profit. A cash gift goes 100% to the troop. |
| Deadline | **Two rounds**, matching the sheet's "Initial order to Rose" and "Changes" rows: round 1 cutoff → main Rose order; round 2 cutoff → top-up order; then the store closes. |
| Paper orders | A signed-in scout or parent enters orders they took in person, credited to that scout. |
| Photos | Rose's catalog images, one per item. |
| Scout extras | Personal goal + progress bar, a members-only leaderboard, a personal message on their page, and a live "My wreath orders" view. |
| Cutoffs (2026-10-12) | **Round 1: Sunday, October 25, 2026. Round 2: Sunday, November 15, 2026.** Both end of day, Central time. |
| Delivery area (2026-10-12) | **Any zip starting with 532.** Applies to troop delivery and to scout delivery. A scout-link order outside 532 is allowed only when the customer ticks "I am a relative, and [scout first name] has agreed to deliver to me". General-store delivery outside 532 is not offered; pickup is. |
| Processing fee (2026-10-12) | Checkout offers "Cover the processing fee", shown with its dollar amount and **unticked** by default. The troop absorbs the fee otherwise. The PayPal account doesn't exist yet; the troop is setting it up. |
| Sales tax (2026-10-12) | Exempt; checkout adds no tax. |
| The 30% (2026-10-12) | Confirmed: 30% of **profit** (sell price − unit cost), per scout-credited line. |
| Sellers (2026-10-12) | Drop "Maya ST". More names will come, so admin gets a **Sellers** screen: add a seller from the roster (or add a new person to the roster first), set or clear their slug, and retire a seller. "UnAccounted For" becomes the troop bucket (credited scout = none). "Anjali" stays a normal seller. |
| Donated wreaths (2026-10-12) | They go to **veterans**; "Donated to veterans" is enough wording for now, with the recipient to be named later in the page copy. |
| Rose (2026-10-12) | Permission to use Rose's catalog photos and descriptions online: granted. |
| Who holds the money (2026-10-12) | Every payment taken through the website goes to the **troop's** account. A scout-link order is *credited* to the scout (for their 30% share) but never paid to the scout. **General-store orders are credited to the troop only**, so the store has no "Buying from a scout?" picker (this supersedes the picker described below). |
| After the cutoff (2026-10-12) | A customer who had checkout open when a cutoff passed can still finish paying. The cutoff stops new carts, not a checkout already in progress. |
| Credit and reassignment (2026-10-12) | If two scout links are opened in one browser, the last link opened gets the credit. Admin › Orders can **reassign an order's credit and delivery** between scouts, or between a scout and the troop. A scout who volunteers to deliver a troop order can be given its credit (their 30% then applies). Every reassignment is audited. |
| Books (2026-10-12) | Patrick is the treasurer; the Paid/Due columns including gifts and fees while Sale doesn't is fine as labeled. |
| Prototype (2026-10-12) | **Approved** as the design: `prototypes/wreath-sale/`. |
| Optional scout credit at checkout (2026-10-12, supersedes "general store credited to the troop only") | General-store checkout gets a quiet, optional **"Know a scout in Troop 79? Give them credit"**: collapsed by default, the order goes to the troop unless the customer opens it and picks a scout by typing their first name (matches show as first name + last initial, at least 2 letters typed; no full list on the page). Credit only: the customer still chooses pickup or troop delivery, and the scout is **not** expected to deliver (unlike a scout-link order). Not shown on a scout-link checkout. |
| Link not found (2026-10-12) | A link that matches no active seller says so kindly: "We couldn't find a scout with that link." It suggests checking the spelling and points to the optional credit at checkout. Unknown and retired links still read the same. Live testing until 2026-10-13: the committee places test orders on production, and they are all deleted before the store opens to the public. |
| Release A payment (2026-10-12) | The store opens **before** PayPal Checkout exists. Online orders pay **Patrick (treasurer) directly**, the same way as the rummage sale: Venmo **@Patrick-Bieser-1** (`https://venmo.com/u/Patrick-Bieser-1`) or PayPal to **patrickbieser@gmail.com** ("Friends and family"; the payment shows as Patrick Bieser, an assistant scoutmaster). The confirmation page and email show the amount and ask for the order number in the payment note. The order stays **unpaid** until the treasurer marks it paid in admin; the existing Bank Match helps. Paper orders: cash or check to the scout. Don't show the Venmo QR image publicly (it carries a family photo); links and handles only. |
| Distribution (2026-10-12) | **Saturday, November 21, 2026, 2:30–4:30 PM, Northwoods parking lot, 1572 East Capitol.** Rose delivers the same day (the troop picks up at noon; ready by about 2:30). Scouts collect their delivery orders there; pickup customers come in that window; troop deliveries go out from there. |
| Delivery fee (2026-10-12) | **$5 on a troop-delivery order under $50; free at $50 and over** (the delivered items' subtotal: donated wreaths are never delivered; before gifts and fees). Scout-delivered orders carry no fee. |
| Donated wreaths (2026-10-12) | Only the smaller wreaths can be donated: **20″ and 26″** (items 1 and 2), as in the prototype. |
| Defaults (2026-10-12, all confirmed) | Cancellations and refunds until the round's cutoff, none after; Easel and Door Hanger sold alone; all 19 items orderable in round 2; a leader approves each scout's message; slugs are first name + last initial (`oliver-k`, `oliver-v`); confirmation reply-to bsatroop79bg@gmail.com; item descriptions are drafts, editable in admin. |

## What customers see (best practices from other troops' sales)

- **Clear deadline at the top:** "Order by Sunday, Oct 25" (round 1), then the round-2 date. After the
  final cutoff the store says when next year's sale opens, and the scout pages say "Sales are closed".
- **Who you're supporting:** a scout link greets with "You're ordering from Ben B." and the
  scout's message and goal bar. The general store has no scout picker: its orders are the troop's
  (Decisions). A customer who lost a scout's link is fixed in admin by Reassign.
- **Where the money goes:** a short plain-English block on every page. Every wreath funds the
  troop's camping, gear and program, and 30% of the profit goes into the selling scout's own
  account for camp fees and high-adventure trips. Copy is edited at Admin › Pages (site_pages),
  not in JSX.
- **Product cards:** photo, name, size, price, and one honest line about what's included (bows
  come unattached on large wreaths; the stand is not included; and so on). Rose's catalog
  numbers stay in admin only.
- **Cart and checkout:** a plain list with quantities and totals, the fulfillment choice (pickup:
  date, place and window; delivery: a zip check up front, with a clear "we can't deliver to that
  zip, choose pickup" message), contact details (name, email, phone; an address only for
  delivery), the optional donations, then the PayPal button. A confirmation page and a
  confirmation email that the customer keeps.
- **No shipping, no accounts for customers.** Guest checkout only.

## Acceptance Criteria

- [ ] `/wreaths` lists the active sale's items with photo, size, price and description; a sold-out or retired item can't be added.
- [ ] `/wreaths/<scout-slug>` credits every order to that scout and offers only scout delivery; an unknown or inactive slug falls back to the general store, never a 404 that loses the customer.
- [ ] A customer can pay with card, PayPal or Venmo; the order is **paid** only when the server has captured the payment with PayPal. A client "success" alone never marks it paid.
- [ ] General-store orders choose pickup or delivery; delivery is refused, with a reason, for a zip that doesn't start with 532.
- [ ] A scout-link order outside 532 goes through only with the "I am a relative, and [scout] has agreed to deliver to me" box ticked; the scout's order list flags it.
- [ ] "Cover the processing fee" adds the stated amount to the PayPal total; leaving it unticked charges the cart total only.
- [ ] Admin › Orders reassigns an order's credit and delivery (scout ↔ scout, scout ↔ troop); the books and both scouts' "My wreath orders" follow at once, and the change is audited.
- [ ] A checkout started before a cutoff can still be paid after it; a new cart after the cutoff can't be started.
- [ ] Admin › Sellers adds a seller from the roster, gives them a slug, and retires them; a retired seller's link falls back to the general store.
- [ ] Donated wreaths and cash gifts can both be added; a donated wreath counts toward the scout's sales and 30% share, and a cash gift does not.
- [ ] A signed-in scout or parent can enter an in-person order for that scout only, marked cash, check or unpaid, and edit it until the round's cutoff.
- [ ] After a round's cutoff the store and the paper-order entry refuse new orders for that round; admin shows the round's Rose order (count per catalog number).
- [ ] Admin shows, per scout: items, total sale, paid, due, and payment methods; plus the troop totals, cost (from per-item cost), gross profit, the 70% troop share, the 30% scout shares, and a check row (the sheet's "OK").
- [ ] Closing the sale posts one ledger entry per scout (the 30% of profit) to their scout account, once. Re-running it posts nothing new.
- [ ] A scout's "My wreath orders" shows their orders, who has paid, a printable delivery list for distribution day, and their earnings so far.
- [ ] The leaderboard is visible only to signed-in members.
- [ ] The confirmation email goes to the customer, and the scout (or their parent) gets a "new order" note.

## Test Plan

- [ ] `Customer_CanOrderFromScoutLink_CreditsThatScout()`
- [ ] `Customer_SeesGeneralStore_WhenScoutSlugUnknown()`
- [ ] `Customer_CannotChooseDelivery_WhenZipNotInList()`. 53211 passes; 53012 and 60601 fail.
- [ ] `Relative_CanOrderOutsideArea_FromScoutLink_WhenBoxTicked()` / `Customer_CannotOrderOutsideArea_FromGeneralStore()`
- [ ] `CoverFee_AddsFeeToTotal_OnlyWhenTicked()`
- [ ] `Leader_CanAddAndRetireSeller()` / `RetiredSellerLink_FallsBackToStore()`
- [ ] `Order_IsPaid_OnlyAfterServerCapture()`. A forged client success or a replayed capture id leaves it unpaid.
- [ ] `Order_PriceComesFromServer_NotClient()`. A tampered cart price is ignored.
- [ ] `Store_RefusesOrders_AfterFinalCutoff()` / `PaperEntry_RefusesOrders_AfterRoundCutoff()`
- [ ] `Parent_CanEnterPaperOrder_OnlyForOwnScout()`
- [ ] `DonatedWreath_CountsTowardScoutShare()` / `CashGift_IsAllTroop()`
- [ ] `SaleBooks_MatchSheetMath()`. Fixture from the 2026 sheet: cost each, sell price, 70/30 on profit; troop-store profit is 100% troop.
- [ ] `RoseOrder_SumsRoundOne_ThenRoundTwoAsChanges()`
- [ ] `CloseSale_PostsScoutShares_Once()`. Running it twice is idempotent.
- [ ] `Leaderboard_IsHidden_FromAnonymous()`
- [ ] `CatchAll_ReservesWreathsSlug()`. Extends the existing reserved-slug guard test for `(public)/[...slug]`.

## Technical Approach

- **Data (new tables; RLS on, service-role only, per the security posture):**
  - `wreath_sales`: year, status (draft / open / round2 / closed), round-1 and round-2 cutoffs, pickup details, the delivery zip prefix (`532`), delivery fee (if any), the processing-fee formula, and the split percentage (30).
  - `wreath_sellers`: sale_id, scout (a people/scouts row), slug, active. This is the Sellers admin; it is seeded from the 2026 sheet, minus "Maya ST" and "UnAccounted For".
  - `wreath_items`: sale_id, catalog number, name, size, description, price, unit cost, image (Bunny), sort order, active.
  - `wreath_orders`: sale_id, credited scout (null = troop), source (scout link / store / paper), fulfillment (scout / pickup / delivery), customer name, email, phone and address, round, payment status and method, PayPal order and capture ids, the amounts, and a status (placed / delivered / cancelled / refunded).
  - `wreath_order_lines`: order_id, item_id, quantity, donated flag; price and cost snapshotted at order time.
  - Cash gifts are an amount on the order, not a line.
  - Scout goal and message: goal, message and approved_at on `wreath_sellers`. Whether a leader approves the message is still open.
  - Orders also store `outside_area_relative` (the ticked box) and `fee_covered` (amount).
- **Prices live on the server.** The cart sends item ids and quantities; the server prices it,
  creates the PayPal order, and captures it in a server action. A PayPal webhook
  (`PAYMENT.CAPTURE.COMPLETED`, signature-verified) is the backstop for a closed tab.
- **Money into the existing books:** online payments land in the PayPal account and get matched
  through the existing Ledger Audit + Bank Match. At close (Release C), scout shares post to
  **`financial_transactions`** (account `scout_account`, kind `fundraiser`, `person_id` required;
  `finance_core.sql:22-59`), which is what the Scout Account page reads; a unique key on the
  sale makes the posting once-only. Not `ledger_entries` (tech-lead, 2026-10-12). Release B also
  needs `paypal` added to that table's method CHECK.
- **Reuse:** public design system (PageShell, card, form kit, NumberBox, Button, Notice); the
  Save-button and edit-screen standards on admin; `lib/format-date` for every date; Resend for
  email (the signup-confirmation pattern); Bunny for images; the content-managed Pages for the
  "where the money goes" copy; Verified Signup / family sign-in for paper-order entry.
- **Routes:** `(public)/wreaths/page.tsx`, `(public)/wreaths/[seller]/page.tsx`, the cart and checkout as a
  client island; `/member/wreaths` (my orders, delivery list, goal and message);
  `/admin/finance/wreaths` under the existing Finance nav section (`finance.manage`), with
  sub-tabs Settings, Items, Sellers, Orders and Rose order (Books and Close in Release C).
  The confirmation page is `/wreaths/order/[token]`. Add `wreaths` to `RESERVED_TOP_LEVEL`
  (`lib/site-pages-tree.ts:69`).
- **Privacy:** a scout page shows only the first name and last initial. The customer's address
  and phone are seen only by the delivering scout's family and leaders. The leaderboard is members only.

## Implementation Steps

1. Governance pass: tech-lead (data model and routes), troop79-specialist (ledger and scout-account fit), qa-lead (PayPal capture and webhook threat model). Jenna on the store flow; Brad prototypes the store and scout page against Rose's photos.
2. Schema plus admin: sale settings, item catalog (seeded from the 2026 sheet: 19 items with price and cost), image upload.
3. Public store and scout pages, with cart and checkout (unpaid orders only, behind a feature flag).
4. PayPal Checkout: sandbox first, server capture, webhook, refunds from admin.
5. Paper-order entry plus "My wreath orders" (including the delivery list print), goal, message and leaderboard.
6. Admin books: per-scout rollup, Rose order by round, cost/profit, the 70/30 split, cutoffs; close-sale posting to scout accounts.
7. Emails, the "where the money goes" page copy, the /member card going live; a dry run with two test scouts (Charlie Walters is the test scout); then open round 1.

### Timeline (round 1 closes October 25: 13 days from planning)

- **Release A, by about October 16:** steps 2, 3, the Sellers admin, and a minimal Orders admin (list, mark paid, reassign, the Rose order count). The store and scout links go live and take orders paid to the treasurer by Venmo or PayPal (see Decisions), marked paid by hand. The Rose order for round 1 comes out of admin on the 25th.
- **Release B, when the PayPal account is live:** step 4. New orders pay online; earlier unpaid orders get a "Pay now" link in a reminder email.
- **Release C, before November 15:** steps 5 and 6. Paper-order entry, "My wreath orders", goals and the leaderboard, the books, round 2, and close-sale.

Steps 2–4 are the minimum to sell online. Steps 5–6 replace the sheet. If time runs short, the
sheet can carry this year's books with a CSV export from step 3.

## Open Questions

Answered 2026-10-12: cutoffs, delivery area, the fee option, sales tax, the 30%, sellers, donated wreaths, Rose's permission (see Decisions taken).

- [ ] **Rose's website or catalog file:** the URL or PDF for the photos and descriptions; it couldn't be found by search. Item 15 "Easel" and 16 "Door Hanger": sold alone, or only as add-ons?
- [ ] **PayPal account:** being set up by the troop. It should be in the troop's or chartered organization's name (with an EIN), with the nonprofit rate requested. Until it's live, the store can take orders marked "pay your scout" (see Timeline).
- [ ] **Distribution:** the date Rose delivers to the troop, distribution day, pickup place and time window; who delivers troop-store orders (a leader, or assigned scouts); any delivery fee?
- [ ] **Refunds and cancellations:** allowed until the round's cutoff? After that, no refunds (the wreaths are ordered)?
- [ ] **Scout messages:** does a leader approve each message before it goes public?
- [ ] **Round 2:** are all 19 items still orderable, or only what Rose can top up?

## Notes

- Sheet facts (2026): items 1–16 and 20–22; prices $5–$76; 2026 unit costs; profit per item from $0.95 (Door Hanger) to $19.95 (27" Tree); a Rose invoice of $6,533.99 is recorded; costs up 1–7% on 2025.
- Patterns from other troops' online sales: [Troop 469 product sheet and turn-in dates](https://docs.google.com/document/d/1bOTNvAQD7PL4SWY_lxThx6J5WbgPooo-/export?format=pdf), [St. Margaret of Scotland delivery zips and pickup](https://www.stmargaretstl.org/?p=94903), [Verona Pack 32 card-only, cover-the-fee option](https://myveronanj.com/2020/10/10/cub-scouts-to-hold-online-wreath-sale/), [Ozaukee troop's virtual sale](https://www.ozaukeepress.com/node/95375).
- Related: `Plans/Troop-Finances.md`, Ledger Audit + Bank Match (v1.132.0), Scout Account page, `/member` "Wreath sale" card, the Content-Managed Pages catch-all's reserved slugs.

## Release A build spec (reviews 2026-10-12: tech-lead GO-WITH-CHANGES, qa-lead CONDITIONAL, troop79-specialist)

This section is authoritative for Release A. Where it differs from Technical Approach above, it wins.

### Schema (one additive migration; RLS on, zero policies, service role only)
- `wreath_sales`: year (unique), status check (draft/open/closed), `round1_cutoff`, `round2_cutoff` (timestamptz, end of day Central), distribution date/window/place text, `delivery_zip_prefix` ('532'), `delivery_fee` (5.00), `delivery_free_at` (50.00), `fee_percent` (1.99), `fee_fixed` (0.49), `scout_share` (0.30), `closed_at` (Release C).
- `wreath_items`: sale_id, `catalog_number`, name, size, description, price, unit_cost (numeric(10,2)), `image_url`, `donatable` boolean (true for catalog 1 and 2 only), sort_order, active; unique(sale_id, catalog_number).
- `wreath_sellers`: sale_id, `person_id bigint references people(id)`, slug (`check slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`), active, goal, message, message_approved_at; `unique(sale_id, person_id)`, `unique(sale_id, slug)`. A colliding new slug is refused in admin (no auto-suffix). Retired sellers keep their slug; their link falls back to the store without saying they existed.
- `wreath_orders`: sale_id, `order_number` (short, unique, typable, for the Venmo/PayPal note), `public_token uuid` (unguessable, the confirmation-page key), `idempotency_key` (unique), `credited_person_id` (null = troop), `delivering_person_id`, source check (scout_link/store/paper), fulfillment check (scout/pickup/delivery), round (1/2), customer name/email/phone/address/zip, `outside_area_relative` bool, money as numeric(10,2) (`items_subtotal`, `delivery_fee`, `fee_covered`, `gift`, `total`), payment status check (unpaid/paid/refunded), `paid_at`, `paid_method`, `paid_by_person_id`, status check (placed/cancelled), `placed_at`, `created_ip`.
- `wreath_order_lines`: order_id, item_id, quantity (`check quantity between 1 and 50`), donated bool, `unit_price` and `unit_cost` snapshots; unique(order_id, item_id, donated).
- Seed: the 2026 sale (cutoffs Sun Oct 25 and Sun Nov 15, 2026, 11:59 PM Central; distribution Sat Nov 21, 2026, 2:30–4:30 PM, Northwoods parking lot, 1572 East Capitol), the 19 items from the sheet (price + 2026 unit cost), and 28 sellers by **people.id**: Anjali Sankpal-Tatera 23, Aubrey Reinelt 48 ("Aubry" on the sheet), Ben Bieser 43, Damian Nikolaus 36, Eleanor Hooper 45, Eloise Lowery 175, Finn Paltzer 32, Fiona Kimble 14, Hazel Stollenwerk 29, Henry Ellerman 20, Isaac Hall 46, Jack Porter 25, Jameson Kimble 15, Kevin Pieper 34, Lee Pasek 41, Lily Porter 2 ("Lilly" on the sheet), Lucy Lyden 8, Oliver Kosmoski 31, Oliver Vest 27, Oscar Belle 21, Owen Radtke 44, Piper Kingston 17, Quinn Barry 16, Robbie Haessley 1, Solomon Rader 30, Veronica Kleinfeldt 28, Violet Babby 9, Winnie Black 22. The seed must fail loudly if a person id is missing or not linked to an active scout. **Charlie Walters (person 39, the test scout) is never in the production seed**; dev adds him through the Sellers screen.

### Public (no customer accounts)
- `(public)/wreaths/page.tsx` (troop store), `(public)/wreaths/[seller]/page.tsx` (scout link), `(public)/wreaths/order/[token]/page.tsx` (confirmation; `noindex`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`; shows order number, items, total, how to pay and when it arrives; **no** address or phone).
- Add `wreaths` to `RESERVED_TOP_LEVEL` (`lib/site-pages-tree.ts:69`); extend `tests/site-pages-tree.test.ts:52`.
- Public loaders select only display fields; a scout shows as first name + last initial; customer PII columns are never selected by a public loader.
- **Pay (Release A):** the confirmation page and email show the total, the order number to put in the note, and two options: Venmo @Patrick-Bieser-1 (`https://venmo.com/u/Patrick-Bieser-1`) and PayPal to patrickbieser@gmail.com (Friends and family). "Payment shows as Patrick Bieser, an assistant scoutmaster and the troop treasurer." No QR images.

### The order action (server action only; precedent `(public)/events/[id]/actions.ts`)
- Recomputes everything from item ids and quantities: price and cost snapshots, `delivery_fee` ($5 when fulfillment = delivery and items subtotal < $50, else 0; never on scout delivery), the fee-cover amount (`fee_percent`/`fee_fixed` on items + gift + delivery fee), and the total. Client totals are ignored.
- Bounds: items active and in this sale; donated lines only on `donatable` items; quantity 1–50; ≤ 25 lines; gift 0–500; length caps on every text field; email format; zip `^\d{5}$` and, for delivery, the `532` prefix — except a scout-link order with `outside_area_relative` ticked.
- Cutoff: a new order needs `placed_at` ≤ the round's cutoff, **except** a checkout started before it (the client posts the checkout-start time; the server accepts up to 2 hours of grace past the cutoff only when that start time is before the cutoff).
- Idempotent on a client-generated `idempotency_key`: a retry returns the same order.
- Bot and spam controls: a honeypot field plus a minimum time-to-submit; DB-counted limits like `identity-challenge.ts` (orders per IP per hour, confirmation emails per customer email per day, and a global hourly cap). Take the IP from the Vercel-set header. Over the limit, no order and no email, and the response is generic.
- Emails go through `sendEmail` (`lib/email.ts:100`, `confirm: true`) behind an injectable `deps`, like `dispatchConfirmations` (`lib/signup-confirmation-send.ts:365`). One customer confirmation per order, fixed copy, all customer input escaped; reply-to `troopEmail()`. A scout-link order also notifies the scout's household (the addresses on file, never a customer-supplied one).

### Admin: `/admin/finance/wreaths` (Finance section, `finance.manage`)
- Sub-tabs: **Settings** (dates, distribution, fees), **Items** (edit name, size, description, price, cost, image, donatable, active), **Sellers** (add from the roster, slug, retire, refuse a colliding slug), **Orders** (list and filter; detail; **Mark paid** with method, idempotent; **Reassign** credit and delivery; cancel), **Rose order** (count per catalog number for round 1, round 2 changes, total).
- Mark paid and Reassign each write `recordAudit` (`lib/audit.ts:118`) with actor, old and new values, amount and method; add a `wreaths` audit area.
- Follow the edit-screen, Save-button, table and date standards in `next-app/AGENTS.md`; styleguide specimens for anything new.

### Images
- Upload `Images/*.jpg` to Bunny with a one-shot seed script (`lib/bunny-storage.ts:75 uploadToBunny`) and write `wreath_items.image_url`. If Bunny isn't configured for this (check the env), fall back to optimized copies in `next-app/public/wreaths/`. The split tree photos are already in `Images/`.

### Tests to write first (qa-lead plus the plan's own)
Order_PriceComesFromServer_NotClient; Order_RejectsQuantityOutOfBounds_AndInactiveItem; DonatedLine_RejectedOnNonDonatableItem; DeliveryFee_FiveUnderFifty_FreeAtFifty_NeverOnScoutDelivery; CoverFee_AddsFee_OnlyWhenTicked; Submit_IsIdempotent_OnDuplicateKey; ConfirmationEmail_RateLimited_PerIpAndPerEmail; Honeypot_FilledOrTooFast_CreatesNoOrderAndSendsNoEmail; ConfirmationPage_RequiresUnguessableToken_AndOmitsAddressPhone; PublicLoaders_NeverReturnCustomerPii_OrScoutSurname; UnknownOrRetiredSlug_FallsBackWithoutLeakingExistence; Zip_RejectsNonFiveDigit_AndNon532_ServerSide; Relative_CanOrderOutsideArea_FromScoutLink_WhenTicked; StoreRefuses_NewCartAfterCutoff_ButAllowsOpenCheckout; MarkPaid_RequiresFinanceManage_IsIdempotent_AndAudits; Reassign_RequiresFinanceManage_AndAuditsOldAndNew; SellerSlug_CollisionRefused; WreathTables_HaveRlsAndNoAnonGrants; OrderEmailHtml_EscapesCustomerInput; CatchAll_ReservesWreathsSlug; RoseOrder_CountsByCatalogNumber_PerRound.

### Deploy order
DB-first: the migration and seed go to production after a dry run, then the code, then the "where the money goes" copy as a site_pages row (or a code constant until it exists). Production migration gets an Opus risk check first.

## Tune-up feedback (2026-10-19, Patrick). Parked, not built

### W-1. An order note that admins and the scout/parent both see

Admins and the scout or parent can add a note to a wreath order, and both sides see it.

Today the order already has two notes, both from Release B (`20261103100000_wreath_scout_entered`):
- `customer_note` (≤300): written when the order is placed.
- `payment_note` (≤200): written about the hand payment.

Neither is a shared, editable conversation note. To decide:
- [ ] **New column or not:** a new `order_note`, or widen `customer_note` into it?
- [ ] **Editing:** one editable note (last edit wins, showing who and when), or an append-only list of dated notes?
- [ ] **Where the scout/parent sees and edits it:** the scout's order list, and/or the customer's `/wreaths/order/[token]` page.
- [ ] **Who sees it:** is it ever shown to the customer, or only to troop members? Recommend troop-only; the customer keeps `customer_note`.

### W-2. Show a short or over payment on screen, on the payment pill

When the amount received differs from the calculated total, show it on screen. Patrick's suggestion: append it to the pill that shows the payment method, e.g. "Venmo · $5 short" / "Cash · $10 over (gift)".

Data already exists:
- Amount received is recorded since D-398: the ledger books what came in, and the troop absorbs a short payment.
- Over-payments can count the extra as a gift (D-401).

This is a display change on:
- the admin orders panel and dashboard
- the scout's order list
- possibly the customer order page (decide: probably not on the customer page)

Card orders are locked to the total, so they never show it.

### W-3. Donate to Troop 79 (2026-10-19, Patrick)

Under "Donate a wreath to veterans" on the store and on each scout's page, add a similar option to **donate money to Troop 79**. Several customers didn't want a wreath but wanted to give to the troop, and there was no way to do it.

- A donation-only order is the point: there's no wreath, so nothing needs delivery.
- **Patrick (2026-10-19):** the checkout's existing "Gift to Troop 79" box is *not* a valid donation path, because you can't reach checkout without a wreath in the cart. The donation must be its own entry point that puts a Donation line in the cart, so checkout works with only a donation.
- Today's veteran donations are wreath *items* with a donated flag (`items.donatable`). A troop donation is a money amount, not an item.

**Setting (Patrick):** the Wreath sale settings form (`settings-form.tsx`, next to the existing scouts' share of profit) gets a **"Scouts' share of donations"** percent, starting at **15%**. It is expected to change year to year, so it's a per-sale setting, the same as the share of profit.
- **Confirmed (Patrick, 2026-10-19):** the troop committee sets the % of cash donations that goes to scout accounts, starting at 15%. It applies to the checkout's existing "Gift to Troop 79" on orders credited to a scout, and later to donation-only orders. It is being built ahead of the rest of W-3.

Still to decide:
- [x] **Amount:** preset buttons ($10 / $25 / $50) plus "Other amount". (Patrick, 2026-10-19)
- [x] **A donation with no scout credit** (from the plain store) is 100% troop. (Patrick)
- [x] **Ledger:** book it in the wreath sale's bucket as its own Donation line, separable in reports. (Patrick)
- [x] **Card fees:** deduct the card processing fee from the donation. (Patrick)
  - The customer is not charged an extra fee on the donation.
  - The troop records the donation net of its share of the Stripe fee.
  - The scouts' share is taken from that net amount (reading; confirm at build).
- [x] **Acknowledgement:** yes, the confirmation email serves as a donation receipt. (Patrick) Wording to be checked with the treasurer: troop name, amount, date, and "no goods or services were provided" for donation-only orders.

### W-4. A super user enters paper orders for a scout (2026-10-19, Patrick)

Some scouts turn in orders on paper and never use the website. A super user who is signed in and on that scout's wreath page (`/wreaths/[seller]`) gets the normal **"Order for someone I know"** entry mode on that scout's behalf. Today that mode is offered only to the scout or a parent in their household.

- **Super user = holds `finance.manage`**, the wreath admin capability. Wreath super-user-ness follows the domain's own capability, as finance-viewer and household switching do. This is a decision; Patrick can change it.
- The order is credited to that scout. `entered_by_person_id` records the super user, and the audit says "entered by Dan V for Damian N".
- Everything else is the same as the family path:
  - source `paper`
  - collected by the scout
  - the same cutoff and lock rules
  - the same refusal if the order changed under them
- Server-side check: the action re-checks `finance.manage` from the session, never from a flag the client posted.
