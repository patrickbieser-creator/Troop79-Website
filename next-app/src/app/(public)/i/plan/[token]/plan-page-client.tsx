'use client';

/**
 * The family link's page body: the shared family view and, on a teacher link (F5), the recipient's own teacher card,
 * each writing through the link's own action. Who is written for comes from the link on the server, never from here.
 */
import type { FamilyWeek } from '@/lib/family-week';
import type { OfferChoices, TeachView } from '@/lib/meeting-board-supply';
import type { TeacherWeek } from '@/lib/teacher-week';
import { FamilyWeekView } from '../../../member/meeting/family-week';
import { TeacherCard } from '../../../member/meeting/teacher-card';
import type { FamilyChoice } from '@/lib/family-week-shared';
import { planPageTeachAction, planPageWriteAction } from '../actions';
import fw from '../../../member/meeting/family-week.module.css';

export interface PlanTeacher {
  week: TeacherWeek;
  view: TeachView;
  choices: OfferChoices;
}

export function PlanPageClient({
  token,
  entryId,
  date,
  week,
  teacher,
  initialAnswer,
  lede
}: {
  token: string;
  entryId: number;
  date: string;
  week: FamilyWeek | null;
  teacher: PlanTeacher | null;
  initialAnswer: FamilyChoice | null;
  lede: string;
}) {
  const family = week && week.scouts.length ? week : null;
  return (
    <>
      {family ? (
        <FamilyWeekView week={family} initialAnswer={initialAnswer} lede={lede} write={(scoutId, op) => planPageWriteAction({ token, scoutId, op })} />
      ) : (
        <p className={fw.lede}>{lede}</p>
      )}
      {teacher ? (
        <TeacherCard
          key={`${teacher.week.personId}:${teacher.week.intent ?? ''}`}
          entryId={entryId}
          date={date}
          isSelf
          initial={teacher.week}
          view={teacher.view}
          choices={teacher.choices}
          readOnly={false}
          write={(op) => planPageTeachAction({ token, op })}
        />
      ) : null}
    </>
  );
}
