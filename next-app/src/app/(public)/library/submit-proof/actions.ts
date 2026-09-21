'use server';

/**
 * Resource Library Phase 2 — proof-of-completion submission
 * (Plans/Resource-Library.md, extended by Plans/Family-Identity-Auth.md).
 * Tier 1 (shared troop password + self-asserted household,
 * lib/profile-household-session.ts) retired 2026-08-21 — Phase 3's
 * leader-issued-code safety net, the reason the fallback stayed alive, was
 * decided against (email is the path forward; a family with no working
 * email is handled out of band). Only ONE path submits now:
 *   - household, subjectKind 'scout' (Tier 2-S) — a VERIFIED scout session.
 *     The picker collapses to the verified scout alone; no form field is
 *     consulted for who this is. This is Phase 0's closed scout path
 *     reopened on a real identity basis, not the free-pick that made Phase 0
 *     necessary — see proofSubmissionAllowedFor() (lib/library.ts).
 *   - household, subjectKind 'adult' (Tier 2) — a VERIFIED adult session;
 *     still validates the posted scoutId against their own household —
 *     multi-scout households still need to say which scout.
 *
 *   - PROXY (Patrick, 2026-09-07) — a leader holding `library.proxy_view`
 *     who is viewing a scout's page AS that scout's proxy (`?viewScout=`)
 *     files the claim on the scout's behalf. The posted scoutId is never
 *     trusted on its own: it is fed to resolveLibraryViewer() as the
 *     viewScout and the branch only opens when the resolver comes back
 *     `{ kind: 'scout', isProxy: true }` for THAT id (lib/library.ts
 *     proxyScoutIdFor). The claim lands in the review queue like any other
 *     — this is not a Fast Entry sign-off — and is labelled leader-filed
 *     (filedByLeaderLine; submitted_via stays 'family', the CHECK constraint
 *     has no 'leader' and there is no from-label column).
 *
 * Plain leader sessions (no proxied scout) are refused — a leader who
 * personally witnesses a requirement being met signs it off directly
 * through Fast Entry (immediate ledger write, no review queue needed) rather
 * than filing a submission for their own later approval. 'family' (the
 * retired Tier 1 audience) and the
 * OLD unverified 'scout' audience (shared SCOUT_PASSWORD login, no
 * per-scout identity) are ALSO refused — the former permanently as of this
 * retirement, the latter permanently since Plans/Family-Identity-Auth.md
 * Phase 0 — both superseded by verified Tier 2/2-S, neither reopened itself.
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
import { secretMatches } from '@/lib/signed-cookie';
import { loadHouseholdByKey } from '@/lib/households';
import {
  filedByLeaderLine,
  proofSubmissionAllowedFor,
  proofSubmissionUnchanged,
  proxyScoutIdFor,
  stripFiledByLine
} from '@/lib/library';
import { actorCanProxyLibrary, resolveLibraryViewer, type LibraryViewer } from '@/lib/library-viewer';
import { resolveAdminActor } from '@/lib/admin-actor';
import { loadPendingSubmission, resolveRequirementLabel } from '@/lib/library-data';
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

export async function submitProofAction(formData: FormData): Promise<void> {
  const audience = await gateAudience();
  const target = String(formData.get('target') ?? '').trim();
  const keep = { target: target || undefined };
  if (!audience) redirect(proofUrl({ ...keep, gate: 'missing' }));

  const supabase = createAdminClient();
  const postedScoutId = String(formData.get('scoutId') ?? '').trim() || null;

  // PROXY check first (module comment): only an admin actor holding
  // `library.proxy_view` can ever resolve to `isProxy: true`, and only for a
  // posted id the resolver itself picked from the active roster — so the
  // posted id selects, it never authorizes. Anyone else skips the resolver
  // entirely (resolveAdminActor is request-cached; no extra cost).
  const actor = await resolveAdminActor();
  const viewer: LibraryViewer =
    actorCanProxyLibrary(actor) && postedScoutId
      ? await resolveLibraryViewer(supabase, postedScoutId)
      : { kind: 'none' };
  const proxyScoutId = proxyScoutIdFor(viewer, postedScoutId);

  // Plain leaders and the OLD unverified scout audience are both refused —
  // see the module comment and proofSubmissionAllowedFor() (lib/library.ts).
  // A direct POST from either session is treated as a shape error, same as
  // any other guard clause here, rather than silently accepted or crashing.
  if (!proofSubmissionAllowedFor(audience, { proxyScoutId, forScoutId: postedScoutId })) {
    redirect(
      proofUrl({
        ...keep,
        err: audience === 'leader' ? 'leader' : audience === 'scout' ? 'scout-disabled' : 'signin-required'
      })
    );
  }

  const parsedTarget = parseTarget(target);
  if (!parsedTarget) redirect(proofUrl({ ...keep, err: 'target' }));

  // Resolve + validate the scout server-side — never trust a posted id alone
  // (same reasoning as cancelSignupAction in events/[id]/actions.ts and
  // submitChangeRequestAction in profile/actions.ts). proofSubmissionAllowedFor()
  // above already guarantees audience === 'household' OR a matching proxy
  // here — Tier 1 (the `else` shape this used to have) was retired 2026-08-21.
  let scoutId: string;
  let scoutName: string;
  let fromLabel: string;
  let submittedVia: 'family' | 'scout';
  /** Leader-filed claims carry their attribution as body_md's first line. */
  let filedByLine: string | null = null;
  /**
   * WHO pressed submit, as a real person — the one thing this row never
   * recorded (20260920210000). `scout_id` says whose requirement it is and
   * `submitted_via` says roughly how it arrived; neither can be written to
   * when the claim is reviewed. The body_md attribution line is prose, not
   * an identity, and must never be parsed back into one.
   * Null stays possible (a session without a person) and means the review
   * notice is skipped, never redirected to somebody else.
   */
  let submittedByPersonId: number | null = null;

  if (proxyScoutId && viewer.kind === 'scout') {
    // Leader on behalf of the proxied scout. Applies whether the leader's
    // session is the legacy leader cookie (audience 'leader') or a verified
    // identity that holds the grant (audience 'household' — the common case,
    // Patrick proxying for a scout who may not even be in his household).
    const leaderName = actor?.label ?? 'A leader';
    scoutId = proxyScoutId;
    scoutName = viewer.scoutName;
    fromLabel = `${leaderName} (leader, on behalf of ${scoutName})`;
    submittedVia = 'family';
    filedByLine = filedByLeaderLine(leaderName, scoutName);
    // The LEADER, not the scout's parents: the notice confirms what you
    // submitted, and a leader who filed a dozen claims at a meeting is
    // exactly who won't remember which one an approval refers to
    // (Patrick, 2026-09-20).
    submittedByPersonId = actor?.personId ?? null;
  } else {
    const session = await getIdentitySessionIfValid();
    if (!session) redirect(proofUrl({ ...keep, err: 'household' }));
    if (!(await isEpochCurrent(supabase, session))) {
      redirect(proofUrl({ ...keep, err: 'revoked' }));
    }
    const party = await loadHouseholdByKey(session.householdKey);
    if (!party) redirect(proofUrl({ ...keep, err: 'household' }));

    // Both remaining shapes are a verified session, so the signed-in person
    // IS the submitter — the scout claiming their own work, or the parent
    // who filed it for them. Not the scout in the latter case: a parent who
    // submits should be the one told what became of it.
    submittedByPersonId = session.personId;

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
      const scout = party.scouts.find((s) => s.id === postedScoutId);
      if (!postedScoutId || !scout) redirect(proofUrl({ ...keep, err: 'scout' }));
      scoutId = scout.id;
      scoutName = scout.displayName;
      fromLabel = `the ${party.label} household (verified sign-in)`;
      submittedVia = 'family';
    }
  }

  // Already in the queue? Stop before the upload. A scout who taps "Send for
  // proof_type is inferred from what was actually filled in — priority
  // photo > link > write-up — rather than a separate radio the family also
  // has to get right. body_md doubles as the required write-up for 'report'
  // and an optional caption for 'photo'/'link'. The written text alone
  // decides the type; a leader-filed attribution line is prepended after.
  // stripFiledByLine: a typed "Filed by …" line can never masquerade as the
  // server-written leader attribution (qa-lead, 2026-09-07).
  const writtenMd = stripFiledByLine(String(formData.get('body_md') ?? '').trim() || null);
  const bodyMd = filedByLine ? (writtenMd ? `${filedByLine}\n\n${writtenMd}` : filedByLine) : writtenMd;
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
  } else if (writtenMd) {
    proofType = 'report';
  } else {
    redirect(proofUrl({ ...keep, err: 'empty' }));
  }

  // Already have a claim waiting on this requirement? There can only be one
  // (requirement_submissions_pending_unique, 20260920190000), so this
  // submission REPLACES it rather than being dropped or erroring.
  //
  // The two cases this has to tell apart look identical at the database and
  // very different to the scout:
  //
  //  - A double-tap. Sending uploads media and emails a leader before the
  //    page moves on, so the button used to sit there looking dead and
  //    scouts tapped again — one requirement reached the queue fifteen
  //    times. Nothing about the submission changed, so: same confirmation,
  //    no write, and no second email to the leaders.
  //  - A genuine redo. The scout wrote a better answer, or added the photo
  //    they forgot, while the first claim was still untriaged. That content
  //    must NOT be silently discarded (qa-lead, 2026-09-20 — dropping it
  //    would be a worse bug than the duplicates). The pending row is updated
  //    in place and the leaders are emailed again, because what they will be
  //    reviewing has changed.
  const pending = await loadPendingSubmission(
    supabase,
    scoutId,
    parsedTarget.kind,
    parsedTarget.key
  );
  let replaced = false;
  if (pending) {
    const unchanged = proofSubmissionUnchanged(pending, {
      proofType: proofType!,
      bodyMd,
      linkUrl,
      newMediaCount: media.length
    });
    if (unchanged) {
      redirect(proofUrl({ ...keep, sent: '1', scout: filedByLine ? scoutId : undefined }));
    }
    const { data: updatedRows, error: updateErr } = await supabase
      .from('requirement_submissions')
      .update({
        proof_type: proofType!,
        body_md: bodyMd,
        link_url: linkUrl,
        // A redo that attaches nothing keeps the media already sent in —
        // "I rewrote my answer" should not silently drop the photo.
        ...(media.length > 0 ? { media } : {}),
        submitted_via: submittedVia,
        // A redo re-attributes the claim: whoever sent this version is the
        // one who gets told what happened to it, even if someone else in the
        // household filed the first attempt.
        submitted_by_person_id: submittedByPersonId
        // created_at is deliberately NOT touched: it orders the oldest-first
        // queue, and a scout who improves a weak answer before anyone has
        // looked at it should not lose their place for doing the right thing
        // (qa-lead, 2026-09-20). If leaders ever need to see that a claim was
        // edited, that wants its own `updated_at`, not a redefined created_at.
      })
      .eq('id', pending.id)
      // A leader deciding this row in the same instant wins — the update then
      // matches nothing rather than reviving a decided claim (same race guard
      // as approveSubmission). `.select()` is what makes that detectable:
      // without it a zero-row update is indistinguishable from a successful
      // one, and the scout would be told "Sent" over content that was never
      // written. No rows back means the old claim is decided, so the unique
      // index no longer blocks a fresh one — fall through and insert.
      .eq('status', 'pending')
      .select('id');
    if (updateErr) redirect(proofUrl({ ...keep, err: 'save' }));
    replaced = (updatedRows?.length ?? 0) > 0;
  }
  if (!replaced) {
    const { error: insertErr } = await supabase.from('requirement_submissions').insert({
      scout_id: scoutId,
      target_kind: parsedTarget.kind,
      target_key: parsedTarget.key,
      proof_type: proofType!,
      body_md: bodyMd,
      link_url: linkUrl,
      media,
      submitted_via: submittedVia,
      submitted_by_person_id: submittedByPersonId,
      status: 'pending'
    });
    // 23505 = the pending-unique index fired, so a claim landed between the
    // check above and this insert — a true millisecond race, which only a
    // double-submit produces, so the two are the same submission. The
    // scout's work IS in the queue: show the confirmation, not an error they
    // can do nothing about. Any media this request uploaded is orphaned in
    // the private bucket — the retention sweep that would collect it is
    // still Backlog (lib/proof-media.ts), so it sits there until that lands.
    if (insertErr?.code === '23505') {
      redirect(proofUrl({ ...keep, sent: '1', scout: filedByLine ? scoutId : undefined }));
    }
    if (insertErr) redirect(proofUrl({ ...keep, err: 'save' }));
  }

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

  // A leader-filed claim keeps `scout` so the confirmation can say whose
  // behalf it was filed on (page.tsx re-resolves the proxy from it).
  redirect(proofUrl({ ...keep, sent: '1', scout: filedByLine ? scoutId : undefined }));
}
