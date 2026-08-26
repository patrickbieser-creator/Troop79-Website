-- calendar_entries.excerpt: collapsed into description 2026-08-25 (D-233);
-- nothing reads or writes it since v1.100. Code that stopped writing it
-- ships before this runs (deploy order: code-first for tightenings).
alter table public.calendar_entries drop column if exists excerpt;
