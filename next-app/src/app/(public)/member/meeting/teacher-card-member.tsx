'use client';

/** /member/meeting's teacher card, writing as the signed-in person or a leader on their behalf (teach-actions.ts). */
import type { TeachOp } from '@/lib/teach-write';
import { TeacherCard, type TeacherCardProps } from './teacher-card';
import {
  meetingPostOfferAction,
  meetingTeachAction,
  meetingTeacherClearAction,
  meetingTeacherIntentAction,
  meetingTeacherNoteAction,
  meetingUnteachAction,
  meetingWithdrawOfferAction
} from './teach-actions';

export function TeacherCardMember({ onBehalf, ...props }: Omit<TeacherCardProps, 'write'> & { onBehalf: boolean }) {
  const t = { entryId: props.entryId, personId: props.initial.personId, onBehalf };
  const write = (op: TeachOp) => {
    switch (op.op) {
      case 'teach':
        return meetingTeachAction({ ...t, key: op.key });
      case 'unteach':
        return meetingUnteachAction({ ...t, key: op.key });
      case 'withdraw':
        return meetingWithdrawOfferAction({ ...t, skillId: op.skillId });
      case 'intent':
        return meetingTeacherIntentAction({ ...t, intent: op.intent });
      case 'offer':
        return meetingPostOfferAction({ ...t, what: op.what, entryIds: op.entryIds, note: op.note });
      case 'clear':
        return meetingTeacherClearAction({ ...t, takeOff: op.takeOff });
      case 'note':
        return meetingTeacherNoteAction({ ...t, note: op.note });
    }
  };
  return <TeacherCard {...props} write={write} />;
}
