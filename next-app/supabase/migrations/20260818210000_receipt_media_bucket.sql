-- Troop Finances Phase 4 — private Storage bucket for reimbursement receipts
-- (Plans/Troop-Finances.md). Same zero-policy pattern as proof-media
-- (20260806100000_proof_media_bucket.sql): default-private, no
-- storage.objects policies, so only the service-role client
-- (createAdminClient(), which bypasses RLS) can read or write. Receipts are
-- financial documents with a family's own purchase history on them — same
-- "never a public URL" posture as proof photos of minors, for the same
-- reason. Leaders view receipts via short-lived signed URLs generated
-- server-side in admin only (lib/receipt-media.ts).
--
-- Wider MIME allowlist than proof-media: a receipt is as often a PDF
-- (emailed order confirmation, printed store receipt scanned to PDF) as a
-- photo.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'receipt-media',
  'receipt-media',
  false,
  10485760, -- 10 MB
  array['image/jpeg', 'image/png', 'image/heic', 'image/webp', 'application/pdf']
)
on conflict (id) do nothing;
