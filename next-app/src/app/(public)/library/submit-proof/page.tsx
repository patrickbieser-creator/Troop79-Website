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
import { PageHeader, KickerSep } from '@/app/_components/page-header';
import { PageShell } from '@/app/_components/page-shell';
import { SectionDivider } from '@/app/_components/section-divider';
import { Button } from '@/app/_components/button';
import { FormCard, Field, TextInput, TextArea, FieldHint, FieldError } from '@/app/_components/form';
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
      <PageHeader
        kicker={
          <>
            <Link href="/library">Resource Library</Link>
            <KickerSep />
            {context ? <Link href={context.backHref}>{context.label}</Link> : 'I did this'}
          </>
        }
        title="I did this"
        lede={
          <>
            Send in a photo, a link, or a short write-up showing you completed{' '}
            {context?.label ?? 'this requirement'}. A leader reviews it before it counts —
            usually within a few days.
          </>
        }
      />

      <PageShell width="narrow">
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
      </PageShell>
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
    <FormCard>
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
        <p className={`${styles.flowActions} ${styles.flowActionsCenter}`}>
          <Button variant="secondary" href={backHref}>
            Back to the Requirement
          </Button>
          <Button variant="primary" href="/library">
            Back to the Library
          </Button>
        </p>
      </div>
    </FormCard>
  );
}

function LeaderRedirectCard() {
  return (
    <FormCard>
      <h2 className={styles.flowHeading}>
        Leaders: use Fast Entry
      </h2>
      <FieldHint>
        If you&rsquo;re signing this off yourself, Fast Entry writes it straight to the
        ledger — no review queue needed.
      </FieldHint>
      <p className={styles.stackGap}>
        <Button variant="primary" href="/admin/advancement/fast-entry">
          Open Fast Entry →
        </Button>
      </p>
    </FormCard>
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
    <FormCard>
      <h2 className={styles.flowHeading}>
        Sign in to submit proof as yourself
      </h2>
      {err && ERR_MESSAGES[err] && <FieldError>{ERR_MESSAGES[err]}</FieldError>}
      <FieldHint>
        The shared scout login can&rsquo;t send proof &mdash; it has no way to prove which
        scout is submitting. Sign in with your own email instead (no password to remember)
        and you&rsquo;ll be able to send proof as yourself. Or have a parent sign in and send
        it for you.
      </FieldHint>
      <p className={styles.flowActions}>
        <Button
          variant="primary"
          href={`/signin?next=${encodeURIComponent(`/library/submit-proof?target=${target}`)}`}
        >
          Sign In →
        </Button>
        <Button variant="secondary" href="/library">
          Back to the Library
        </Button>
      </p>
    </FormCard>
  );
}

function GateCard({ target, gate }: { target: string; gate?: string }) {
  const configured = familyGateConfigured();
  return (
    <FormCard>
      <h2 className={styles.flowHeading}>
        Troop sign-in
      </h2>
      <FieldHint>
        One shared password for the whole troop — it&rsquo;s printed in the Bugle each week,
        or ask any leader. Leaders and scouts already signed in to the workspace skip this
        step automatically.
      </FieldHint>
      {gate && GATE_MESSAGES[gate] && <FieldError>{GATE_MESSAGES[gate]}</FieldError>}
      {configured ? (
        <form action={proofGateAction}>
          <input type="hidden" name="target" value={target} />
          <Field label="Troop password">
            <TextInput type="password" name="password" autoComplete="off" />
          </Field>
          <Button variant="primary" type="submit">
            Continue
          </Button>
        </form>
      ) : (
        <FieldError>{GATE_MESSAGES['not-configured']}</FieldError>
      )}
      <FieldHint>
        Prefer not to use the shared password? You can{' '}
        <Link href={`/signin?next=${encodeURIComponent(`/library/submit-proof?target=${target}`)}`}>
          sign in with your email instead
        </Link>
        .
      </FieldHint>
    </FormCard>
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
      <FormCard>
        <FieldError>{ERR_MESSAGES.revoked}</FieldError>
        <p className={styles.stackGapSm}>
          <Button
            variant="primary"
            href={`/signin?next=${encodeURIComponent(`/library/submit-proof?target=${target}`)}`}
          >
            Sign In Again →
          </Button>
        </p>
      </FormCard>
    );
  }

  const party = await loadHouseholdByKey(session.householdKey);

  if (session.subjectKind === 'scout') {
    // No picker at all — the scout IS the session (Phase 0 decision 6: "a
    // scout may only ever claim their own work").
    return (
      <form action={submitProofAction}>
        <FormCard>
          <input type="hidden" name="target" value={target} />
          {err && ERR_MESSAGES[err] && <FieldError>{ERR_MESSAGES[err]}</FieldError>}
          <FieldHint>
            Signed in as <strong>{session.displayName}</strong>
          </FieldHint>
          <ProofFields />
        </FormCard>
      </form>
    );
  }

  const scouts = party?.scouts ?? [];
  return (
    <form action={submitProofAction}>
      <FormCard>
        <input type="hidden" name="target" value={target} />
        {err && ERR_MESSAGES[err] && <FieldError>{ERR_MESSAGES[err]}</FieldError>}

        <FieldHint>
          Signed in as <strong>{session.displayName}</strong> ({party?.label ?? session.displayName}{' '}
          household)
        </FieldHint>

        {scouts.length === 0 ? (
          <FieldError>
            No active scout is on file for this household — ask a leader to add one.
          </FieldError>
        ) : (
          <Field label="Which scout is this for?">
            {scouts.map((s, i) => (
              <label key={s.id} className={styles.scoutPickRow}>
                <input type="radio" name="scoutId" value={s.id} defaultChecked={i === 0} required />
                {s.displayName}
              </label>
            ))}
          </Field>
        )}

        <ProofFields />
      </FormCard>
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
    <FormCard>
      <h2 className={styles.flowHeading}>
        Sign in to submit proof
      </h2>
      {err && ERR_MESSAGES[err] && <FieldError>{ERR_MESSAGES[err]}</FieldError>}
      <FieldHint>
        Submitting proof now needs your own verified sign-in instead of the shared troop
        password — sign in with your email (no password to remember) and you&rsquo;ll be able
        to send proof for your scout.
      </FieldHint>
      <p className={styles.flowActions}>
        <Button
          variant="primary"
          href={`/signin?next=${encodeURIComponent(`/library/submit-proof?target=${target}`)}`}
        >
          Sign In →
        </Button>
        <Button variant="secondary" href="/library">
          Back to the Library
        </Button>
      </p>
    </FormCard>
  );
}

function ProofFields() {
  return (
    <>
      <SectionDivider label="Add one of these" />

      <Field
        label={
          <>
            Photo{' '}
            <span className={styles.labelQualifier}>
              (JPEG, PNG, HEIC, or WebP — 10&nbsp;MB max)
            </span>
          </>
        }
      >
        <TextInput type="file" name="photo" accept="image/jpeg,image/png,image/heic,image/webp" />
      </Field>

      <Field
        label={
          <>
            Or a link{' '}
            <span className={styles.labelQualifier}>
              (a Google Form score screenshot, a video you made, anything)
            </span>
          </>
        }
      >
        <TextInput type="url" name="link_url" placeholder="https://…" />
      </Field>

      <Field
        label={
          <>
            Or a short write-up{' '}
            <span className={styles.labelQualifier}>
              (also doubles as a caption if you added a photo or link)
            </span>
          </>
        }
      >
        <TextArea name="body_md" placeholder="What did you do?" />
      </Field>

      <Button variant="primary" type="submit">
        Send for Review
      </Button>
    </>
  );
}
