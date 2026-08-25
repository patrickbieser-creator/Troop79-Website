import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { requireAnyOf } from '@/lib/require-capability';
import { PageTitle } from '../../../_components/page-title';
import { EventNav } from '../event-nav';
import { loadEventNav } from '../event-nav-data';
import styles from '../../../events/events-admin.module.css';
import { MoneyView } from './money-view';

export const metadata = { title: 'Event Money — Troop 79' };

/*
 * The event's money (Plans/Event-Logistics.md §C) — the campout sheet's
 * bottom-right block: who owes what and has paid how, by method; expenses;
 * reimbursements due; P&L; the deposit schedule. Gate: calendar.write OR
 * finance.manage (the record-payment rule), so a finance-only actor can reach
 * this page by URL even though the parent roster is calendar.write.
 */
export default async function EventMoneyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const signupId = Number(id);
  if (!Number.isInteger(signupId) || signupId < 1) notFound();
  await requireAnyOf(['calendar.write', 'finance.manage']);

  const supabase = createAdminClient();
  const { data: sig } = await supabase
    .from('event_signups')
    .select('id, calendar_entry_id, calendar_entries!inner(id, title)')
    .eq('id', signupId)
    .maybeSingle();
  if (!sig) notFound();
  const s = sig as unknown as { calendar_entry_id: number; calendar_entries: { title: string } };
  const nav = await loadEventNav(supabase, signupId, s.calendar_entry_id);

  return (
    <>
      <PageTitle
        back={{
          crumbs: [{ label: 'Calendar', href: '/admin/calendar' }, { label: String(s.calendar_entries.title), href: `/admin/calendar/${nav.entryId}?tab=signup` }],
          current: 'Money'
        }}
        title={`${s.calendar_entries.title} — Money`}
        sub={
          <Link href="/admin/finance" className={styles.actionLinkMuted}>
            Financial Ledger
          </Link>
        }
      />
      <EventNav signupId={signupId} entryId={nav.entryId} active="money" sets={nav.sets} hasMoney={nav.hasMoney} />
      <MoneyView signupId={signupId} calendarEntryId={s.calendar_entry_id} />
    </>
  );
}
