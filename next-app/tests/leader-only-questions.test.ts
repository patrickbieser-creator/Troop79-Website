import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import {
  createTestEvent,
  deleteTestEvent,
  createTestScout,
  deleteTestScout,
  type TestEvent,
  type TestScout
} from './helpers/signup-fixtures';

/**
 * Event Logistics Phase 0, leader-only columns (Plans/Event-Logistics.md §D):
 * a signup_question flagged leader_only is a roster column the leader fills
 * ("Health form in hand", "Registered with council"), never a family prompt.
 * The family submit RPC must SKIP it — otherwise a required one would block
 * the family, and an optional one would DELETE the leader's answer on every
 * resubmit (the RPC deletes answers the payload doesn't carry).
 */
const admin = adminClient();

let event: TestEvent;
let scout: TestScout;

beforeAll(async () => {
  event = await createTestEvent(admin);
  scout = await createTestScout(admin, 'LeaderQ');
});

afterAll(async () => {
  await deleteTestEvent(admin, event);
  await deleteTestScout(admin, scout);
});

describe('signup_questions.leader_only', () => {
  it('Question_DefaultsToFamilyFacing_AndNotPrintable', async () => {
    const { data, error } = await admin
      .from('signup_questions')
      .insert({ event_signup_id: event.eventSignupId, prompt: 'Shoe size', input_type: 'text' })
      .select('leader_only, print_allowed')
      .single();
    expect(error).toBeNull();
    expect(data?.leader_only).toBe(false);
    expect(data?.print_allowed).toBe(false);
  });

  it('SubmitHouseholdSignup_SkipsLeaderOnlyQuestions_AndKeepsTheLeadersAnswer', async () => {
    const { data: q } = await admin
      .from('signup_questions')
      .insert({
        event_signup_id: event.eventSignupId,
        prompt: 'Registered with council',
        input_type: 'text',
        leader_only: true,
        required: true
      })
      .select('id')
      .single();

    const submit = () =>
      admin.rpc('submit_household_signup', {
        p_event_signup_id: event.eventSignupId,
        p_entries: [{ key: 's', person_kind: 'scout', person_id: scout.personId, status: 'yes', answers: [] }],
        p_actor: 'vitest',
        p_allowed_person_ids: [scout.personId]
      });

    // Required + leader_only must NOT block the family.
    const first = await submit();
    expect(first.error).toBeNull();
    const entryId = (first.data as { entry_id: number }[])[0].entry_id;

    // Leader records an answer; the family resubmits; the answer survives.
    await admin.from('signup_answers').insert({ signup_entry_id: entryId, question_id: q!.id, value: 'Y' });
    const second = await submit();
    expect(second.error).toBeNull();
    const { data: answer } = await admin
      .from('signup_answers')
      .select('value')
      .eq('signup_entry_id', entryId)
      .eq('question_id', q!.id)
      .maybeSingle();
    expect(answer?.value).toBe('Y');
  });
});
