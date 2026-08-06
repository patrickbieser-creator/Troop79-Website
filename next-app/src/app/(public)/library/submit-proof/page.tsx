/**
 * /library/submit-proof — "I did this" (Plans/Resource-Library.md Phase 2).
 * Reached only from a requirement/badge page's CTA, which always supplies
 * ?target=rank_req:{key} or ?target=mb_req:{key} — see the module comment
 * in actions.ts for why only the family path actually submits (scout and
 * leader sessions are both refused, Plans/Family-Identity-Auth.md Phase 0).
 */
import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { gateAudience, familyGateConfigured } from '@/lib/family-access';
import { loadHouseholds, type Household } from '@/lib/households';
import { PROFILE_HOUSEHOLD_COOKIE, verifyProfileHouseholdSession } from '@/lib/profile-household-session';
import { resolveRequirementLabel } from '@/lib/library-data';
import {
  proofGateAction,
  pickProofHouseholdAction,
  submitProofAction,
  switchProofHouseholdAction
} from './actions';
import ProofHouseholdPicker from './proof-household-picker';
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
  'scout-disabled': 'Scouts can’t submit proof directly yet — see below for what to do instead.',
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
          <SentConfirmation backHref={context?.backHref ?? '/library'} />
        ) : audience === null ? (
          <GateCard target={target} gate={gate} />
        ) : audience === 'leader' ? (
          <LeaderRedirectCard />
        ) : audience === 'scout' ? (
          <ScoutDisabledCard err={err} />
        ) : (
          <FamilySubmitForm target={target} err={err} />
        )}
      </main>
    </>
  );
}

function SentConfirmation({ backHref }: { backHref: string }) {
  return (
    <div className={styles.formCard}>
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
 * Scout-login sessions are refused server-side (Plans/Family-Identity-Auth.md
 * Phase 0) — this card explains why AND what to do instead, rather than
 * letting a scout fill out the whole form and get refused only on submit
 * (explicit acceptance criterion: "do not dead-end a scout").
 */
function ScoutDisabledCard({ err }: { err?: string }) {
  return (
    <div className={styles.formCard}>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 24, marginBottom: 8 }}>
        Ask a parent, or use a family device
      </h2>
      {err && ERR_MESSAGES[err] && <p className={styles.fieldError}>{ERR_MESSAGES[err]}</p>}
      <p className={styles.fieldHint} style={{ fontSize: 14 }}>
        Proof submissions can&rsquo;t be sent from the scout login right now &mdash; there&rsquo;s
        no way yet to prove which scout is submitting, so this login can&rsquo;t send proof for
        anyone. Show your leader in person, or have a parent sign in on their phone or computer
        with the troop password to send it in for you.
      </p>
      <p style={{ marginTop: 16 }}>
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
    </div>
  );
}

async function FamilySubmitForm({ target, err }: { target: string; err?: string }) {
  const jar = await cookies();
  const householdSession = await verifyProfileHouseholdSession(jar.get(PROFILE_HOUSEHOLD_COOKIE.name)?.value);

  if (!householdSession) {
    const households = await loadHouseholds();
    return (
      <>
        {err && ERR_MESSAGES[err] && <p className={styles.fieldError}>{ERR_MESSAGES[err]}</p>}
        <ProofHouseholdPicker
          households={households}
          target={target}
          pickHouseholdAction={pickProofHouseholdAction}
        />
      </>
    );
  }

  const households = await loadHouseholds();
  const household: Household | undefined = households.find((h) => h.key === householdSession.householdKey);
  const scouts = household?.scouts ?? [];

  return (
    <form className={styles.formCard} action={submitProofAction}>
      <input type="hidden" name="target" value={target} />
      {err && ERR_MESSAGES[err] && <p className={styles.fieldError}>{ERR_MESSAGES[err]}</p>}

      <div className={styles.fieldRow} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className={styles.fieldHint} style={{ margin: 0 }}>
          Logged in as <strong>{householdSession.displayName}</strong>
        </span>
        <button
          type="submit"
          formAction={switchProofHouseholdAction}
          className={styles.btnSecondary}
          style={{ padding: '4px 12px', fontSize: 12 }}
        >
          Switch household
        </button>
      </div>

      {scouts.length === 0 ? (
        <p className={styles.fieldError}>
          No active scout is on file for this household — ask a leader to add one, or{' '}
          switch households above.
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
