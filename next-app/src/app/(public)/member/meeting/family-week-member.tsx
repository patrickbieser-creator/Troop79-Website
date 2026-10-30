'use client';

/** /member/meeting's family view, writing as the signed-in person (family-actions.ts). */
import type { FamilyWeek } from '@/lib/family-week';
import { FamilyWeekView } from './family-week';
import { familyWriteAction } from './family-actions';

/** viewScout: a leader in proxy view, answering for the family of that scout (family-actions checks the right). */
export function FamilyWeekMember({ week, readOnly, lede, viewScout }: { week: FamilyWeek; readOnly: boolean; lede: string | null; viewScout?: number }) {
  return <FamilyWeekView week={week} readOnly={readOnly} lede={lede} write={(scoutId, op) => familyWriteAction({ entryId: week.entryId, scoutId, op, ...(viewScout != null ? { viewScout } : {}) })} />;
}
