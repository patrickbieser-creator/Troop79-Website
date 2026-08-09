import type { MeetingPlanPayload } from '@/lib/meeting-plan-types';

/**
 * A generated meeting plan is a SUGGESTION, not a commitment, so it is
 * deliberately reusable for a date other than the one it was generated for
 * (Patrick, 2026-08-08). Generating for the 9th and deciding to run it on the
 * 16th is normal use, not an error.
 *
 * What must never happen is the two dates diverging silently: publish used to
 * send the payload alone, so changing the date field and hitting Publish
 * saved the plan under the date it was GENERATED for while the screen showed
 * the new one. The selected date now wins, and the mismatch is stated rather
 * than either guessed at or refused.
 *
 * (The stricter "discard everything after a warning" rule belongs to the
 * MEETING itself, once leaders or scouts have committed to slots on its
 * agenda — moving a meeting people signed up for is a different operation
 * from re-aiming a suggestion. Not implemented here.)
 */

/** Null when there's nothing to say — no selected date, or it already agrees. */
export function retargetNotice(payloadDate: string, selectedDate: string): string | null {
  if (!selectedDate || selectedDate === payloadDate) return null;
  return `These suggestions were generated for ${payloadDate} — publishing them for ${selectedDate}.`;
}

/** The payload as it should be stored: under the date the leader selected. */
export function retargetPlan(
  payload: MeetingPlanPayload,
  selectedDate: string
): MeetingPlanPayload {
  if (!selectedDate || selectedDate === payload.meetingDate) return payload;
  return { ...payload, meetingDate: selectedDate };
}
