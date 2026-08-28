import { requireAnyOf } from '@/lib/require-capability';
import { getEventMoneyAction } from '../../../finance/actions';
import { MoneyPanel } from './money-panel';
import { centralToday } from '@/lib/dates';
import { loadPersonDirectory } from '@/lib/person-directory';

/** The Money panel with its data — standalone page and the workbench's
 *  Signup tab (?view=money, 2026-08-25) render the same thing. */
export async function MoneyView({ signupId, calendarEntryId }: { signupId: number; calendarEntryId: number }) {
  // Finance-only leaders can open Money by URL (finance.manage) even though
  // the parent roster is calendar.write.
  await requireAnyOf(['calendar.write', 'finance.manage']);
  const [data, directory] = await Promise.all([
    getEventMoneyAction(signupId),
    // Adults on this signup are the likely "paid by" candidates for an
    // expense. Shared cache()d loader (Plans/Performance-Review-2026-08-27.md
    // #17) — the troop roster and signup roster read the same view.
    loadPersonDirectory()
  ]);
  if (!data) return null;

  const adults = directory.filter((p) => p.active && p.scout_id === null);

  return (
    <MoneyPanel
      signupId={signupId}
      calendarEntryId={calendarEntryId}
      data={data}
      adults={adults.map((a) => ({
        personId: a.person_id,
        name: a.display_name
      }))}
      today={centralToday()}
    />
  );
}
