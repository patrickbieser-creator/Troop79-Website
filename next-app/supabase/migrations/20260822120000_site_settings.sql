-- Editable site text (Patrick, 2026-08-21: the event-reminder follow-up
-- email "should be in the lookups section of the admin so that text can be
-- edited"). A small key/value store, value only — a missing or blank value
-- means "use the built-in default" (the same contract article typography
-- uses in article_style_tokens). Keys are namespaced dot paths
-- ('reminder_email.subject'); the TS side owns the key list and defaults
-- (src/lib/site-text.ts).
--
-- Service-role only (D-051 pattern): RLS on, no policies — read and written
-- through server actions/loaders with the admin client. Leaders edit it from
-- Lookups & Admin → "Event reminder email".

create table if not exists public.site_settings (
  key        text primary key,
  value      text not null,
  updated_by text,
  updated_at timestamptz not null default now()
);

alter table public.site_settings enable row level security;

comment on table public.site_settings is
  'Editable site text/settings by key (e.g. reminder_email.*). Blank/missing = built-in default (src/lib/site-text.ts). Service-role only.';
