import Link from 'next/link';
import { EventNav } from '../../rosters/[id]/event-nav';
import { loadEventNav } from '../../rosters/[id]/event-nav-data';
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

  // Assignments block (Plans/Event-Logistics.md §B): the sets on this signup
  // with how many groups and placements each holds, so Remove can warn.
  const { data: setRows } = await supabase
    .from('signup_group_sets')
    .select('id, kind, label, leg, seed_from_roster, self_select, family_visible, default_capacity, sort')
    .eq('event_signup_id', s.id)
    .order('sort')
    .order('id');
  const setIds = ((setRows ?? []) as { id: number }[]).map((r) => r.id);
  const [{ data: groupRows }, { data: memberRows }] = setIds.length
    ? await Promise.all([
        supabase.from('signup_groups').select('set_id').in('set_id', setIds),
        supabase.from('signup_group_members').select('set_id').in('set_id', setIds)
      ])
    : [{ data: [] as unknown[] }, { data: [] as unknown[] }];
  const groupCount = new Map<number, number>();
  for (const g of (groupRows ?? []) as { set_id: number }[]) groupCount.set(g.set_id, (groupCount.get(g.set_id) ?? 0) + 1);
  const memberCount = new Map<number, number>();
  for (const m of (memberRows ?? []) as { set_id: number }[]) memberCount.set(m.set_id, (memberCount.get(m.set_id) ?? 0) + 1);
  const sets = ((setRows ?? []) as Record<string, unknown>[]).map((r) => ({
    ...r,
    group_count: groupCount.get(Number(r.id)) ?? 0,
    member_count: memberCount.get(Number(r.id)) ?? 0
  }));

  const nav = await loadEventNav(supabase, s.id, s.calendar_entry_id);
  return {
    nav,
    signup: signup as Record<string, unknown>,
    entry: entry as Record<string, unknown> | null,
    prices: (prices ?? []) as Record<string, unknown>[],
    slots: (slots ?? []) as Record<string, unknown>[],
    questions: (questions ?? []) as Record<string, unknown>[],
    sets
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
            <Link href={`/events/${entryId}`} className={styles.actionLinkMuted}>
              View public page
            </Link>
          </>
        }
      />
      <EventNav signupId={signupId} active="builder" sets={data.nav.sets} hasMoney={data.nav.hasMoney} />

      <BuilderPanels
        signupId={signupId}
        calendarEntryId={entryId}
        entryDate={String(data.entry.entry_date ?? '')}
        endDate={(data.entry.end_date as string | null) ?? null}
        signup={data.signup}
        prices={data.prices}
        slots={data.slots}
        questions={data.questions}
        sets={data.sets}
        category={String(data.entry.category ?? '')}
      />
    </>
  );
}
