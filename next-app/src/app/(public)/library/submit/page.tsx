/**
 * /library/submit — suggest a resource. Gated by any troop credential
 * (leader/scout admin session passes automatically; otherwise the shared
 * family password, same gate as Event Signup / Profile). Everything queues
 * for webmaster review — nothing publishes from here.
 */
import Link from 'next/link';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/server';
import { gateAudience, familyGateConfigured } from '@/lib/family-access';
import { LEADER_COOKIE, verifySession } from '@/lib/leader-session';
import type { LibraryTopic, MeritBadge, Rank } from '@/lib/supabase/types';
import { rankReqKey } from '@/lib/library';
import { libraryGateAction, submitLibraryResourceAction } from './actions';
import styles from '../library.module.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Suggest a Resource — Scout Troop 79',
  description: 'Send a video, article, document, or link to the troop Resource Library.'
};

interface TargetOptions {
  topics: LibraryTopic[];
  ranks: Rank[];
  rankReqs: Map<string, { code: string; label: string }[]>;
  mbs: MeritBadge[];
}

async function loadTargetOptions(): Promise<TargetOptions> {
  const supabase = createAdminClient();
  const [topicsRes, ranksRes, reqsRes, mbsRes] = await Promise.all([
    supabase.from('library_topics').select('*').is('retired_at', null).order('sort_order'),
    supabase.from('ranks').select('*').order('sort_order'),
    supabase
      .from('rank_requirements')
      .select('rank_id, code, label')
      .is('parent_id', null)
      .order('sort_order'),
    supabase.from('merit_badges').select('*').order('name')
  ]);
  const rankReqs = new Map<string, { code: string; label: string }[]>();
  for (const r of (reqsRes.data ?? []) as { rank_id: string; code: string; label: string }[]) {
    const list = rankReqs.get(r.rank_id) ?? [];
    list.push({ code: r.code, label: r.label });
    rankReqs.set(r.rank_id, list);
  }
  return {
    topics: (topicsRes.data ?? []) as LibraryTopic[],
    ranks: (ranksRes.data ?? []) as Rank[],
    rankReqs,
    mbs: (mbsRes.data ?? []) as MeritBadge[]
  };
}

const GATE_MESSAGES: Record<string, string> = {
  missing: 'Please enter the troop password.',
  'bad-password': 'That password didn’t match — it’s printed in each week’s Bugle, or ask any leader.',
  'not-configured': 'The family password isn’t set up on this server yet — ask the webmaster.'
};

const ERR_MESSAGES: Record<string, string> = {
  link: 'A working link (starting with http) is required.',
  name: 'Tell us who you are so the webmaster can follow up.',
  save: 'Something went wrong saving your suggestion — try again.'
};

export default async function LibrarySubmitPage({
  searchParams
}: {
  searchParams: Promise<{ target?: string; sent?: string; gate?: string; err?: string }>;
}) {
  const { target, sent, gate, err } = await searchParams;
  const audience = await gateAudience();

  return (
    <>
      <div className={styles.pageHeader}>
        <p className={styles.kicker}>
          <Link href="/library">Resource Library</Link>
          <span className={styles.kickerSep}>·</span>
          Suggest a Resource
        </p>
        <h1 className={styles.pageTitle}>Suggest a Resource</h1>
        <p className={styles.pageLede}>
          Found a great video, article, document, or product link? Send it in. The webmaster
          reviews every suggestion before it&rsquo;s published — usually within a few days.
        </p>
        <div className={styles.headRule} />
      </div>

      <main className={`${styles.main} ${styles.mainNarrow}`} style={{ maxWidth: 720 }}>
        {sent === '1' ? (
          <SentConfirmation />
        ) : audience === null ? (
          <GateCard target={target} gate={gate} />
        ) : (
          <SubmitForm target={target} err={err} />
        )}
      </main>
    </>
  );
}

