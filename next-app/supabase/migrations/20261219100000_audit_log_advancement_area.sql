-- Ledger edits are audited (Patrick, 2026-10-22): every change to a ledger_entries row (field edits, archive,
-- delete, restore) writes an audit_log row in a new 'advancement' area (lib/ledger-audit). Additive: the check only
-- widens. Until it lands, recordAuditAs swallows the refused insert, so a save never breaks.
alter table public.audit_log drop constraint if exists audit_log_area_check;
alter table public.audit_log
  add constraint audit_log_area_check
  check (area in ('news', 'calendar', 'roster', 'library', 'menus', 'pages', 'wreaths', 'meeting', 'advancement'));
