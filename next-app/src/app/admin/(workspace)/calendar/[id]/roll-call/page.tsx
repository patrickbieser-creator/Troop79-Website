/**
 * /admin/calendar/[entryId]/roll-call — who was at this event.
 *
 * Works for ANY entry, not just meetings: campouts, service projects,
 * fundraisers, outings. That is the point — attendance was previously a
 * meetings-only screen, and everything else was reconstructed after the fact
 * from scattered Fast Entry rows.
 *
 * Its own route rather than a workbench panel because taking attendance is a
 * data-entry session, not editing — the same reasoning that kept Roll Call
 * separate when the calendar was unified.
 */

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/server';
import { requireCapability } from '@/lib/require-capability';
import { loadCalendarCategories } from '@/lib/calendar';
import { creditRuleFor, defaultQtyFor, loadAttendance, loadCandidates } from '@/lib/attendance';
import { markAttended, markAbsent, setAttendanceQty, seedFromSignup } from './actions';
import { RollCall } from './roll-call';
import styles from './roll-call.module.css';
import { fmtRange } from '@/lib/format-date';

export const metadata = { title: 'Roll Call — Troop 79' };

export default async function RollCallPage({ params }: { params: Promise<{ id: string }> }) {
  await requireCapability('advancement.write');
  const { id } = await params;
  const entryId = Number(id);
  if (!Number.isInteger(entryId) || entryId <= 0) notFound();

  const supabase = createAdminClient();
  const [{ data: entry }, categories] = await Promise.all([
    supabase
      .from('calendar_entries')
      .select('id, title, entry_date, end_date, category')
      .eq('id', entryId)
      .maybeSingle(),
    loadCalendarCategories()
  ]);
  if (!entry) notFound();

  const rule = creditRuleFor(
    categories as Parameters<typeof creditRuleFor>[0],
    entry.category as string
  );
  const [attendance, candidates] = await Promise.all([
    loadAttendance(entryId),
    loadCandidates(entryId)
  ]);

  const { data: signup } = await supabase
    .from('event_signups')
    .select('id')
    .eq('calendar_entry_id', entryId)
    .maybeSingle();

  return (
    <>
      <div className={styles.head}>
        <div>
          <Link href={`/admin/calendar/${entryId}?tab=roll-call`} className={styles.backLink}>
            &larr; Back to the entry
          </Link>
          <h1>Roll Call</h1>
          <p className={styles.headMeta}>
            {entry.title} &middot; {fmtRange(entry.entry_date, entry.end_date)} &middot; {entry.category}
          </p>
        </div>
      </div>

      <RollCall
        entryId={entryId}
        entryTitle={entry.title as string}
        creditKind={rule.creditKind}
        creditUnit={rule.creditUnit}
        countsAsActivity={rule.countsAsActivity}
        defaultQty={defaultQtyFor(
          rule.creditKind,
          entry.entry_date as string,
          (entry.end_date as string) ?? null
        )}
        hasSignup={signup !== null}
        candidates={candidates}
        attendance={attendance}
        onMark={markAttended}
        onUnmark={markAbsent}
        onSetQty={setAttendanceQty}
        onSeed={seedFromSignup}
      />
    </>
  );
}
