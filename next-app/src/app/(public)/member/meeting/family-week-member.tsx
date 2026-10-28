'use client';

/** /member/meeting's family view, writing as the signed-in person (family-actions.ts). */
import type { FamilyWeek } from '@/lib/family-week';
import { FamilyWeekView } from './family-week';
import { familyWriteAction } from './family-actions';

export function FamilyWeekMember({ week, readOnly }: { week: FamilyWeek; readOnly: boolean }) {
  return <FamilyWeekView week={week} readOnly={readOnly} write={(scoutId, op) => familyWriteAction({ entryId: week.entryId, scoutId, op })} />;
}
