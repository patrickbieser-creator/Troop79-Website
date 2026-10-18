-- Buckets manager (Bucket Report › Buckets tab, Patrick 2026-10-18): the picker list also carries how many
-- transactions each bucket holds and which calendar entries point at it — read in SQL, so no 1000-row cap.
-- Additive for readers: the old columns keep their names and order. DB-first.
drop function if exists public.bucket_list();
create function public.bucket_list()
returns table (id bigint, name text, is_event boolean, last_used date, row_count bigint, events jsonb)
language sql
stable
set search_path = public
as $$
  select b.id,
         b.name,
         exists (select 1 from calendar_entries c where c.bucket_id = b.id),
         (select max(f.occurred_on) from financial_transactions f where f.bucket_id = b.id and f.voided_at is null),
         (select count(*) from financial_transactions f where f.bucket_id = b.id),
         coalesce(
           (select jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'date', c.entry_date) order by c.entry_date)
              from calendar_entries c where c.bucket_id = b.id),
           '[]'::jsonb
         )
    from buckets b
$$;
revoke execute on function public.bucket_list() from public, anon, authenticated;
grant execute on function public.bucket_list() to service_role;
