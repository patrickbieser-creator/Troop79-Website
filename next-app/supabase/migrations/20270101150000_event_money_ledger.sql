-- Event Money ledger + person panel (Plans/Event-Money-Ledger-Redesign.md): the data the panel needs.
--
-- 1. signup_entries.amount_override_reason: why a custom amount (optional; Patrick 2026-11-12). Cleared with the
--    override when the person goes back to the tier.
-- 2. signup_entry_amount_changes: every change to what one person owes — old and new amount, old and new mode
--    (tier / custom / none = "Not paying", override 0), reason, who and when. The panel's history merges these with
--    the person's payments.
-- 3. set_entry_amount_override: ONE writer for the override, its reason and the change row, in one transaction.
--    Amounts are the effective owed (signup_entry_balances.owed) before and after, so "Tier → Custom" reads
--    "$25 → $20" even though the tier row was never stored on the entry. A save that changes nothing writes nothing.
-- 4. financial_transactions.void_reason: why a payment was voided (optional), beside voided_by_person_id.
--
-- Posture (D-051 / D-239): RLS on, no policies, nothing granted to anon or authenticated; the function is invoker
-- and service-role only.

alter table public.signup_entries add column if not exists amount_override_reason text;
alter table public.signup_entries drop constraint if exists signup_entries_amount_override_reason_length;
alter table public.signup_entries add constraint signup_entries_amount_override_reason_length
  check (char_length(amount_override_reason) <= 200);

alter table public.financial_transactions add column if not exists void_reason text;
alter table public.financial_transactions drop constraint if exists financial_transactions_void_reason_length;
alter table public.financial_transactions add constraint financial_transactions_void_reason_length
  check (char_length(void_reason) <= 200);

create table if not exists public.signup_entry_amount_changes (
  id bigint generated always as identity primary key,
  signup_entry_id bigint not null references public.signup_entries(id) on delete cascade,
  old_amount numeric(10,2) not null,
  new_amount numeric(10,2) not null,
  old_mode text not null check (old_mode in ('tier', 'custom', 'none')),
  new_mode text not null check (new_mode in ('tier', 'custom', 'none')),
  reason text check (char_length(reason) <= 200),
  changed_by_person_id bigint references public.people(id) on delete set null,
  changed_by_label text,
  changed_at timestamptz not null default now(),
  constraint changed_at_from_1900 check (changed_at >= '1900-01-01')
);
create index if not exists signup_entry_amount_changes_entry_idx on public.signup_entry_amount_changes (signup_entry_id);
alter table public.signup_entry_amount_changes enable row level security;
revoke all on public.signup_entry_amount_changes from anon, authenticated;

create or replace function public.set_entry_amount_override(
  p_entry_id bigint,
  p_amount numeric,
  p_reason text,
  p_changed_by_person_id bigint,
  p_changed_by_label text
)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_old_override numeric;
  v_old_reason text;
  v_old_owed numeric;
  v_new_owed numeric;
  v_amount numeric := case when p_amount is null then null else round(p_amount, 2) end;
  v_reason text := case when p_amount is null then null else nullif(btrim(coalesce(p_reason, '')), '') end;
  v_old_mode text;
  v_new_mode text;
begin
  if v_amount is not null and v_amount < 0 then
    raise exception using errcode = 'T7902', message = 'Amount must be zero or more.';
  end if;
  if char_length(v_reason) > 200 then
    raise exception using errcode = 'T7902', message = 'Keep the reason under 200 characters.';
  end if;

  select amount_override, amount_override_reason into v_old_override, v_old_reason
    from signup_entries where id = p_entry_id for update;
  if not found then raise exception using errcode = 'T7902', message = 'That sign-up entry no longer exists.'; end if;
  select owed into v_old_owed from signup_entry_balances where entry_id = p_entry_id;

  v_old_mode := case when v_old_override is null then 'tier' when v_old_override = 0 then 'none' else 'custom' end;
  v_new_mode := case when v_amount is null then 'tier' when v_amount = 0 then 'none' else 'custom' end;

  if v_old_override is not distinct from v_amount and v_old_reason is not distinct from v_reason then
    return jsonb_build_object('changed', false);
  end if;

  update signup_entries
     set amount_override = v_amount, amount_override_reason = v_reason, updated_at = now()
   where id = p_entry_id;
  select owed into v_new_owed from signup_entry_balances where entry_id = p_entry_id;

  insert into signup_entry_amount_changes
    (signup_entry_id, old_amount, new_amount, old_mode, new_mode, reason, changed_by_person_id, changed_by_label)
  values
    (p_entry_id, coalesce(v_old_owed, 0), coalesce(v_new_owed, 0), v_old_mode, v_new_mode, v_reason,
     p_changed_by_person_id, p_changed_by_label);

  return jsonb_build_object('changed', true, 'old_amount', v_old_owed, 'new_amount', v_new_owed,
                            'old_mode', v_old_mode, 'new_mode', v_new_mode);
end;
$$;

revoke all on function public.set_entry_amount_override(bigint, numeric, text, bigint, text) from public, anon, authenticated;

-- A merge moves who changed an amount too (people_merge_followups, 20270101140000).
create or replace function public.people_merge_followups()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_survivor bigint := new.merged_into_person_id;
begin
  insert into person_capabilities (person_id, capability, granted_at, granted_by)
  select v_survivor, capability, granted_at, granted_by from person_capabilities where person_id = old.id
  on conflict (person_id, capability) do nothing;
  delete from person_capabilities where person_id = old.id;
  update person_capabilities set granted_by = v_survivor where granted_by = old.id;
  update signup_entry_amount_changes set changed_by_person_id = v_survivor where changed_by_person_id = old.id;
  return new;
end;
$$;
