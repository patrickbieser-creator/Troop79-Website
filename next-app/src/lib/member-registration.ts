/**
 * How a family reads a BSA registration (/member card + /member/registration).
 * The dates come from the troop's last saved BSA roster (lib/bsa-roster-db).
 */
import { dueState } from '@/lib/bsa-roster';
import { fmtDate } from '@/lib/format-date';

export function registrationLine(reg: { expires: string | null }, today: string): string {
  const state = dueState(reg.expires, today);
  if (!reg.expires || !state) return 'Not on the troop’s BSA roster';
  if (state === 'expired') return `Expired ${fmtDate(reg.expires)}`;
  if (state === 'soon') return `Renewal due by ${fmtDate(reg.expires)}`;
  return `Registered through ${fmtDate(reg.expires)}`;
}

/** Where a family renews. */
export const RENEW_URL = 'https://my.scouting.org';

/** Who a family's registration list shows: every child, and the signed-in adult only when they are
 *  registered (most parents aren't, and "not on the roster" would read as a problem). Never empty
 *  when there is someone to show. */
export function visibleRegistrations<T extends { personId: number; expires: string | null }>(regs: T[], selfId: number): T[] {
  const shown = regs.filter((r) => r.personId !== selfId || r.expires);
  return shown.length ? shown : regs.filter((r) => r.personId === selfId);
}
