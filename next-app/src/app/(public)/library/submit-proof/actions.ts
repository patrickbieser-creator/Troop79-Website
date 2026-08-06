'use server';

/**
 * Resource Library Phase 2 — proof-of-completion submission
 * (Plans/Resource-Library.md).
 *
 * Two gated paths, same as the rest of the Library:
 *   - family: shared troop password + a household bound to THIS device via
 *     lib/profile-household-session.ts (Patrick, 2026-08-06 — reused from
 *     /profile rather than Event Signup's URL-param picker, because proof
 *     submission is a repeated action across many pages over weeks, not a
 *     one-shot transaction). Scout choice is validated server-side against
 *     the bound household — never trust the posted scoutId alone.
 *   - scout: the shared scout admin login. No per-scout identity exists at
 *     that layer (D-037's accepted trust model, same as FAMILY_PASSWORD/
 *     D-027) — the roster picker is a courtesy, not a binding proof; the
 *     leader reviewing the submission is the actual check on who it's from.
 *
 * A leader session is deliberately NOT a third path here: a leader who
 * personally witnesses a requirement being met signs it off directly through
 * Fast Entry (immediate ledger write, no review queue needed) rather than
 * filing a submission for their own later approval.
 *
 * Nothing here touches ledger_entries — that only happens on admin approval
 * (lib/library-data.ts's approveSubmission, the same dup-blocked path Fast
 * Entry uses, D-041).
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { FAMILY_COOKIE, signFamilySession } from '@/lib/family-session';
import { gateAudience } from '@/lib/family-access';
import {
  PROFILE_HOUSEHOLD_COOKIE,
  signProfileHouseholdSession,
  verifyProfileHouseholdSession
} from '@/lib/profile-household-session';
import { secretMatches } from '@/lib/signed-cookie';
import { loadHouseholdByKey } from '@/lib/households';
import { resolveRequirementLabel } from '@/lib/library-data';
import { uploadProofMedia } from '@/lib/proof-media';
import { sendEmail, renderEmail } from '@/lib/email';

const SUBMIT_PROOF_PATH = '/library/submit-proof';
const TROOP_EMAIL = 'bsatroop79bg@gmail.com';
const VALID_TARGET_KINDS: ReadonlySet<string> = new Set(['rank_req', 'mb_req']);

function proofUrl(params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v != null)) as Record<string, string>
  ).toString();
  return qs ? `${SUBMIT_PROOF_PATH}?${qs}` : SUBMIT_PROOF_PATH;
}

function parseTarget(raw: string): { kind: 'rank_req' | 'mb_req'; key: string } | null {
  const sep = raw.indexOf(':');
  const kind = sep > 0 ? raw.slice(0, sep) : '';
  const key = sep > 0 ? raw.slice(sep + 1) : '';
  if (!VALID_TARGET_KINDS.has(kind) || !key) return null;
  return { kind: kind as 'rank_req' | 'mb_req', key };
}

/** Same shared-troop-password gate as /library/submit and /profile — its
 *  own action so this route doesn't couple to those routes' internals
 *  (established convention, see submit/actions.ts). Preserves ?target=. */
export async function proofGateAction(formData: FormData): Promise<void> {
  const password = String(formData.get('password') ?? '');
  const target = String(formData.get('target') ?? '');
  const keep = { target: target || undefined };

  if (!process.env.FAMILY_PASSWORD) redirect(proofUrl({ ...keep, gate: 'not-configured' }));
  if (!password) redirect(proofUrl({ ...keep, gate: 'missing' }));
  if (!secretMatches(password, process.env.FAMILY_PASSWORD)) {
    redirect(proofUrl({ ...keep, gate: 'bad-password' }));
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

  redirect(proofUrl(keep));
}

/** Binds this browser to a household — reuses the SAME cookie /profile sets,
 *  so a family already recognized there is recognized here too. */
export async function pickProofHouseholdAction(formData: FormData): Promise<void> {
  const jar = await cookies();
  const family = await gateAudience();
  const target = String(formData.get('target') ?? '');
  const keep = { target: target || undefined };
  if (!family) redirect(proofUrl({ ...keep, gate: 'missing' }));

  const householdKey = String(formData.get('householdKey') ?? '');
  const household = await loadHouseholdByKey(householdKey);
  if (!household) redirect(proofUrl({ ...keep, err: 'household' }));

  const token = await signProfileHouseholdSession({
    householdKey: household.key,
    displayName: household.label,
    iat: Date.now()
  });
  jar.set(PROFILE_HOUSEHOLD_COOKIE.name, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: PROFILE_HOUSEHOLD_COOKIE.maxAgeSeconds
  });

  redirect(proofUrl(keep));
}

/** Clears ONLY the household cookie (keeps the family gate) so a different
 *  household can be picked without re-entering the troop password — the
 *  "method for changing the household" Patrick asked for (2026-08-06). Not
 *  a full sign-out; profile/actions.ts's profileSignOutAction is that. */
export async function switchProofHouseholdAction(formData: FormData): Promise<void> {
  const jar = await cookies();
  jar.delete(PROFILE_HOUSEHOLD_COOKIE.name);
  const target = String(formData.get('target') ?? '');
  redirect(proofUrl({ target: target || undefined }));
}

