-- Wreath sale: up to five addresses that get a copy of every new order's confirmation (Admin › Wreath Sale › Settings).
-- Same shape and cap as event_signups.confirm_recipients (lib/signup-confirmation MAX_LEADER_RECIPIENTS).
alter table public.wreath_sales add column if not exists order_cc text[] not null default '{}';
alter table public.wreath_sales drop constraint if exists wreath_sales_order_cc_max5;
alter table public.wreath_sales add constraint wreath_sales_order_cc_max5 check (cardinality(order_cc) <= 5);
