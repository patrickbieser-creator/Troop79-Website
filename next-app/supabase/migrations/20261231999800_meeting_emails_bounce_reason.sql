-- Why an email bounced (Patrick, 2026-11-08, after Outlook/Hotmail bounces with no reason on our side): the Resend
-- webhook's data.bounce as "<type> · <subType>: <message>", cut to 500 characters. Shown on the Emails screen's Sent
-- log. DEPLOY ORDER: DB-first (one nullable column). meeting_emails already has RLS on and no anon/authenticated grants.
alter table public.meeting_emails
  add column if not exists bounce_reason text
    constraint meeting_emails_bounce_reason_length check (char_length(bounce_reason) <= 500);
