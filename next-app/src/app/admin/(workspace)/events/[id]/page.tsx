import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { requireCapability } from '@/lib/require-capability';
import { BuilderPanels } from './builder-panels';
import { PageTitle } from '../../_components/page-title';
import styles from '../events-admin.module.css';

export const metadata = { title: 'Event Builder — Troop 79' };

/*
 * The event builder — a BLOCK CHECKLIST, not a per-event-type template.
 *
 * Every event composes the same small set of blocks; the category only seeds
 * which ones start on. A new event shape needs no new code, just a different
 * combination (Plans/Event-Signup.md).
 */

async function load(signupId: number) {
  // Leader-only: rosters carry guest notes, driving arrangements, payment
  // status and household composition. A scout-role session must not see them.
  await requireCapability('calendar.write');
  const supabase = createAdminClient();
  const { data: signup } = await supabase
    .from('event_signups')
    .select('*')
    .eq('id', signupId)
    .maybeSingle();
  if (!signup) return null;
  const s = signup as unknown as { calendar_entry_id: number; id: number };

  const [{ data: entry }, { data: prices }, { data: slots }, { data: questions }] = await Promise.all([
    supabase
      .from('calendar_entries')
      .select('id, title, entry_date, end_date, category')
      .eq('id', s.calendar_entry_id)
      .maybeSingle(),
    supabase
      .from('event_prices')
      .select('*')
      .eq('event_signup_id', s.id)
      .order('sort')
      .order('id'),
    supabase
      .from('signup_slots')
      .select('*')
      .eq('event_signup_id', s.id)
      // Must match the public ordering in lib/event-signup.ts — the builder
      // list is what a leader checks the family-facing order against.
      .order('slot_date')
      .order('sort')
      .order('starts_at', { nullsFirst: false })
      .order('id'),
    supabase.from('signup_questions').select('*').eq('event_signup_id', s.id).order('sort').order('id')
  ]);

  return {
    signup: signup as Record<string, unknown>,
    entry: entry as Record<string, unknown> | null,
    prices: (prices ?? []) as Record<string, unknown>[],
    slots: (slots ?? []) as Record<string, unknown>[],
    questions: (questions ?? []) as Record<string, unknown>[]
  };
}

export default async function EventBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const signupId = Number(id);
  if (!Number.isInteger(signupId) || signupId < 1) notFound();

  const data = await load(signupId);
  if (!data || !data.entry) notFound();

  const entryId = data.entry.id as number;

  return (
    <>
      <PageTitle
        title={String(data.entry.title)}
        sub={
          <>
            {String(data.entry.category)} ·{' '}
            <Link href="/admin/events" className={styles.actionLinkMuted}>
              All signups
            </Link>{' '}
            ·{' '}
            <Link href={`/admin/rosters/${signupId}`} className={styles.actionLink}>
              Roster
            </Link>{' '}
            ·{' '}
            <Link href={`/events/${entryId}`} className={styles.actionLinkMuted}>
              View public page
            </Link>
          </>
        }
      />

      <BuilderPanels
        signupId={signupId}
        calendarEntryId={entryId}
        entryDate={String(data.entry.entry_date ?? '')}
        endDate={(data.entry.end_date as string | null) ?? null}
        signup={data.signup}
        prices={data.prices}
        slots={data.slots}
        questions={data.questions}
      />
    </>
  );
}
