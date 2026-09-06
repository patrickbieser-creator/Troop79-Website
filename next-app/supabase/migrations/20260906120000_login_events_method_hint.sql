-- Bugle "Register Now" links — identity-hinted sign-in
-- (Plans/Bugle-Register-Now-Links.md, decision B7).
--
-- A hinted resolve that finds nobody is logged as a failed login_events row
-- with method 'hint' and failure_reason 'hint-unknown', so the per-IP peek
-- limiter can count it and the failed-logins dashboard shows a probe for
-- what it is. Additive: widen the method check. Deploy DB-first, then code.

alter table public.login_events drop constraint login_events_method_check;
alter table public.login_events
  add constraint login_events_method_check check (method in ('link', 'code', 'passkey', 'hint'));
