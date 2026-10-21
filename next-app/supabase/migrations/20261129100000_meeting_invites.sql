-- Meeting invites, P1: teachers (2026-10-20, Plans/Matcher-Tune-Up.md T-5).
--
-- A leader (meeting_plan.use) ticks adults on This Sunday and the Troop 79 Bugler emails each one "Can you teach
-- <topic> on Sunday?" with a link. Per the qa-lead review the link is a SCOPED capability, not a sign-in: it lets its
-- holder say yes or no to that one invite and nothing else, so a forwarded email can never become a session.
--
-- 1. meeting_invites: one row per person invited to one topic at one meeting. Only the token's peppered hash is kept
--    (unique); the raw token lives only in the email. Expires 6:00 PM Central on the meeting day (Patrick). Single
--    use: the redeem is one atomic UPDATE ... WHERE consumed_at IS NULL. `response` records the answer. The table is
--    also the "who did we ask" log the board counts from.
-- 2. meeting_invite_failures: unknown / spent / expired redeem attempts by IP, for the per-IP limit (qa-lead M4).
-- 3. audit_log gains the 'meeting' area (each send, accept and decline is audited).
--
-- Additive only. DEPLOY ORDER: DB-first, then the code.
-- Posture (D-051 / D-239): RLS on, no policies, nothing granted to anon/authenticated; the server uses service role.

create table if not exists public.meeting_invites (
  id bigint generated always as identity primary key,
  calendar_entry_id bigint not null references public.calendar_entries(id) on delete cascade,
  topic_key text not null,
  kind text not null check (kind in ('teach', 'pick')),
  invitee_person_id bigint not null references public.people(id) on delete cascade,
  recipient_person_id bigint not null references public.people(id) on delete cascade,
  sent_to text not null,
  -- The invitee's people.session_epoch at send: a later bump ("sign out everywhere", a merge) voids the invite too.
  invitee_epoch integer not null,
  token_hash text not null,
  expires_at timestamptz not null,
  sent_by bigint references public.people(id) on delete set null,
  sent_at timestamptz not null default now(),
  consumed_at timestamptz,
  response text check (response in ('accepted', 'declined', 'changed')),
  responded_at timestamptz,
  constraint meeting_invites_token_hash_key unique (token_hash),
  constraint meeting_invites_response_consumed check (response is null or consumed_at is not null)
);
create index if not exists meeting_invites_entry_topic_idx on public.meeting_invites (calendar_entry_id, topic_key);
create index if not exists meeting_invites_invitee_idx on public.meeting_invites (invitee_person_id);
alter table public.meeting_invites enable row level security;
revoke all on public.meeting_invites from public, anon, authenticated;

create table if not exists public.meeting_invite_failures (
  id bigint generated always as identity primary key,
  ip text,
  reason text not null,
  at timestamptz not null default now()
);
create index if not exists meeting_invite_failures_ip_at_idx on public.meeting_invite_failures (ip, at);
alter table public.meeting_invite_failures enable row level security;
revoke all on public.meeting_invite_failures from public, anon, authenticated;

alter table public.audit_log drop constraint if exists audit_log_area_check;
alter table public.audit_log
  add constraint audit_log_area_check
  check (area in ('news', 'calendar', 'roster', 'library', 'menus', 'pages', 'wreaths', 'meeting'));
