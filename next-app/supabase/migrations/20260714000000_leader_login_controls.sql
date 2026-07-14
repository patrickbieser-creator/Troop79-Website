-- Adult login controls: which leaders.code entries may sign in to the admin
-- app as a leader, and an optional override for the name they sign in with.
-- Defaults preserve current behavior (everyone already counted as an "adult"
-- keeps admin access) — this is opt-out, not opt-in, so the migration never
-- silently locks anyone out.

alter table public.leaders
  add column can_login boolean not null default true,
  add column login_name text;

comment on column public.leaders.can_login is
  'Whether this person may sign in to /admin/login as a leader. Only meaningful for adult/youth (is_person) rows — source rows (Camp, Clinic, ...) never appear in the login pool regardless.';
comment on column public.leaders.login_name is
  'Optional override for the name shown/typed at login. When null, a "First L." label is auto-derived from `name`, disambiguated against other adults who share a first name.';
