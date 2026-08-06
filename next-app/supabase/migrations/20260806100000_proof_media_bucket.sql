-- Resource Library Phase 2 — private Storage bucket for proof photos
-- (Plans/Resource-Library.md). Photos of minors: NEVER the public Bunny CDN
-- the news CMS uses — this is the first Supabase Storage bucket in the
-- project. Default-private, no storage.objects policies added (same
-- zero-policy pattern as every RLS-enabled table since D-051): RLS is
-- already enabled on storage.objects by the storage extension, and with no
-- policies only the service-role client (createAdminClient(), which
-- bypasses RLS entirely) can read or write. Leaders view proof photos via
-- short-lived signed URLs generated server-side in admin only
-- (lib/proof-media.ts) — a public URL for this bucket must never exist.
--
-- Retention: proof media deletable 3 months after review, as a routine job
-- (Patrick, 2026-07-21) — tracked as a Backlog item alongside change_requests'
-- identical open retention gap (D-055); no scheduling infra exists in this
-- project yet to build it against.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'proof-media',
  'proof-media',
  false,
  10485760, -- 10 MB
  array['image/jpeg', 'image/png', 'image/heic', 'image/webp']
)
on conflict (id) do nothing;
