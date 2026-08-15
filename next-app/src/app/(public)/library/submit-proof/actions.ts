'use server';

/**
 * Resource Library Phase 2 — proof-of-completion submission
 * (Plans/Resource-Library.md, extended by Plans/Family-Identity-Auth.md).
 *
 * THREE gated paths now submit, in preference order (Patrick, 2026-08-06):
 *   - household, subjectKind 'scout' (Tier 2-S) — a VERIFIED scout session.
 *     The picker collapses to the verified scout alone; no form field is
 *     consulted for who this is. This is Phase 0's closed scout path
 *     reopened on a real identity basis, not the free-pick that made Phase 0
 *     necessary — see proofSubmissionAllowedFor() (lib/library.ts).
 *   - household, subjectKind 'adult' (Tier 2) — a VERIFIED adult session;
 *     prefers their own household (session.householdKey) over the Tier 1
 *     picker below, but still validates the posted scoutId against it —
 *     multi-scout households still need to say which scout.
 *   - family (Tier 1, unverified) — shared troop password + a household
 *     bound to THIS device via lib/profile-household-session.ts. Falls back
 *     to here only when no verified session exists. Scout choice is
 *     validated server-side against the bound household — never trust the
 *     posted scoutId alone.
 *
 * Leader sessions are refused — a leader who personally witnesses a
 * requirement being met signs it off directly through Fast Entry (immediate
 * ledger write, no review queue needed) rather than filing a submission for
 * their own later approval. The OLD unverified 'scout' audience (shared
 * SCOUT_PASSWORD login, no per-scout identity) is ALSO still refused,
 * permanently (Plans/Family-Identity-Auth.md Phase 0) — it is superseded by
 * verified Tier 2-S, not reopened itself.
 *
 * Nothing here touches ledger_entries — that only happens on admin approval
 * (lib/library-data.ts's approveSubmission, the same dup-blocked path Fast
 * Entry uses, D-041).
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { FAMILY_COOKIE, signFamilySession } from '@/lib/family-session';
import { gateAudience, getIdentitySessionIfValid } from '@/lib/family-access';
import { isEpochCurrent } from '@/lib/identity-session';
import {
  PROFILE_HOUSEHOLD_COOKIE,
  signProfileHouseholdSession,
  verifyProfileHouseholdSession
} from '@/lib/profile-household-session';
import { secretMatches } from '@/lib/signed-cookie';
import { loadHouseholdByKey } from '@/lib/households';
import { proofSubmissionAllowedFor } from '@/lib/library';
import { resolveRequirementLabel } from '@/lib/library-data';
import { uploadProofMedia } from '@/lib/proof-media';
import { sendEmail, renderEmail, troopEmail } from '@/lib/email';

const SUBMIT_PROOF_PATH = '/library/submit-proof';
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
  // Leaders and the OLD unverified scout audience are both refused — see the
  // module comment and proofSubmissionAllowedFor() (lib/library.ts). A
  // direct POST from either session is treated as a shape error, same as any
  // other guard clause here, rather than silently accepted or crashing.
  if (!proofSubmissionAllowedFor(audience)) {
    redirect(proofUrl({ ...keep, err: audience === 'leader' ? 'leader' : 'scout-disabled' }));
  }

  const parsedTarget = parseTarget(target);
  if (!parsedTarget) redirect(proofUrl({ ...keep, err: 'target' }));

  const supabase = createAdminClient();

  // Resolve + validate the scout server-side — never trust a posted id alone
  // (same reasoning as cancelSignupAction in events/[id]/actions.ts and
  // submitChangeRequestAction in profile/actions.ts). Three shapes, in
  // preference order — see module header.
  let scoutId: string;
  let scoutName: string;
  let fromLabel: string;
  let submittedVia: 'family' | 'scout';

  if (audience === 'household') {
    const session = await getIdentitySessionIfValid();
    if (!session) redirect(proofUrl({ ...keep, err: 'household' }));
    if (!(await isEpochCurrent(supabase, session))) {
      redirect(proofUrl({ ...keep, err: 'revoked' }));
    }
    const party = await loadHouseholdByKey(session.householdKey);
    if (!party) redirect(proofUrl({ ...keep, err: 'household' }));

    if (session.subjectKind === 'scout') {
      // Tier 2-S: the picker collapses to the verified scout alone — no
      // form field consulted for who this is, by design (Plans/Family-Identity-Auth.md
      // decision 6: "a scout may only ever claim their own work").
      const self = party.scouts.find((s) => s.personId === session.personId);
      if (!self) redirect(proofUrl({ ...keep, err: 'scout' }));
      scoutId = self.id;
      scoutName = self.displayName;
      fromLabel = 'a verified scout sign-in';
      submittedVia = 'scout';
    } else {
      const postedScoutId = String(formData.get('scoutId') ?? '').trim();
      const scout = party.scouts.find((s) => s.id === postedScoutId);
      if (!postedScoutId || !scout) redirect(proofUrl({ ...keep, err: 'scout' }));
      scoutId = scout.id;
      scoutName = scout.displayName;
      fromLabel = `the ${party.label} household (verified sign-in)`;
      submittedVia = 'family';
    }
  } else {
    // Tier 1 fallback (unverified family password + self-asserted household).
    const postedScoutId = String(formData.get('scoutId') ?? '').trim();
    if (!postedScoutId) redirect(proofUrl({ ...keep, err: 'scout' }));
    const jar = await cookies();
    const household = await verifyProfileHouseholdSession(jar.get(PROFILE_HOUSEHOLD_COOKIE.name)?.value);
    if (!household) redirect(proofUrl({ ...keep, err: 'household' }));
    const party = await loadHouseholdByKey(household.householdKey);
    const scout = party?.scouts.find((s) => s.id === postedScoutId);
    if (!party || !scout) redirect(proofUrl({ ...keep, err: 'scout' }));
    scoutId = scout.id;
    scoutName = scout.displayName;
    fromLabel = `the ${party.label} household`;
    submittedVia = 'family';
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
    submitted_via: submittedVia,
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
    intro: `${scoutName} submitted proof for a requirement through the Resource Library. It's waiting in the review queue.`,
    bullets: [
      `Scout: ${scoutName}`,
      `Requirement: ${reqLabel}`,
      `Proof type: ${proofType!}`,
      `Submitted via: ${fromLabel}`
    ],
    outro: 'Review it from the Leader Workspace → Resource Library → Proof Queue.'
  });
  await sendEmail({
    to: [troopEmail()],
    subject: `Proof submission pending review — ${scoutName}`,
    html,
    text,
    confirm: true
  });

  redirect(proofUrl({ ...keep, sent: '1' }));
}