export async function submitProofAction(formData: FormData): Promise<void> {
  const audience = await gateAudience();
  const target = String(formData.get('target') ?? '').trim();
  const keep = { target: target || undefined };
  if (!audience) redirect(proofUrl({ ...keep, gate: 'missing' }));
  // Leaders sign requirements off directly through Fast Entry — see the
  // module comment. A direct POST from a leader session is treated as a
  // shape error rather than silently accepted or crashing.
  if (audience === 'leader') redirect(proofUrl({ ...keep, err: 'leader' }));

  const parsedTarget = parseTarget(target);
  if (!parsedTarget) redirect(proofUrl({ ...keep, err: 'target' }));

  const scoutId = String(formData.get('scoutId') ?? '').trim();
  if (!scoutId) redirect(proofUrl({ ...keep, err: 'scout' }));

  const supabase = createAdminClient();

  // Resolve + validate the scout server-side — never trust the posted id
  // alone (same reasoning as cancelSignupAction in events/[id]/actions.ts
  // and submitChangeRequestAction in profile/actions.ts).
  let scoutName: string | null = null;
  let fromLabel: string;
  if (audience === 'family') {
    const jar = await cookies();
    const household = await verifyProfileHouseholdSession(jar.get(PROFILE_HOUSEHOLD_COOKIE.name)?.value);
    if (!household) redirect(proofUrl({ ...keep, err: 'household' }));
    const party = await loadHouseholdByKey(household.householdKey);
    const scout = party?.scouts.find((s) => s.id === scoutId);
    if (!party || !scout) redirect(proofUrl({ ...keep, err: 'scout' }));
    scoutName = scout.displayName;
    fromLabel = party.label;
  } else {
    const { data: scoutRow } = await supabase
      .from('scouts')
      .select('id, display_name')
      .eq('id', scoutId)
      .eq('active', true)
      .maybeSingle();
    if (!scoutRow) redirect(proofUrl({ ...keep, err: 'scout' }));
    scoutName = (scoutRow as { display_name: string }).display_name;
    fromLabel = 'Scout login';
  }

  // proof_type is inferred from what was actually filled in — priority
  // photo > link > write-up — rather than a separate radio the family also
  // has to get right. body_md doubles as the required write-up for 'report'
  // and an optional caption for 'photo'/'link'.
  const bodyMd = String(formData.get('body_md') ?? '').trim() || null;
  const linkUrlRaw = String(formData.get('link_url') ?? '').trim();
  const file = formData.get('photo');

  let proofType: 'photo' | 'report' | 'link';
  let linkUrl: string | null = null;
  let media: { path: string; contentType: string }[] = [];

  if (file instanceof File && file.size > 0) {
    proofType = 'photo';
    const { entry, error } = await uploadProofMedia(supabase, file, scoutId);
    if (error || !entry) redirect(proofUrl({ ...keep, err: 'photo' }));
    media = [entry!];
  } else if (linkUrlRaw) {
    try {
      const parsed = new URL(linkUrlRaw);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('scheme');
    } catch {
      redirect(proofUrl({ ...keep, err: 'link' }));
    }
    proofType = 'link';
    linkUrl = linkUrlRaw;
  } else if (bodyMd) {
    proofType = 'report';
  } else {
    redirect(proofUrl({ ...keep, err: 'empty' }));
  }

  const { error: insertErr } = await supabase.from('requirement_submissions').insert({
    scout_id: scoutId,
    target_kind: parsedTarget.kind,
    target_key: parsedTarget.key,
    proof_type: proofType!,
    body_md: bodyMd,
    link_url: linkUrl,
    media,
    submitted_via: audience === 'family' ? 'family' : 'scout',
    status: 'pending'
  });
  if (insertErr) redirect(proofUrl({ ...keep, err: 'save' }));

  const resolved = await resolveRequirementLabel(supabase, parsedTarget.kind, parsedTarget.key);
  const reqLabel = resolved?.label
    ? `${resolved.code} — ${resolved.label.slice(0, 80)}`
    : `${parsedTarget.kind === 'rank_req' ? 'Rank requirement' : 'Merit badge requirement'} ${parsedTarget.key}`;

  // Field names only — no photo, no write-up text — same PII-in-email rule
  // as submitChangeRequestAction (email is a weaker security boundary than
  // the DB). The leader reviews the actual submission from the Proof Queue.
  const { html, text } = renderEmail({
    heading: 'Proof-of-completion submission',
    intro: `${scoutName ?? scoutId} submitted proof for a requirement through the Resource Library. It's waiting in the review queue.`,
    bullets: [
      `Scout: ${scoutName ?? scoutId}`,
      `Requirement: ${reqLabel}`,
      `Proof type: ${proofType!}`,
      `Submitted via: ${fromLabel}`
    ],
    outro: 'Review it from the Leader Workspace → Resource Library → Proof Queue.'
  });
  await sendEmail({
    to: [TROOP_EMAIL],
    subject: `Proof submission pending review — ${scoutName ?? scoutId}`,
    html,
    text,
    confirm: true
  });

  redirect(proofUrl({ ...keep, sent: '1' }));
}
