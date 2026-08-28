import { describe, it, expect } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { createTestEvent, deleteTestEvent, createTestScout, deleteTestScout } from './helpers/signup-fixtures';
import { loadSignupClaims, loadSignupAnswers } from '@/lib/signup-roster-reads';

/**
 * The admin Signup Roster and the Snapshot read slot claims and answers for
 * ONE signup. They used to select the whole table and match rows up in JS —
 * which grows with every signup ever taken and, past PostgREST's 1,000-row
 * cap, silently drops rows and prints a roster with jobs and answers missing
 * (Plans/Performance-Review-2026-08-27.md #4). The reads are now scoped to
 * the signup through the slot/entry join, so another event's rows never
 * arrive and the cap can't bite.
 */
describe('signup roster reads', () => {
  it('LoadSignupClaimsAndAnswers_ReturnOnlyThatSignupsRows', async () => {
    const admin = adminClient();
    const [a, b] = await Promise.all([createTestEvent(admin), createTestEvent(admin)]);
    const scout = await createTestScout(admin, 'RosterReads');
    try {
      const seeded: Record<'a' | 'b', { entryId: number; slotId: number; questionId: number }> = {} as never;
      for (const [key, ev] of [['a', a], ['b', b]] as const) {
        const { data: slot } = await admin
          .from('signup_slots')
          .insert({ event_signup_id: ev.eventSignupId, kind: 'task', label: `Job ${key}`, eligibility: 'both' })
          .select('id')
          .single();
        const { data: question } = await admin
          .from('signup_questions')
          .insert({ event_signup_id: ev.eventSignupId, prompt: `Q ${key}`, input_type: 'text', applies_to: 'both', required: false })
          .select('id')
          .single();
        const { data: entry } = await admin
          .from('signup_entries')
          .insert({ event_signup_id: ev.eventSignupId, person_kind: 'scout', person_id: scout.personId, status: 'yes' })
          .select('id')
          .single();
        await admin.from('signup_slot_claims').insert({ slot_id: slot!.id, signup_entry_id: entry!.id, comment: key });
        await admin.from('signup_answers').insert({ signup_entry_id: entry!.id, question_id: question!.id, value: key });
        seeded[key] = { entryId: entry!.id, slotId: slot!.id, questionId: question!.id };
      }

      const claims = await loadSignupClaims(admin, a.eventSignupId);
      expect(claims).toEqual([{ slot_id: seeded.a.slotId, signup_entry_id: seeded.a.entryId, comment: 'a' }]);

      const answers = await loadSignupAnswers(admin, a.eventSignupId);
      expect(answers).toEqual([{ signup_entry_id: seeded.a.entryId, question_id: seeded.a.questionId, value: 'a' }]);
    } finally {
      await deleteTestEvent(admin, a);
      await deleteTestEvent(admin, b);
      await deleteTestScout(admin, scout);
    }
  });
});
