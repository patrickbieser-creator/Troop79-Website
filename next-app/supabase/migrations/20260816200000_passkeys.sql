-- Passkeys — Plans/Family-Identity-Auth.md Phase 4, shipped 2026-08-16.
--
-- WHY
-- The magic link proves who you are ONCE; a passkey makes every sign-in after
-- that a fingerprint or face scan with nothing typed. It is strictly better
-- than the shared password on both axes at once — less friction AND more
-- security — which is rare enough to be worth taking.
--
-- Today's mail-gateway bug is the argument in miniature: a sign-in link is a
-- secret that has to survive an email, a transport, a rewriter and a browser.
-- A passkey never leaves the device.
--
-- THE MAGIC LINK IS NEVER REMOVED. It is the recovery path when a phone is
-- lost, a device replaced, or a passkey sync fails. A passkey-only account is
-- a family locked out of their scout's record with no self-service way back
-- in. The two live side by side permanently.

create table public.passkey_credentials (
  id bigint generated always as identity primary key,
  person_id bigint not null references public.people(id) on delete cascade,
  -- base64url, as issued by the authenticator.
  credential_id text not null unique,
  public_key bytea not null,
  sign_count bigint not null default 0,
  transports text[],
  aaguid text,
  backed_up boolean not null default false,
  -- "Dana's iPhone" — so a person with three devices can tell them apart when
  -- revoking one.
  nickname text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index passkey_credentials_person_idx on public.passkey_credentials (person_id);

alter table public.passkey_credentials enable row level security;
-- Zero policies (D-051), service-role only — same as login_tokens and
-- person_capabilities. A public key is not a secret, but the mapping of
-- person → devices is exactly the sort of thing the anon key has no business
-- enumerating.

-- ── Challenges ──────────────────────────────────────────────────────────────
-- WebAuthn requires the server to remember the challenge it issued and to
-- verify the response against THAT value. Holding it in a cookie would work,
-- but a table keeps the whole ceremony server-side and lets registration and
-- authentication share one expiry rule.
--
-- person_id is NULL for a discoverable-credential sign-in: the whole point is
-- that the user has not told us who they are yet — the authenticator does.
create table public.passkey_challenges (
  id bigint generated always as identity primary key,
  challenge text not null unique,
  person_id bigint references public.people(id) on delete cascade,
  kind text not null check (kind in ('register', 'authenticate')),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index passkey_challenges_expiry_idx
  on public.passkey_challenges (expires_at)
  where consumed_at is null;

alter table public.passkey_challenges enable row level security;

-- ── Revocation must reach the strongest credential ──────────────────────────
-- session_epoch revokes cookies. It cannot revoke a passkey, because a passkey
-- mints a NEW session rather than carrying an old one — so bumping the epoch
-- while leaving the credential in place would mean "revoke everything except
-- the one thing that can sign back in immediately."
--
-- A trigger, not app code, for the same reason the epoch bump is a trigger
-- (Family-Identity-Auth.md): the paths that matter most — bulk roster-import
-- accepts, a leader running SQL in the Supabase console, merges — never touch
-- app code.
create or replace function public.trg_drop_passkeys_on_revoke()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.session_epoch is distinct from old.session_epoch then
    delete from public.passkey_credentials where person_id = new.id;
  end if;
  return new;
end;
$$;

create trigger people_passkey_revoke
  after update of session_epoch on public.people
  for each row execute function public.trg_drop_passkeys_on_revoke();

comment on table public.passkey_credentials is
  'WebAuthn credentials (Family-Identity-Auth.md Phase 4). Adults only. '
  'Deleted automatically when people.session_epoch is bumped — revoking a '
  'person must revoke their strongest credential too, not just their cookies.';
