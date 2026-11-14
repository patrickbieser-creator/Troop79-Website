-- Health records, release 1: families upload (Plans/Health-Forms.md, D-492; Patrick 2026-11-13 "build the medical
-- forms upload feature").
--
-- This reverses 20260713000000_demographics.sql ("the forms themselves stay on paper"): Patrick asked for it.
--
-- The files are NOT here. Each is encrypted by the site (AES-256-GCM, a data key per file wrapped by a master key
-- that lives only in Vercel) and stored in a private Bunny storage zone with no pull zone. A row holds where the
-- ciphertext is and its wrapped key; without the master key neither this table nor the storage zone is readable.
--
-- Additive: DB-first deploy. Posture (D-051 / D-239): RLS on with no policies, nothing granted to anon or
-- authenticated. Only the service role (server actions and the streaming route) reads or writes.

create table if not exists public.health_documents (
  id uuid primary key default gen_random_uuid(),
  person_id bigint not null references public.people(id) on delete restrict,
  -- bsa_ab = Annual Health and Medical Record Parts A+B; bsa_c = Part C (physician exam).
  kind text not null check (kind in ('bsa_ab', 'bsa_c', 'insurance', 'immunization')),
  -- A document is one or more pages; an insurance card is page 1 (front) and page 2 (back).
  page integer not null check (page between 1 and 12),
  -- The object's name in the storage zone (a UUID, nothing about the person) and the AAD of its encryption.
  object_path text not null unique check (length(object_path) between 8 and 80),
  key_version integer not null check (key_version > 0),
  wrapped_key text not null check (length(wrapped_key) between 40 and 200),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'application/pdf')),
  bytes integer not null check (bytes > 0),
  uploaded_by_person_id bigint references public.people(id) on delete set null,
  uploaded_at timestamptz not null default now(),
  -- The later of the parent's and the doctor's signature dates; the form is good for 12 months from it.
  effective_on date,
  expires_on date,
  constraint health_documents_slot unique (person_id, kind, page),
  constraint uploaded_at_from_1900 check (uploaded_at >= '1900-01-01'),
  constraint effective_on_from_1900 check (effective_on >= '1900-01-01'),
  constraint expires_on_from_1900 check (expires_on >= '1900-01-01')
);
create index if not exists health_documents_person_idx on public.health_documents (person_id);
alter table public.health_documents enable row level security;
revoke all on public.health_documents from anon, authenticated;

-- Who touched whose records. Separate from audit_log (different audience and retention). The app only ever
-- inserts here (a merge re-points person_id; nothing else updates or deletes). It snapshots person + kind with no foreign key to the document so a row outlives the file it describes.
create table if not exists public.health_access_log (
  id bigint generated always as identity primary key,
  viewer_person_id bigint references public.people(id) on delete set null,
  viewer_name text not null check (length(viewer_name) between 1 and 120),
  person_id bigint not null,
  kind text not null,
  page integer,
  document_id uuid,
  action text not null check (action in ('upload', 'replace', 'delete', 'view', 'download', 'print')),
  -- Which way in: the person's own family, a named leader, or an adult on a trip with them.
  via text not null check (via in ('family', 'named', 'trip')),
  event_id bigint,
  at timestamptz not null default now(),
  constraint at_from_1900 check (at >= '1900-01-01')
);
create index if not exists health_access_log_person_idx on public.health_access_log (person_id, at desc);
alter table public.health_access_log enable row level security;
revoke all on public.health_access_log from anon, authenticated;
revoke all on sequence public.health_access_log_id_seq from anon, authenticated;

-- A merge moves the documents and the log to the surviving person (people_merge_followups fires on the merge).
create or replace function public.health_documents_follow_merge()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  -- The survivor keeps their own page when both have one; the merged person's stays for a leader to sort out.
  update health_documents d set person_id = new.merged_into_person_id
   where d.person_id = old.id
     and not exists (select 1 from health_documents k
                      where k.person_id = new.merged_into_person_id and k.kind = d.kind and k.page = d.page);
  update health_access_log set person_id = new.merged_into_person_id where person_id = old.id;
  return new;
end;
$$;
revoke all on function public.health_documents_follow_merge() from public, anon, authenticated;

drop trigger if exists health_documents_follow_merge on public.people;
create trigger health_documents_follow_merge
  after update of merged_into_person_id on public.people
  for each row
  when (old.merged_into_person_id is null and new.merged_into_person_id is not null)
  execute function public.health_documents_follow_merge();
