'use client';

/** The family link's page body: the shared family view, writing through the link's own action. */
import type { FamilyWeek } from '@/lib/family-week';
import { FamilyWeekView } from '../../../member/meeting/family-week';
import type { FamilyChoice } from '@/lib/family-week-shared';
import { planPageWriteAction } from '../actions';

export function PlanPageClient({ token, week, initialAnswer }: { token: string; week: FamilyWeek; initialAnswer: FamilyChoice | null }) {
  return <FamilyWeekView week={week} initialAnswer={initialAnswer} write={(scoutId, op) => planPageWriteAction({ token, scoutId, op })} />;
}
