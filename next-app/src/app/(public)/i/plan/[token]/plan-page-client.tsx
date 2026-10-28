'use client';

/** The family link's page body: the shared family view, writing through the link's own action. */
import type { FamilyWeek } from '@/lib/family-week';
import { FamilyWeekView } from '../../../member/meeting/family-week';
import { planPageWriteAction } from '../actions';

export function PlanPageClient({ token, week }: { token: string; week: FamilyWeek }) {
  return <FamilyWeekView week={week} write={(scoutId, op) => planPageWriteAction({ token, scoutId, op })} />;
}
