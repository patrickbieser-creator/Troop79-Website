import { describe, it, expect, afterEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { adminClient } from './helpers/admin-client';
import { PROOF_MEDIA_BUCKET, signedProofMediaUrl, uploadProofMedia } from '../src/lib/proof-media';

/**
 * Proof-media bucket (Plans/Resource-Library.md Phase 2) — the invariant
 * that matters: photos of minors are reachable ONLY via a service-role
 * upload and a server-generated signed URL, never a public one. Same
 * approach as resource-library.test.ts: real local Postgres/Storage, no
 * mocks.
 */

describe('proof media storage', () => {
  const uploadedPaths: string[] = [];

  afterEach(async () => {
    if (uploadedPaths.length > 0) {
      const admin = adminClient();
      await admin.storage.from(PROOF_MEDIA_BUCKET).remove(uploadedPaths);
      uploadedPaths.length = 0;
    }
  });

  it('Leader_ReviewingProof_GetsASignedUrl_ForAnUploadedPhoto', async () => {
    const admin = adminClient();
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'proof.jpg', { type: 'image/jpeg' });

    const { entry, error } = await uploadProofMedia(admin, file, 'vitest-proof-media');
    expect(error).toBeNull();
    expect(entry).not.toBeNull();
    if (entry) uploadedPaths.push(entry.path);

    const url = await signedProofMediaUrl(admin, entry!.path);
    expect(url).toMatch(/^https?:\/\//);

    const res = await fetch(url!);
    expect(res.status).toBe(200);
  });

  it('Submission_RejectsOversizedOrWrongTypePhoto_BeforeUpload', async () => {
    const admin = adminClient();
    const wrongType = new File([new Uint8Array([1, 2, 3])], 'proof.gif', { type: 'image/gif' });
    const { entry, error } = await uploadProofMedia(admin, wrongType, 'vitest-proof-media');
    expect(entry).toBeNull();
    expect(error).not.toBeNull();
  });

  it('AnonKey_CannotReadOrWrite_ProofMediaBucket', async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) throw new Error('anon key env missing — is .env.local present?');
    const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

    // Seed one object so a failed/empty read proves RLS, not an empty bucket.
    const admin = adminClient();
    const file = new File([new Uint8Array([9, 9, 9])], 'probe.jpg', { type: 'image/jpeg' });
    const { entry } = await uploadProofMedia(admin, file, 'vitest-proof-media');
    if (entry) uploadedPaths.push(entry.path);

    const list = await anon.storage.from(PROOF_MEDIA_BUCKET).list('vitest-proof-media');
    expect(list.data ?? []).toHaveLength(0);

    const upload = await anon.storage
      .from(PROOF_MEDIA_BUCKET)
      .upload(`vitest-proof-media/anon-${Date.now()}.jpg`, file, { contentType: 'image/jpeg' });
    expect(upload.error).not.toBeNull();
  });
});
