/**
 * /library/submit-proof — "I did this" (Plans/Resource-Library.md Phase 2,
 * extended by Plans/Family-Identity-Auth.md Phase 2). Reached only from a
 * requirement/badge page's CTA, which always supplies
 * ?target=rank_req:{key} or ?target=mb_req:{key} — see actions.ts's module
 * comment for the two paths that actually submit (verified scout, verified
 * adult) and the ones that don't (leader, the OLD unverified scout login,
 * and 'family' — the Tier 1 troop-password fallback, retired 2026-08-21).
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { gateAudience, familyGateConfigured, getIdentitySessionIfValid } from '@/lib/family-access';
import { isEpochCurrent } from '@/lib/identity-session';
import { loadHouseholdByKey } from '@/lib/households';
import { resolveRequirementLabel } from '@/lib/library-data';
import { proofGateAction, submitProofAction } from './actions';
import { TrackOnMount } from '../../_components/track-on-mount';
import styles from '../library.module.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Submit Proof — Scout Troop 79'
};

const GATE_MESSAGES: Record<string, string> = {
  missing: 'Please enter the troop password.',
  'bad-password': 'That password didn’t match — it’s printed in each week’s Bugle, or ask any leader.',
  'not-configured': 'The family password isn’t set up on this server yet — ask the webmaster.'
};

const ERR_MESSAGES: Record<string, string> = {
  household: 'Pick a household to continue.',
  scout: 'Pick a scout to continue.',
  target: 'This link is missing which requirement it’s for — go back and try again.',
  leader: 'Leaders sign requirements off directly through Fast Entry.',
  'scout-disabled': 'Scouts can’t submit proof directly this way — see below for what to do instead.',
  'signin-required': 'The troop password alone can no longer submit proof — sign in with your email below.',
  revoked: 'Your sign-in has been revoked — please sign in again.',
  photo: 'That photo could not be uploaded — try a different file.',
  link: 'A working link (starting with http) is required.',
  empty: 'Add a photo, a link, or a short write-up.',
  save: 'Something went wrong saving your submission — try again.'
};

interface RequirementContext {
  label: string;
  backHref: string;
}

async function loadRequirementContext(target: string): Promise<RequirementContext | null> {
  const sep = target.indexOf(':');
  const kind = sep > 0 ? target.slice(0, sep) : '';
  const key = sep > 0 ? target.slice(sep + 1) : '';
  if ((kind !== 'rank_req' && kind !== 'mb_req') || !key) return null;

  const supabase = createAdminClient();
  const resolved = await resolveRequirementLabel(supabase, kind, key);
  if (!resolved) return { label: `Requirement ${key}`, backHref: '/library' };

  if (kind === 'rank_req') {
    return {
      label: resolved.label ? `${resolved.code} — ${resolved.label}` : `Requirement ${resolved.code}`,
      backHref: `/library/rank/${resolved.parentId}/${encodeURIComponent(resolved.code)}`
    };
  }
  return {
    label: resolved.label ? `${resolved.code} — ${resolved.label}` : `Requirement ${resolved.code}`,
    backHref: `/library/mb/${resolved.parentId}`
  };
}

export default async function SubmitProofPage({
  searchParams
}: {
  searchParams: Promise<{ target?: string; sent?: string; gate?: string; err?: string }>;
}) {
  const { target, sent, gate, err } = await searchParams;
  if (!target) notFound();

  const context = await loadRequirementContext(target);
  const audience = await gateAudience();

  return (
    <>
      <div className={styles.pageHeader}>
        <p className={styles.kicker}>
          <Link href="/library">Resource Library</Link>
          <span className={styles.kickerSep}>·</span>
          {context ? <Link href={context.backHref}>{context.label}</Link> : 'I did this'}
        </p>
        <h1 className={styles.pageTitle}>I did this</h1>
        <p className={styles.pageLede}>
          Send in a photo, a link, or a short write-up showing you completed{' '}
          {context?.label ?? 'this requirement'}. A leader reviews it before it counts —
          usually within a few days.
        </p>
        <div className={styles.headRule} />
      </div>

      <main className={`${styles.main} ${styles.mainNarrow}`} style={{ maxWidth: 720 }}>
        {sent === '1' ? (
          <SentConfirmation
            backHref={context?.backHref ?? '/library'}
            targetKind={target.startsWith('mb_req:') ? 'mb_req' : 'rank_req'}
          />
        ) : audience === null ? (
          <GateCard target={target} gate={gate} />
        ) : audience === 'leader' ? (
          <LeaderRedirectCard />
        ) : audience === 'scout' ? (
          <ScoutDisabledCard err={err} target={target} />
        ) : audience === 'household' ? (
          <VerifiedSubmitForm target={target} err={err} />
        ) : (
          <SignInRequiredCard target={target} err={err} />
        )}
      </main>
    </>
  );
}

function SentConfirmation({
  backHref,
  targetKind
}: {
  backHref: string;
  targetKind: 'rank_req' | 'mb_req';
}) {
  return (
    <div className={styles.formCard}>
      <TrackOnMount event="proof_submitted" params={{ target_kind: targetKind }} />
      <div className={styles.confirmDone}>
        <div className={styles.bigCheck} aria-hidden="true">
          ✓
        </div>
        <h2 className={styles.confirmTitle}>Sent for review</h2>
        <p className={styles.confirmText}>
          A leader will look this over and either sign it off or send back a note if
          anything&rsquo;s missing.
        </p>
        <p style={{ marginTop: 16, display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link className={styles.btnSecondary} href={backHref}>
            Back to the Requirement
          </Link>
          <Link className={styles.btnPrimary} href="/library">
            Back to the Library
          </Link>
        </p>
      </div>
    </div>
  );
}

function LeaderRedirectCard() {
  return (
    <div className={styles.formCard}>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 24, marginBottom: 8 }}>
        Leaders: use Fast Entry
      </h2>
      <p className={styles.fieldHint} style={{ fontSize: 14 }}>
        If you&rsquo;re signing this off yourself, Fast Entry writes it straight to the
        ledger — no review queue needed.
      </p>
      <p style={{ marginTop: 16 }}>
        <Link className={styles.btnPrimary} href="/admin/advancement/fast-entry">
          Open Fast Entry →
        </Link>
      </p>
    </div>
  );
}

/**
 * The OLD unverified scout-login path is refused server-side, permanently
 * (Plans/Family-Identity-Auth.md Phase 0) — this card explains why AND
 * points at the REAL fix now available (Phase 2): sign in with a verified
 * scout identity via /signin, which collapses the picker to just yourself
 * instead of any active scout. Not a dead end (explicit acceptance
 * criterion) — there's now an actual path forward, not just "ask a parent."
 */