function SentConfirmation() {
  return (
    <div className={styles.formCard}>
      <div className={styles.confirmDone}>
        <div className={styles.bigCheck} aria-hidden="true">
          ✓
        </div>
        <h2 className={styles.confirmTitle}>Sent for review</h2>
        <p className={styles.confirmText}>
          Your suggestion is in the webmaster&rsquo;s queue. If it&rsquo;s published
          you&rsquo;ll see it on the shelf — usually within a few days.
        </p>
        <p style={{ marginTop: 16, display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link className={styles.btnSecondary} href="/library/submit">
            Suggest Another
          </Link>
          <Link className={styles.btnPrimary} href="/library">
            Back to the Library
          </Link>
        </p>
      </div>
    </div>
  );
}

function GateCard({ target, gate }: { target?: string; gate?: string }) {
  const configured = familyGateConfigured();
  return (
    <div className={styles.formCard}>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 24, marginBottom: 8 }}>
        Troop sign-in
      </h2>
      <p className={styles.fieldHint} style={{ marginBottom: 18, fontSize: 14 }}>
        One shared password for the whole troop — it&rsquo;s printed in the Bugle each week,
        or ask any leader. You&rsquo;ll only enter it once on this device. Leaders and scouts
        already signed in to the workspace skip this step automatically.
      </p>
      {gate && GATE_MESSAGES[gate] && <p className={styles.fieldError}>{GATE_MESSAGES[gate]}</p>}
      {configured ? (
        <form action={libraryGateAction}>
          {target && <input type="hidden" name="target" value={target} />}
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

async function SubmitForm({ target, err }: { target?: string; err?: string }) {
  const options = await loadTargetOptions();

  // Leaders/scouts get their login name prefilled as the "who are you" —
  // editable, since the label is display-only (sessions aren't identity).
  const jar = await cookies();
  const adminSession = await verifySession(jar.get(LEADER_COOKIE.name)?.value);
  const namePrefill = adminSession?.leader ?? '';

  return (
    <form className={styles.formCard} action={submitLibraryResourceAction}>
      {err && ERR_MESSAGES[err] && <p className={styles.fieldError}>{ERR_MESSAGES[err]}</p>}

      <div className={styles.fieldRow}>
        <label className={styles.fieldLabel} htmlFor="url">
          Link
        </label>
        <input
          className={styles.textInput}
          type="url"
          id="url"
          name="url"
          required
          placeholder="https://…  (YouTube, article, Google Doc, Amazon — anything)"
        />
      </div>

      <div className={styles.fieldRow}>
        <label className={styles.fieldLabel} htmlFor="title">
          What is it? <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>(optional)</span>
        </label>
        <input
          className={styles.textInput}
          type="text"
          id="title"
          name="title"
          placeholder="e.g. Great 6-minute video on splinting an arm"
        />
      </div>

      <div className={styles.fieldRow}>
        <label className={styles.fieldLabel} htmlFor="target">
          Where does it belong?{' '}
          <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>
            (best guess is fine)
          </span>
        </label>
        <select className={styles.selectInput} id="target" name="target" defaultValue={target ?? ''}>
          <option value="">Let the webmaster decide</option>
          <optgroup label="Topic shelves">
            {options.topics.map((t) => (
              <option key={t.slug} value={`topic:${t.slug}`}>
                {t.title}
              </option>
            ))}
          </optgroup>
          {options.ranks.map((rank) => (
            <optgroup key={rank.id} label={`${rank.display_name} requirements`}>
              {(options.rankReqs.get(rank.id) ?? []).map((req) => (
                <option key={req.code} value={`rank_req:${rankReqKey(rank.id, req.code)}`}>
                  {rank.display_name} {req.code} — {req.label.slice(0, 60)}
                </option>
              ))}
            </optgroup>
          ))}
          <optgroup label="Merit badges">
            {options.mbs.map((mb) => (
              <option key={mb.id} value={`mb:${mb.id}`}>
                {mb.name}
              </option>
            ))}
          </optgroup>
        </select>
      </div>

      <div className={styles.fieldRow}>
        <label className={styles.fieldLabel} htmlFor="why">
          Why is it good?{' '}
          <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>
            (optional — becomes the blurb if published)
          </span>
        </label>
        <textarea
          className={styles.textArea}
          id="why"
          name="why"
          placeholder="One or two sentences."
        />
      </div>

      <div className={styles.fieldRow}>
        <label className={styles.fieldLabel} htmlFor="name">
          Who are you?
        </label>
        <input
          className={styles.textInput}
          type="text"
          id="name"
          name="name"
          required
          defaultValue={namePrefill}
          placeholder="e.g. Mr. Kowalski, or Ben S. (scout)"
        />
        <p className={styles.fieldHint}>
          Shown to the webmaster; if published, credit defaults to &ldquo;Shared by
          {' '}your name&rdquo; (the webmaster can edit it).
        </p>
      </div>

      <button className={styles.btnPrimary} type="submit">
        Send to the Webmaster
      </button>
    </form>
  );
}
