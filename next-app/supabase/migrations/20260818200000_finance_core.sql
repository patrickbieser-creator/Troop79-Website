-- Troop Finances — Phase 1: schema + capabilities, ships DARK
-- (Plans/Troop-Finances.md).
--
-- WHY (Patrick, 2026-08-18)
-- Replaces the treasurer's standalone spreadsheet with the books of record:
-- Landmark checking, Landmark savings, and the notional per-scout/scholarship
-- sub-ledgers all live in one table. No online payment collection in this
-- build (deferred, not rejected — see financial_transactions.method). No
-- dues/registration tracking of any kind — the troop doesn't collect dues,
-- and annual BSA registration is tracked in a separate system entirely.
--
-- Nothing reads these tables yet. The import script and the read-only admin
-- ledger view (Phase 1) are the first readers/writers; the treasurer write UI
-- is Phase 2.

-- ── financial_transactions — every money movement, one table ───────────────
-- Matches the ledger_entries.kind-discriminator precedent, and the
-- spreadsheet's own shape (one CashFlow sheet, one Code column for account,
-- one Category column for kind). A troop-level bank row and a scout-account
-- credit are the same shape differing only in whether a person is attached —
-- two tables would force every balance query and export to UNION them.
create table public.financial_transactions (
  id             bigserial primary key,
  occurred_on    date not null,
  account        text not null check (account in
                   ('checking','savings','scout_account','scholarship','sofi')),
                   -- checking/savings = real Landmark accounts (BLC/BLS)
                   -- scout_account = NOTIONAL per-scout sub-ledger, commingled in the real bank balance
                   -- scholarship   = notional troop fund (the spreadsheet's 37th "scout account")
                   -- sofi          = retired, fully closed account — historical rows only, derives to $0
  amount         numeric(10,2) not null check (amount <> 0),   -- signed: + in, - out
  kind           text not null check (kind in
                   ('event_fee','fundraiser','donation','expense','reimbursement',
                    'transfer','interest','adjustment','income')),
  method         text check (method in
                   ('venmo','check','cash','scout_account','bank','other')),
                   -- No 'online' value yet — no payment processing in this build. Adding one
                   -- later is a one-line CHECK-constraint change, not a schema redesign.
  person_id      bigint references public.people(id),   -- required when account='scout_account'
  memo           text,             -- payee/payer free text when not a person, or a note
  activity_label text,             -- normalized version of the spreadsheet's free-text Event field
  transfer_group uuid,             -- links both legs of one real-world movement: a checking↔savings
                                    -- transfer, or a cash deposit that credits both checking AND a
                                    -- scout's notional balance
  signup_entry_id  bigint references public.signup_entries(id),
  reimbursement_id bigint,   -- FK added below, after reimbursement_requests exists
  source         text not null default 'app' check (source in ('import','app')),
  import_row     int,              -- original CashFlow sheet row, audit trail for the backfill
  import_batch   text,             -- e.g. 'cashflow-2026' — tags a one-shot import run so it can
                                    -- be deleted and re-imported idempotently while mapping is tuned
  entered_by_person_id bigint references public.people(id),
                    -- A real FK, not free text — this project's person_capabilities.granted_by
                    -- precedent is explicit that ledger_entries.entered_by being free text was a
                    -- mistake not worth repeating.
  voided_at      timestamptz,
  voided_by_person_id bigint references public.people(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz,
  check (account <> 'scout_account' or person_id is not null)
);

create index financial_transactions_account_idx on public.financial_transactions (account, occurred_on);
create index financial_transactions_person_idx on public.financial_transactions (person_id) where person_id is not null;
create index financial_transactions_transfer_group_idx on public.financial_transactions (transfer_group) where transfer_group is not null;
create index financial_transactions_voided_idx on public.financial_transactions (voided_at) where voided_at is null;
create unique index financial_transactions_signup_entry_uq
  on public.financial_transactions (signup_entry_id) where signup_entry_id is not null;
  -- Makes double-recording an event-fee payment structurally impossible, not just policy.
create unique index financial_transactions_reimbursement_uq
  on public.financial_transactions (reimbursement_id) where reimbursement_id is not null;
  -- Same reasoning, same shape, for markReimbursementPaidAction() — added
  -- post-launch (qa-lead, 2026-08-18, pre-production BLOCK finding): without
  -- this, retrying "mark paid" after a partial-failure error (transaction
  -- written, status update failed) creates a second real payout for the
  -- same request. The action's own status-in-'approved' check alone doesn't
  -- catch this, because a failed status update leaves the request sitting
  -- in exactly the state that guard treats as "not yet paid."

alter table public.financial_transactions enable row level security;
-- Zero policies (D-051 pattern, same as person_capabilities and every other
-- table with PII or money-adjacent data). Every read goes through
-- createAdminClient(); authorization is 100% app-layer.

-- ── account_reconciliations — the proportionate substitute for double-entry ─
-- Full double-entry is the wrong complexity budget for a volunteer parent
-- treasurer. Monthly, the treasurer types the real Landmark statement
-- balance; the app snapshots the computed balance alongside it and shows
-- drift. This table is also the anchor for the (future, Phase 5 stretch)
-- reconciliation assistant.
create table public.account_reconciliations (
  id bigserial primary key,
  account text not null check (account in ('checking','savings')),
  as_of date not null,
  statement_balance numeric(10,2) not null,
  computed_balance  numeric(10,2) not null,
  note text,
  reconciled_by_person_id bigint references public.people(id),
  created_at timestamptz not null default now(),
  unique (account, as_of)
);

alter table public.account_reconciliations enable row level security;
-- Zero policies — same posture as above.

-- ── reimbursement_requests — a workflow, not a transaction ──────────────────
-- A request can be denied and produce zero money movement, so it is not a
-- financial_transactions row. When money does move (marking paid), that
-- write creates a linked financial_transactions row atomically.
create table public.reimbursement_requests (
  id bigserial primary key,
  requester_person_id bigint not null references public.people(id),
  amount numeric(10,2) not null check (amount > 0),
  description text not null,
  receipt_path text not null,       -- private Supabase storage bucket, same pattern as proof_media
  status text not null default 'submitted' check (status in
    ('submitted','withdrawn','approved','denied','paid')),
  denial_reason text,
  decided_by_person_id bigint references public.people(id),
  decided_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.reimbursement_requests enable row level security;
-- Zero policies — same posture as above.

alter table public.financial_transactions
  add constraint financial_transactions_reimbursement_id_fkey
  foreign key (reimbursement_id) references public.reimbursement_requests(id);

comment on table public.financial_transactions is
  'The single ledger for every troop money movement (Plans/Troop-Finances.md Phase 1). '
  'Balances are always derived via sum(amount) — never a stored running total.';
comment on table public.account_reconciliations is
  'Monthly statement-vs-computed snapshots. Proportionate substitute for double-entry bookkeeping.';
comment on table public.reimbursement_requests is
  'Workflow state for a reimbursement ask. Money only moves via a linked financial_transactions row.';

-- ── capabilities — finance.manage / finance.view ────────────────────────────
-- Extends the vocabulary added in 20260816120000_person_capabilities.sql.
-- Deliberately separate from roster.manage and every other existing grant —
-- money access should be narrow and auditable on its own.
alter table public.person_capabilities drop constraint person_capabilities_capability_check;
alter table public.person_capabilities add constraint person_capabilities_capability_check
  check (capability in (
    'advancement.write',
    'roster.manage',
    'calendar.write',
    'news.write',
    'meeting_plan.use',
    'library.moderate',
    'library.proxy_view',
    'finance.manage',    -- transactions, reconciliation, reimbursement decisions/payouts, import tooling, export
    'finance.view'       -- read-only over every treasurer screen; nobody granted at seed time
  ));

-- Bootstrap: the same library_superusers-derived admin seeded with every
-- other capability in 20260816120000_person_capabilities.sql must also hold
-- BOTH new capabilities, or (a) the finance admin screen is unreachable and
-- the system is bricked, and (b) the existing invariant test
-- AtLeastOnePerson_HoldsEveryCapability_SoTheSystemIsNotBricked — which
-- checks every entry in CAPABILITIES, now including finance.view — starts
-- failing the moment CAPABILITIES gains a value nobody holds. This does NOT
-- contradict "nobody gets finance.view at launch": that instruction is about
-- not granting it to an additional named committee member, not about the
-- structural bootstrap admin who already holds every other capability too.
-- Replicates the original migration's own bootstrap query exactly, rather
-- than trying to infer "whoever holds everything else" from here.
--
-- Jason and Mindy are granted finance.manage through /admin/access after
-- deploy, the same self-service way roster.manage was granted to Jack K,
-- Jason P, Mindy S, and Melissa R on 2026-08-16 — not hardcoded here by
-- fuzzy name match, which risks granting money access to the wrong person_id
-- if a display_name match is ambiguous or stale.
insert into public.person_capabilities (person_id, capability)
select l.person_id, c.capability
from public.library_superusers ls
join public.leaders l on l.code = ls.leader_code
cross join (values ('finance.manage'), ('finance.view')) as c(capability)
where l.person_id is not null
on conflict do nothing;
