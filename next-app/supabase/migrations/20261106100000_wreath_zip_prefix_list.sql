-- Wreath delivery area: one zip prefix or a comma list ("532, 531"). The app stores it normalized as
-- prefixes joined by ", " (lib/wreaths/rules.ts zipPrefixes / zipPrefixListOk).
alter table public.wreath_sales drop constraint if exists wreath_sales_delivery_zip_prefix_check;
alter table public.wreath_sales add constraint wreath_sales_delivery_zip_prefix_check
  check (delivery_zip_prefix ~ '^[0-9]{1,5}(, [0-9]{1,5})*$');
