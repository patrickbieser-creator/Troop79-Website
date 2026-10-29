-- Meeting Planner III Emails, qa-lead E3 #1: "Send again" marks the failed or unknown email 'retried' in the same
-- statement that claims it, so two tabs (or a double press) can't both send it again. The new copy is a new row.
--
-- DEPLOY ORDER: DB-first (the CHECK only widens).

alter table public.meeting_emails drop constraint if exists meeting_emails_status_check;
alter table public.meeting_emails add constraint meeting_emails_status_check check (status in ('queued', 'sending', 'sent', 'failed', 'unknown', 'retried'));
