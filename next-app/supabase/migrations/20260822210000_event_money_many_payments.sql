-- Event Logistics, Phase 3 / C — many payments per entry (Plans/Event-Logistics.md).
--
-- DEPLOY ORDER (qa-lead 2026-08-22, critical #1): ship the CODE first, then
-- push this migration. The new record/void actions never read
-- payment_received and tolerate the unique index (a second payment fails
-- loudly, not silently, until the index is gone); the OLD actions against a
-- DB without the index would be the dangerous combination — which this
-- order never produces.
--
-- 1. Installments, split methods, refunds: drop the one-payment-per-entry
--    index. What replaces its guarantee: the per-entry balance is DERIVED
--    (signup_entry_balances), a client idempotency key makes a retried
--    "Record payment" click a no-op, and voids are by transaction id.
-- 2. payment_received is RETIRED — not cached, not maintained (D-134). Every
--    reader moved to signup_entry_balances (settled / paid / balance).
-- 3. Leader-entered reimbursement requests (an expense a leader fronted,
--    recorded from the event's Money tab) may not have a receipt upload, so
--    receipt_path becomes nullable; the family self-service flow still
--    requires one in the UI.

-- (The plan called it fin_tx_signup_entry_uq; the migration that created it
-- named it financial_transactions_signup_entry_uq. Drop both spellings.)
drop index if exists public.fin_tx_signup_entry_uq;
drop index if exists public.financial_transactions_signup_entry_uq;

alter table public.financial_transactions
  add column if not exists idempotency_key text;
create unique index if not exists financial_transactions_idempotency_uq
  on public.financial_transactions (idempotency_key) where idempotency_key is not null;
comment on column public.financial_transactions.idempotency_key is
  'Client-minted key for retry-safe writes (record payment / refund / credit). Unique when present.';

alter table public.signup_entries drop column if exists payment_received;

alter table public.reimbursement_requests alter column receipt_path drop not null;
alter table public.reimbursement_requests
  add column if not exists calendar_entry_id bigint references public.calendar_entries(id) on delete set null,
  add column if not exists entered_by_person_id bigint references public.people(id);
comment on column public.reimbursement_requests.calendar_entry_id is
  'The event this reimbursement belongs to (leader-entered from the Money tab, or linked later).';