function ScoutDisabledCard({ err, target }: { err?: string; target: string }) {
  return (
    <div className={styles.formCard}>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 24, marginBottom: 8 }}>
        Sign in to submit proof as yourself
      </h2>
      {err && ERR_MESSAGES[err] && <p className={styles.fieldError}>{ERR_MESSAGES[err]}</p>}
      <p className={styles.fieldHint} style={{ fontSize: 14 }}>
        The shared scout login can&rsquo;t send proof &mdash; it has no way to prove which
        scout is submitting. Sign in with your own email instead (no password to remember)
        and you&rsquo;ll be able to send proof as yourself. Or have a parent sign in and send
        it for you.
      </p>
      <p style={{ marginTop: 16, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <Link
          className={styles.btnPrimary}
          href={`/signin?next=${encodeURIComponent(`/library/submit-proof?target=${target}`)}`}
        >
          Sign In →
        </Link>
        <Link className={styles.btnSecondary} href="/library">
          Back to the Library
        </Link>
      </p>
    </div>
  );
}

function GateCard({ target, gate }: { target: string; gate?: string }) {
  const configured = familyGateConfigured();
  return (
    <div className={styles.formCard}>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 24, marginBottom: 8 }}>
        Troop sign-in
      </h2>
      <p className={styles.fieldHint} style={{ marginBottom: 18, fontSize: 14 }}>
        One shared password for the whole troop — it&rsquo;s printed in the Bugle each week,
        or ask any leader. Leaders and scouts already signed in to the workspace skip this
        step automatically.
      </p>
      {gate && GATE_MESSAGES[gate] && <p className={styles.fieldError}>{GATE_MESSAGES[gate]}</p>}
      {configured ? (
        <form action={proofGateAction}>
          <input type="hidden" name="target" value={target} />
          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel} htmlFor="password">
              Troop password
            </label>
            <input
              className={styles.textInput}
              type="password"
              id="password"
              name="password"
              autoComplete="off"
            />
          </div>
          <button className={styles.btnPrimary} type="submit">
            Continue
          </button>
        </form>
      ) : (
        <p className={styles.fieldError}>{GATE_MESSAGES['not-configured']}</p>
      )}
      <p className={styles.fieldHint} style={{ marginTop: 14, fontSize: 13 }}>
        Prefer not to use the shared password? You can{' '}
        <Link href={`/signin?next=${encodeURIComponent(`/library/submit-proof?target=${target}`)}`}>
          sign in with your email instead
        </Link>
        .
      </p>
    </div>
  );
}

/**
 * Tier 2 (verified adult) or Tier 2-S (verified scout) — Plans/Family-Identity-Auth.md
 * Phase 2. Preferred over the Tier 1 picker whenever a verified session
 * exists; a scout session collapses straight to themselves with no picker at
 * all (Phase 0's closed path, reopened on a real identity basis).
 */
