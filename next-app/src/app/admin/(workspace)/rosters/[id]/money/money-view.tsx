import { requireAnyOf } from '@/lib/require-capability';
import { createAdminClient } from '@/lib/supabase/server';
import { getEventMoneyAction } from '../../../finance/actions';
import { MoneyPanel } from './money-panel';
import { centralToday } from '@/lib/dates';

/** The Money panel with its data — standalone page and the workbench's
 *  Signup tab (?view=money, 2026-08-25) render the same thing. */
export async function MoneyView({ signupId, calendarEntryId }: { signupId: number; calendarEntryId: number }) {
  // Finance-only leaders can open Money by URL (finance.manage) even though
  // the parent roster is calendar.write.
  await requireAnyOf(['calendar.write', 'finance.manage']);
  const supabase = createAdminClient();
  const data = await getEventMoneyAction(signupId);
  if (!data) return null;

  // Adults on this signup are the likely "paid by" candidates for an expense.
  const { data: adults } = await supabase
    .from('person_directory')
    .select('person_id, display_name, scout_id')
    .eq('active', true)
    .is('scout_id', null)
    .order('display_name');

  return (
    <MoneyPanel
      signupId={signupId}
      calendarEntryId={calendarEntryId}
      data={data}
      adults={((adults ?? []) as { person_id: number; display_name: string }[]).map((a) => ({
        personId: a.person_id,
        name: a.display_name
      }))}
      today={centralToday()}
    />
  );
}
