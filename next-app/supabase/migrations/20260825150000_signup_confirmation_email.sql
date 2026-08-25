-- Signup confirmation email (Plans/Signup-Confirmation-Email.md, Patrick 2026-08-25).
--
-- 1. email_templates — the reusable library. `kind` is a free string, NOT an
--    enum: 'signup.family' and 'signup.leader' today; newsletter / nudges /
--    reminders later with no migration ("Library will be used soon for other
--    emails. Make it open-ended."). The app's registry (lib/email-templates.ts)
--    says which kinds exist and which merge fields each provides.
-- 2. event_signups — the Confirmation email block: per audience an on/off,
--    a chosen template and an optional per-event override; the leader cc list
--    (max 5); "use the family message"; the last send error.
-- 3. signup_confirmation_log — one row per audience per send, with the
--    deduped recipients actually written to, so the roster can say
--    "Confirmation sent 2:14 PM" and offer Resend.

create table if not exists public.email_templates (
  id bigserial primary key,
  name text not null unique,
  kind text not null,
  subject text not null,
  body text not null,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists email_templates_kind_idx on public.email_templates (kind) where retired_at is null;
alter table public.email_templates enable row level security;

alter table public.event_signups
  add column if not exists confirm_family_enabled boolean not null default false,
  add column if not exists confirm_family_template_id bigint references public.email_templates(id),
  add column if not exists confirm_family_subject text,
  add column if not exists confirm_family_body text,
  add column if not exists confirm_leader_enabled boolean not null default false,
  add column if not exists confirm_leader_template_id bigint references public.email_templates(id),
  add column if not exists confirm_leader_subject text,
  add column if not exists confirm_leader_body text,
  add column if not exists confirm_leader_use_family boolean not null default false,
  add column if not exists confirm_recipients text[] not null default '{}',
  add column if not exists confirm_last_error text;

alter table public.event_signups
  drop constraint if exists event_signups_confirm_recipients_max5,
  add constraint event_signups_confirm_recipients_max5 check (cardinality(confirm_recipients) <= 5);

create table if not exists public.signup_confirmation_log (
  id bigserial primary key,
  event_signup_id bigint not null references public.event_signups(id) on delete cascade,
  household_id bigint references public.households(id),
  audience text not null check (audience in ('family', 'leader')),
  change text not null check (change in ('new', 'update', 'cancel', 'resend')),
  recipients text[] not null,
  status text not null check (status in ('sent', 'skipped', 'failed')),
  detail text,
  sent_at timestamptz not null default now()
);
create index if not exists signup_confirmation_log_signup_idx
  on public.signup_confirmation_log (event_signup_id, household_id, sent_at desc);
alter table public.signup_confirmation_log enable row level security;

-- Seeds: two per kind, so the block works the moment it is switched on.
insert into public.email_templates (name, kind, subject, body) values
  ('Event confirmation', 'signup.family', 'Signed up: [event]',
   'Hi [name] — you''re signed up for [event] on [date]. We''ll be at [location] ([map]). Amount due: [amount_due]. [payment] Reply to this email if anything changes before [deadline].'),
  ('Meeting RSVP', 'signup.family', 'See you at [event]',
   'Hi [name] — [scouts] going to [event] on [date] at [time], [location].

[summary]'),
  ('New signup', 'signup.leader', '[changed]: [household] — [event]',
   '[household] ([email], [phone]) — [changed]: [going]. [jobs] [rides] Amount due [amount_due]. [headcount].

[changes]'),
  ('Money watch', 'signup.leader', '[event]: [household] owes [amount_due]',
   '[household] signed up: [prices]. Paid [paid], owes [amount_due].')
on conflict (name) do nothing;
