-- Family Identity & Passwordless Auth — Phase 1 schema (Plans/Family-Identity-Auth.md).
--
-- WHY (Patrick, 2026-08-06)
-- Binds a family session to a real person + household, without a password to
-- remember: enter an email/phone, get a sign-in link AND a 6-digit code,
-- redeem either into a 120-day identity cookie. Replaces the self-asserted
-- household picker (t79_profile_household) as the trust source for anything
-- that writes real data on a family's behalf — /profile edits and
-- /library/submit-proof (Phase 2 binds those surfaces).
--
-- No identity_sessions table — the session lives in the signed cookie
-- (lib/identity-session.ts); session_epoch below is the revocation lever.
-- login_tokens doubles as the audit trail (most recent consumed_at = "last
-- verified").

-- ── login_tokens — the challenge/redemption record ─────────────────────────
create table public.login_tokens (
  id bigint generated always as identity primary key,
  person_id bigint not null references public.people(id),
  channel text not null check (channel in ('email', 'sms')),
  sent_to text not null,               -- audit: where it actually went
  token_hash text not null unique,     -- sha256(link token || pepper)
  code_hash text not null,             -- sha256(6-digit code || pepper)
  next_path text,                      -- deep-link preservation, safeInternalPath()'d on redemption
  attempts int not null default 0,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_by_leader text,              -- set when a leader mints an offline code (Phase 3)
  created_ip inet,
  created_at timestamptz not null default now()
);

-- The common read is "this person's live outstanding token(s)" — redemption
-- invalidates every other one for the same person.
create index login_tokens_person_pending_idx
  on public.login_tokens (person_id) where consumed_at is null;

alter table public.login_tokens enable row level security;
-- Zero policies (D-051 pattern, same as requirement_submissions/proof-media
-- bucket) — every access path goes through createAdminClient(); the anon key
-- gets nothing. A stolen token_hash/code_hash is useless without the
-- server-side pepper (IDENTITY_TOKEN_PEPPER), and RLS means the anon key
-- can't even read the hashes to try.

-- ── people.session_epoch — the revocation lever ─────────────────────────────
-- A verified identity cookie carries the epoch it was issued at; a mismatch
-- against the live value means "revoked, sign in again." Bumping this is
-- cheaper than a sessions table and the only state that needs to exist.
alter table public.people add column if not exists session_epoch int not null default 0;

-- ── Revocation triggers — fire from the DB, not app code ───────────────────
-- (Patrick, 2026-08-06) App-level hooks miss the paths that actually matter:
-- bulk roster-import accepts, direct SQL corrections a leader runs in the
-- Supabase console, and merges. Verified by updating a row with direct SQL,
-- not through the app (see tests/identity-session.test.ts).
--
-- NOT covered here: a scout aging out of youth membership on their 18th
-- birthday. person_directory.no_longer_youth is COMPUTED from birthdate —
-- nothing writes a row when someone turns 18, so no trigger can fire. Stated
-- gap (Technical Approach): an aged-out scout keeps a Tier 2-S session until
-- their roster row is next touched. A scheduled sweep is the cleaner fix;
-- not urgent since Tier 2-S only grants proof submission.

create or replace function public.trg_bump_session_epoch_on_person_change()
returns trigger language plpgsql as $$
begin
  if (new.active is distinct from old.active and new.active = false)
     or (
       new.inactive_reason is distinct from old.inactive_reason
       and coalesce(nullif(trim(new.inactive_reason), ''), '') <> ''
       and coalesce(nullif(trim(old.inactive_reason), ''), '') = ''
     )
  then
    new.session_epoch := new.session_epoch + 1;
  end if;
  return new;
end;
$$;

create trigger people_session_epoch_bump
  before update on public.people
  for each row execute function public.trg_bump_session_epoch_on_person_change();

create or replace function public.trg_bump_session_epoch_on_scout_deactivate()
returns trigger language plpgsql as $$
declare
  v_household_id bigint;
begin
  if (new.active is distinct from old.active and new.active = false) and new.person_id is not null then
    update public.people set session_epoch = session_epoch + 1 where id = new.person_id;

    -- A departed scout's household loses standing verification too — not just
    -- the scout's own (now-inactive) session.
    select household_id into v_household_id
      from public.household_members where person_id = new.person_id limit 1;
    if v_household_id is not null then
      update public.people p
        set session_epoch = p.session_epoch + 1
        from public.household_members hm
        where hm.person_id = p.id
          and hm.household_id = v_household_id
          and p.id <> new.person_id;
    end if;
  end if;
  return new;
end;
$$;

create trigger scouts_session_epoch_bump
  after update on public.scouts
  for each row execute function public.trg_bump_session_epoch_on_scout_deactivate();
