-- Transaction Kinds becomes a real, governed lookup table — same pattern as
-- calendar_categories (label/code is the primary key AND the value stored
-- on the referencing table, ON UPDATE CASCADE so a rename propagates for
-- free, ON DELETE RESTRICT so a kind still in use can't be removed).
--
-- Kind carries no direction/behavior of its own (2026-08-20 — Direction, the
-- signed amount, is the only thing that decides money in vs. out). It was a
-- hardcoded 9-value CHECK constraint; a treasurer wanting a new category had
-- to wait for a code deploy. This makes it extensible without one, the same
-- way calendar_categories already lets a leader add a new event category
-- from the admin UI instead of editing a constant in code.

create table transaction_kinds (
  code text primary key,
  label text not null,
  sort_order integer not null,
  created_at timestamptz not null default now()
);

comment on table transaction_kinds is
  'Governed lookup for financial_transactions.kind — a reconciliation/reporting tag only, never a driver of balance or direction. Add rows from the admin UI to add a new category without a deploy.';

-- Seed with the 9 values the CHECK constraint used to enforce, and the one
-- display-label override that already existed (TRANSACTION_KIND_LABELS in
-- lib/finance.ts: event_fee -> "Event"). Every other label equals its code.
insert into transaction_kinds (code, label, sort_order) values
  ('event_fee',    'Event',        10),
  ('fundraiser',   'fundraiser',   20),
  ('donation',     'donation',     30),
  ('expense',      'expense',      40),
  ('reimbursement','reimbursement',50),
  ('transfer',     'transfer',     60),
  ('interest',     'interest',     70),
  ('adjustment',   'adjustment',   80),
  ('income',       'income',       90);

alter table financial_transactions
  add constraint financial_transactions_kind_fkey
  foreign key (kind) references transaction_kinds(code)
  on update cascade on delete restrict;

alter table financial_transactions
  drop constraint financial_transactions_kind_check;

alter table transaction_kinds enable row level security;

create policy transaction_kinds_read_all on transaction_kinds
  for select using (true);
