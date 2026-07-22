'use server';

/**
 * Resource Library — public submission actions (Plans/Resource-Library.md).
 *
 * EVERYTHING queues (Patrick, 2026-07-21) — including leader submissions.
 * Inserts land status='pending'; nothing renders publicly until the
 * webmaster approves from /admin/library. The troop inbox gets a heads-up
 * email (same single-fixed-recipient pattern as the /profile flow).
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { FAMILY_COOKIE, signFamilySession } from '@/lib/family-session';
import { gateAudience } from '@/lib/family-access';
import { secretMatches } from '@/lib/signed-cookie';
import { detectHost, inferKind, type LibraryTargetKind } from '@/lib/library';
import { sendEmail, renderEmail } from '@/lib/email';

const SUBMIT_PATH = '/library/submit';
const TROOP_EMAIL = 'bsatroop79bg@gmail.com';

const TARGET_KINDS: ReadonlySet<string> = new Set(['rank_req', 'mb', 'mb_req', 'topic']);

function submitUrl(params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return qs ? `${SUBMIT_PATH}?${qs}` : SUBMIT_PATH;
}

/** Same shared-troop-password gate as Event Signup / Profile — its own action
 *  so the Library doesn't couple to those routes' internals. Preserves the
 *  ?target= prefill across the redirect. */
export async function libraryGateAction(formData: FormData): Promise<void> {
  const password = String(formData.get('password') ?? '');
  const target = String(formData.get('target') ?? '');
  const keep: Record<string, string> = target ? { target } : {};

  if (!process.env.FAMILY_PASSWORD) redirect(submitUrl({ ...keep, gate: 'not-configured' }));
  if (!password) redirect(submitUrl({ ...keep, gate: 'missing' }));
  if (!secretMatches(password, process.env.FAMILY_PASSWORD)) {
    redirect(submitUrl({ ...keep, gate: 'bad-password' }));
  }

  const token = await signFamilySession({ role: 'family', iat: Date.now() });
  const jar = await cookies();
  jar.set(FAMILY_COOKIE.name, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: FAMILY_COOKIE.maxAgeSeconds
  });

  redirect(submitUrl(keep));
}

export async function submitLibraryResourceAction(formData: FormData): Promise<void> {
  const audience = await gateAudience();
  if (!audience) redirect(submitUrl({ gate: 'missing' }));

  const url = String(formData.get('url') ?? '').trim();
  const title = String(formData.get('title') ?? '').trim();
  const why = String(formData.get('why') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const target = String(formData.get('target') ?? '').trim();
  const keep: Record<string, string> = target ? { target } : {};

  if (!url) redirect(submitUrl({ ...keep, err: 'link' }));
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('scheme');
  } catch {
    redirect(submitUrl({ ...keep, err: 'link' }));
  }
  if (!name) redirect(submitUrl({ ...keep, err: 'name' }));

  const supabase = createAdminClient();
  const { data: inserted, error } = await supabase
    .from('library_resources')
    .insert({
      title: title || url,
      blurb: why || null,
      kind: inferKind(url),
      url,
      host: detectHost(url),
      status: 'pending',
      submitted_by_label: name,
      submitter_note: why || null
    })
    .select('id')
    .single();
  if (error || !inserted) redirect(submitUrl({ ...keep, err: 'save' }));

  // Optional placement prefill ('kind:key'). Shape-validated only — the
  // webmaster confirms or corrects placements at review, so a stale key
  // just shows as a suggestion in the queue, never on a public page.
  let placementLabel = 'Let the webmaster decide';
  if (target) {
    const sep = target.indexOf(':');
    const kind = sep > 0 ? target.slice(0, sep) : '';
    const key = sep > 0 ? target.slice(sep + 1) : '';
    if (TARGET_KINDS.has(kind) && key) {
      await supabase.from('library_placements').insert({
        resource_id: inserted.id,
        target_kind: kind as LibraryTargetKind,
        target_key: key
      });
      placementLabel = `${kind}: ${key}`;
    }
  }

  // Single fixed troop-owned recipient — the "nothing sends automatically"
  // rule in lib/email.ts guards family-facing mass mail, which this isn't.
  const { html, text } = renderEmail({
    heading: 'Resource Library submission',
    intro: `${name} suggested a resource for the library. It's waiting in the review queue.`,
    bullets: [
      `Title: ${title || '(untitled — needs one before publish)'}`,
      `Link: ${url}`,
      `Suggested shelf: ${placementLabel}`,
      `Submitted via: ${audience} session`
    ],
    outro: 'Review it from the Leader Workspace → Resource Library.'
  });
  await sendEmail({
    to: [TROOP_EMAIL],
    subject: `Library submission pending review — ${name}`,
    html,
    text,
    confirm: true
  });

  redirect(submitUrl({ sent: '1' }));
}