async function VerifiedSubmitForm({ target, err }: { target: string; err?: string }) {
  const session = await getIdentitySessionIfValid();
  if (!session) {
    // Shouldn't happen — gateAudience() already said 'household' — but a
    // signature that verifies and then vanishes between calls (cookie
    // cleared mid-request) degrades to the sign-in prompt, not a crash.
    return <GateCard target={target} gate="missing" />;
  }

  const supabase = createAdminClient();
  const epochOk = await isEpochCurrent(supabase, session);
  if (!epochOk) {
    return (
      <div className={styles.formCard}>
        <p className={styles.fieldError}>{ERR_MESSAGES.revoked}</p>
        <p style={{ marginTop: 12 }}>
          <Link
            className={styles.btnPrimary}
            href={`/signin?next=${encodeURIComponent(`/library/submit-proof?target=${target}`)}`}
          >
            Sign In Again →
          </Link>
        </p>
      </div>
    );
  }

  const party = await loadHouseholdByKey(session.householdKey);

  if (session.subjectKind === 'scout') {
    // No picker at all — the scout IS the session (Phase 0 decision 6: "a
    // scout may only ever claim their own work").
    return (
      <form className={styles.formCard} action={submitProofAction}>
        <input type="hidden" name="target" value={target} />
        {err && ERR_MESSAGES[err] && <p className={styles.fieldError}>{ERR_MESSAGES[err]}</p>}
        <p className={styles.fieldHint} style={{ marginBottom: 0 }}>
          Signed in as <strong>{session.displayName}</strong>
        </p>
        <ProofFields />
      </form>
    );
  }

  const scouts = party?.scouts ?? [];
  return (
    <form className={styles.formCard} action={submitProofAction}>
      <input type="hidden" name="target" value={target} />
      {err && ERR_MESSAGES[err] && <p className={styles.fieldError}>{ERR_MESSAGES[err]}</p>}

      <p className={styles.fieldHint} style={{ margin: 0 }}>
        Signed in as <strong>{session.displayName}</strong> ({party?.label ?? session.displayName}{' '}
        household)
      </p>

      {scouts.length === 0 ? (
        <p className={styles.fieldError}>
          No active scout is on file for this household — ask a leader to add one.
        </p>
      ) : (
        <div className={styles.fieldRow}>
          <span className={styles.fieldLabel}>Which scout is this for?</span>
          {scouts.map((s, i) => (
            <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: i === 0 ? 4 : 8 }}>
              <input type="radio" name="scoutId" value={s.id} defaultChecked={i === 0} required />
              {s.displayName}
            </label>
          ))}
        </div>
      )}

      <ProofFields />
    </form>
  );
}

/**
 * Shown for the 'family' audience (troop password only, no verified
 * identity) — Tier 1's self-asserted household picker retired 2026-08-21
 * (Plans/Family-Identity-Auth.md Phase 3's leader-issued-code safety net,
 * the reason the fallback stayed alive, was decided against — email is the
 * path forward). The troop password still gates other Library pages; it
 * just no longer submits proof on its own.
 */
function SignInRequiredCard({ target, err }: { target: string; err?: string }) {
  return (
    <div className={styles.formCard}>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 24, marginBottom: 8 }}>
        Sign in to submit proof
      </h2>
      {err && ERR_MESSAGES[err] && <p className={styles.fieldError}>{ERR_MESSAGES[err]}</p>}
      <p className={styles.fieldHint} style={{ fontSize: 14 }}>
        Submitting proof now needs your own verified sign-in instead of the shared troop
        password — sign in with your email (no password to remember) and you&rsquo;ll be able
        to send proof for your scout.
      </p>
      <p style={{ marginTop: 16, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <Link
          className={styles.btnPrimary}
          href={`/signin?next=${encodeURIComponent(`/library/submit-proof?target=${target}`)}`}
        >
          Sign In →
        </Link>
        <Link className={styles.btnSecondary} href="/library">
          Back to the Library
        </Link>
      </p>
    </div>
  );
}

function ProofFields() {
  return (
    <>
      <div className={styles.sectionDivider} style={{ margin: '22px 0 14px' }}>
        <span className={styles.divLabel}>Add one of these</span>
        <span className={styles.divRule} aria-hidden="true" />
      </div>

      <div className={styles.fieldRow}>
        <label className={styles.fieldLabel} htmlFor="photo">
          Photo{' '}
          <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>
            (JPEG, PNG, HEIC, or WebP — 10&nbsp;MB max)
          </span>
        </label>
        <input className={styles.textInput} type="file" id="photo" name="photo" accept="image/jpeg,image/png,image/heic,image/webp" />
      </div>

      <div className={styles.fieldRow}>
        <label className={styles.fieldLabel} htmlFor="link_url">
          Or a link{' '}
          <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>
            (a Google Form score screenshot, a video you made, anything)
          </span>
        </label>
        <input className={styles.textInput} type="url" id="link_url" name="link_url" placeholder="https://…" />
      </div>

      <div className={styles.fieldRow}>
        <label className={styles.fieldLabel} htmlFor="body_md">
          Or a short write-up{' '}
          <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>
            (also doubles as a caption if you added a photo or link)
          </span>
        </label>
        <textarea className={styles.textArea} id="body_md" name="body_md" placeholder="What did you do?" />
      </div>

      <button className={styles.btnPrimary} type="submit">
        Send for Review
      </button>
    </>
  );
}
