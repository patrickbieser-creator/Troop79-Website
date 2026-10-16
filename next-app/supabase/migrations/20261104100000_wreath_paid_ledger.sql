-- Wreath sale: marking an order paid books the money into the finance ledger (Patrick, 2026-10-15).
--
-- financial_transactions.wreath_order_id ties the checking/fundraiser row Mark paid writes to its order:
--   * at most one LIVE row per order (partial unique index; a voided row frees the slot), so a double click or a
--     retried action can never book an order twice;
--   * ON DELETE RESTRICT — a paid order's money is real, so deleting the order must first deal with its ledger row
--     (the test-order cleanup recipe deletes or voids it explicitly).
-- Additive only: DB-first deploy (the code that writes the column ships after this lands).

alter table public.financial_transactions
  add column if not exists wreath_order_id bigint references public.wreath_orders(id) on delete restrict;

create unique index if not exists financial_transactions_wreath_order_live
  on public.financial_transactions (wreath_order_id)
  where wreath_order_id is not null and voided_at is null;
