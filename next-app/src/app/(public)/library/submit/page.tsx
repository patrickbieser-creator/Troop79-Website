/**
 * /library/submit — suggest a resource. Gated by any troop credential
 * (leader/scout admin session passes automatically; otherwise the shared
 * family password, same gate as Event Signup / Profile). Everything queues
 * for webmaster review — nothing publishes from here.
 */
import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/server';
import { gateAudience, familyGateConfigured } from '@/lib/family-access';
import { resolveAdminActor } from '@/lib/admin-actor';
import type { LibraryTopic, MeritBadge, Rank } from '@/lib/supabase/types';
import { rankReqKey } from '@/lib/library';
import { libraryGateAction, submitLibraryResourceAction } from './actions';
import { PageHeader, KickerSep } from '@/app/_components/page-header';
import { PageShell } from '@/app/_components/page-shell';
import { Button } from '@/app/_components/button';
import {
  FormCard,
  Field,
  TextInput,
  SelectInput,
  TextArea,
  FieldHint,
  FieldError
} from '@/app/_components/form';
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
      <PageHeader
        kicker={
          <>
            <Link href="/library">Resource Library</Link>
            <KickerSep />
            Suggest a Resource
          </>
        }
        title="Suggest a Resource"
        lede="Found a great video, article, document, or product link? Send it in. The webmaster
          reviews every suggestion before it&rsquo;s published — usually within a few days."
      />

      <PageShell width="narrow">
        {sent === '1' ? (
          <SentConfirmation />
        ) : audience === null ? (
          <GateCard target={target} gate={gate} />
        ) : (
          <SubmitForm target={target} err={err} />
        )}
      </PageShell>
    </>
  );
}

function SentConfirmation() {
  return (
    <FormCard>
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
          <Button variant="secondary" href="/library/submit">
            Suggest Another
          </Button>
          <Button variant="primary" href="/library">
            Back to the Library
          </Button>
        </p>
      </div>
    </FormCard>
  );
}

function GateCard({ target, gate }: { target?: string; gate?: string }) {
  const configured = familyGateConfigured();
  return (
    <FormCard>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 24, marginBottom: 8 }}>
        Troop sign-in
      </h2>
      <FieldHint>
        One shared password for the whole troop — it&rsquo;s printed in the Bugle each week,
        or ask any leader. You&rsquo;ll only enter it once on this device. Leaders and scouts
        already signed in to the workspace skip this step automatically.
      </FieldHint>
      {gate && GATE_MESSAGES[gate] && <FieldError>{GATE_MESSAGES[gate]}</FieldError>}
      {configured ? (
        <form action={libraryGateAction}>
          {target && <input type="hidden" name="target" value={target} />}
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
    </FormCard>
  );
}

async function SubmitForm({ target, err }: { target?: string; err?: string }) {
  const options = await loadTargetOptions();

  // Leaders/scouts get their login name prefilled as the "who are you" —
  // editable, since the label is display-only (sessions aren't identity).
  const adminActor = await resolveAdminActor();
  const namePrefill = adminActor?.label ?? '';

  return (
    <form action={submitLibraryResourceAction}>
      <FormCard>
      {err && ERR_MESSAGES[err] && <FieldError>{ERR_MESSAGES[err]}</FieldError>}

      <Field label="Link">
        <TextInput
          type="url"
          name="url"
          required
          placeholder="https://…  (YouTube, article, Google Doc, Amazon — anything)"
        />
      </Field>

      <Field
        label={
          <>
            What is it? <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>(optional)</span>
          </>
        }
      >
        <TextInput
          type="text"
          name="title"
          placeholder="e.g. Great 6-minute video on splinting an arm"
        />
      </Field>

      <Field
        label={
          <>
            Where does it belong?{' '}
            <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>
              (best guess is fine)
            </span>
          </>
        }
      >
        <SelectInput name="target" defaultValue={target ?? ''}>
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
        </SelectInput>
      </Field>

      <Field
        label={
          <>
            Why is it good?{' '}
            <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>
              (optional — becomes the blurb if published)
            </span>
          </>
        }
      >
        <TextArea name="why" placeholder="One or two sentences." />
      </Field>

      <Field
        label="Who are you?"
        hint={
          <>
            Shown to the webmaster; if published, credit defaults to &ldquo;Shared by
            {' '}your name&rdquo; (the webmaster can edit it).
          </>
        }
      >
        <TextInput
          type="text"
          name="name"
          required
          defaultValue={namePrefill}
          placeholder="e.g. Mr. Kowalski, or Ben S. (scout)"
        />
      </Field>

      <Button variant="primary" type="submit">
        Send to the Webmaster
      </Button>
      </FormCard>
    </form>
  );
}
