-- PayPal joins the ways a family can pay an event fee (Patrick, 2026-10-05: "Add Paypal to accepted payment
-- options for event signup"). The method list is a CHECK constraint kept in lockstep with
-- lib/finance.ts TRANSACTION_METHODS; adding a value is this one-line change, as the 2026-08-18 note said.
--
-- DEPLOY ORDER: DB-first (the new code offers 'paypal' in the Record payment dialogs).

alter table public.financial_transactions drop constraint financial_transactions_method_check;
alter table public.financial_transactions
  add constraint financial_transactions_method_check
  check (method in ('venmo', 'paypal', 'check', 'cash', 'scout_account', 'bank', 'other'));
