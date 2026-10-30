'use client';

/** /member/meeting's family view, writing as the signed-in person (family-actions.ts). */
import type { FamilyWeek } from '@/lib/family-week';
import { FamilyWeekView } from './family-week';
import { familyWriteAction } from './family-actions';

export function FamilyWeekMember({ week, readOnly, lede }: { week: FamilyWeek; readOnly: boolean; lede: string | null }) {
  return <FamilyWeekView week={week} readOnly={readOnly} lede={lede} write={(scoutId, op) => familyWriteAction({ entryId: week.entryId, scoutId, op })} />;
}
