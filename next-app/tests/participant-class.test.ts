import { describe, it, expect } from 'vitest';
import {
  PARTICIPANT_CLASSES,
  PARTICIPANT_CLASS_LABEL,
  GUEST_CLASSES,
  isParticipantClass,
  isYouthClass,
  defaultClassFor,
  tierAudienceFor,
  personKindFor
} from '../src/lib/participant-class';
import { adminClient } from './helpers/admin-client';
import { createTestEvent, deleteTestEvent, createTestScout, deleteTestScout } from './helpers/signup-fixtures';

/**
 * Participant classification (Plans/Participant-Classification.md, Patrick
 * 2026-08-21): Adult, Scout, Junior Leader (a scout in high school), Webelos,
 * Cub Scout, Youth Guest, Adult Guest. Junior Leader derives from grade 9–12
 * at the EVENT date (graduation_year, June 15 rollover) unless the scout's
 * roster override says otherwise.
 */
describe('participant classes — vocabulary (pure)', () => {
  it('ParticipantClasses_AreExactlyTheSevenPatrickNamed_InHisOrder', () => {
    expect([...PARTICIPANT_CLASSES]).toEqual([
      'adult',
      'scout',
      'junior_leader',
      'webelos',
      'cub_scout',
      'youth_guest',
      'adult_guest'
    ]);
    for (const c of PARTICIPANT_CLASSES) expect(PARTICIPANT_CLASS_LABEL[c]).toBeTruthy();
    expect(PARTICIPANT_CLASS_LABEL.junior_leader).toBe('Junior Leader');
  });

  it('GuestClasses_AreTheOnesAFamilyCanAddByName', () => {
    expect([...GUEST_CLASSES]).toEqual(['webelos', 'cub_scout', 'youth_guest', 'adult_guest']);
  });

  it('IsYouthClass_SplitsYouthFromAdults', () => {
    expect((['scout', 'junior_leader', 'webelos', 'cub_scout', 'youth_guest'] as const).every(isYouthClass)).toBe(true);
    expect(isYouthClass('adult')).toBe(false);
    expect(isYouthClass('adult_guest')).toBe(false);
  });

  it('IsParticipantClass_RejectsUnknownStrings', () => {
    expect(isParticipantClass('scout')).toBe(true);
    expect(isParticipantClass('parent')).toBe(false);
  });

  it('TierAudienceFor_MapsYouthClassesToScouts_AndAdultsToAdults', () => {
    expect(tierAudienceFor('scout')).toBe('scouts');
    expect(tierAudienceFor('junior_leader')).toBe('scouts');
    expect(tierAudienceFor('webelos')).toBe('scouts');
    expect(tierAudienceFor('youth_guest')).toBe('scouts');
    expect(tierAudienceFor('adult')).toBe('adults');
    expect(tierAudienceFor('adult_guest')).toBe('adults');
  });

  it('PersonKindFor_KeepsLegacyPersonKindInStep_WithTheClass', () => {
    expect(personKindFor('cub_scout')).toBe('scout');
    expect(personKindFor('adult_guest')).toBe('adult');
  });
});

describe('defaultClassFor (pure)', () => {
  it('DefaultClassFor_IsAdult_ForANonScout', () => {
    expect(defaultClassFor({ isScout: false, graduationYear: null, override: null, onDate: '2026-09-01' })).toBe(
      'adult'
    );
  });

  it('DefaultClassFor_IsScout_BelowHighSchool', () => {
    // Class of 2031 is in 8th grade during the 2026-27 school year.
    expect(defaultClassFor({ isScout: true, graduationYear: 2031, override: null, onDate: '2026-09-01' })).toBe(
      'scout'
    );
  });

  it('DefaultClassFor_IsJuniorLeader_InGrades9Through12_AsOfTheEventDate', () => {
    // Class of 2030: 9th grade from June 15 2026 (June 15 rollover).
    expect(defaultClassFor({ isScout: true, graduationYear: 2030, override: null, onDate: '2026-06-14' })).toBe(
      'scout'
    );
    expect(defaultClassFor({ isScout: true, graduationYear: 2030, override: null, onDate: '2026-06-15' })).toBe(
      'junior_leader'
    );
    // Class of 2027: 12th grade in 2026-27.
    expect(defaultClassFor({ isScout: true, graduationYear: 2027, override: null, onDate: '2027-03-01' })).toBe(
      'junior_leader'
    );
  });

  it('DefaultClassFor_IsScout_WhenAScoutHasNoGraduationYear', () => {
    expect(defaultClassFor({ isScout: true, graduationYear: null, override: null, onDate: '2026-09-01' })).toBe(
      'scout'
    );
  });

  it('DefaultClassFor_HonorsTheRosterOverride_BothWays', () => {
    // A freshman marked "no" stays a scout; a 7th-grade SPL marked "yes" is a JL.
    expect(defaultClassFor({ isScout: true, graduationYear: 2030, override: 'no', onDate: '2026-09-01' })).toBe(
      'scout'
    );
    expect(defaultClassFor({ isScout: true, graduationYear: 2032, override: 'yes', onDate: '2026-09-01' })).toBe(
      'junior_leader'
    );
  });

  it('DefaultClassFor_IgnoresTheOverride_ForNonScouts', () => {
    expect(defaultClassFor({ isScout: false, graduationYear: null, override: 'yes', onDate: '2026-09-01' })).toBe(
      'adult'
    );
  });
});

/**
 * Schema half (requires local Supabase): guest rows are named and hosted;
 * roster rows keep D-066's person_id rule.
 */

describe('signup_entries — participant_class + guest rows (db)', () => {
  it('SignupEntries_RejectsAGuestRow_WithoutNameOrHost_AndAcceptsANamedHostedGuest', async () => {
    const admin = adminClient();
    const event = await createTestEvent(admin);
    const scout = await createTestScout(admin, 'PCLS');
    try {
      const { data: host, error: hostErr } = await admin
        .from('signup_entries')
        .insert({
          event_signup_id: event.eventSignupId,
          person_id: scout.personId,
          person_kind: 'scout',
          participant_class: 'scout',
          status: 'yes',
          participation: 'full'
        })
        .select('id')
        .single();
      expect(hostErr).toBeNull();

      const bad = await admin.from('signup_entries').insert({
        event_signup_id: event.eventSignupId,
        person_id: null,
        person_kind: 'scout',
        participant_class: 'webelos',
        status: 'yes',
        participation: 'full'
      });
      expect(bad.error).not.toBeNull();

      const wrongClass = await admin.from('signup_entries').insert({
        event_signup_id: event.eventSignupId,
        person_id: null,
        guest_name: 'Sam Lee',
        host_entry_id: host!.id,
        person_kind: 'scout',
        participant_class: 'scout',
        status: 'yes',
        participation: 'full'
      });
      expect(wrongClass.error).not.toBeNull();

      const good = await admin.from('signup_entries').insert({
        event_signup_id: event.eventSignupId,
        person_id: null,
        guest_name: 'Sam Lee',
        host_entry_id: host!.id,
        person_kind: 'scout',
        participant_class: 'webelos',
        status: 'yes',
        participation: 'full'
      });
      expect(good.error).toBeNull();

      // The class vocabulary is CHECK-enforced.
      const unknown = await admin.from('signup_entries').insert({
        event_signup_id: event.eventSignupId,
        person_id: scout.personId,
        person_kind: 'scout',
        participant_class: 'parent',
        status: 'yes',
        participation: 'full'
      });
      expect(unknown.error).not.toBeNull();
    } finally {
      await deleteTestEvent(admin, event);
      await deleteTestScout(admin, scout);
    }
  });
});

describe('signup_entries — default_participant_class trigger (db)', () => {
  it('Trigger_DerivesTheClass_WhenAnInserterOmitsIt_MatchingDefaultClassFor', async () => {
    const admin = adminClient();
    const event = await createTestEvent(admin); // entry_date 2027-01-01 → school year ends 2027
    const freshman = await createTestScout(admin, 'PCT9');
    const younger = await createTestScout(admin, 'PCT7');
    const overridden = await createTestScout(admin, 'PCTO');
    try {
      // Class of 2030 → 9th grade in 2026-27 → junior leader at a Jan 2027 event.
      await admin.from('scouts').update({ graduation_year: 2030 }).eq('id', freshman.scoutId);
      // Class of 2032 → 7th grade → scout.
      await admin.from('scouts').update({ graduation_year: 2032 }).eq('id', younger.scoutId);
      // 7th grader with the roster override → junior leader.
      await admin
        .from('scouts')
        .update({ graduation_year: 2032, junior_leader_override: 'yes' })
        .eq('id', overridden.scoutId);

      const insert = (personId: number) =>
        admin
          .from('signup_entries')
          .insert({
            event_signup_id: event.eventSignupId,
            person_id: personId,
            person_kind: 'scout',
            status: 'yes',
            participation: 'full'
          })
          .select('participant_class')
          .single();

      expect((await insert(freshman.personId)).data?.participant_class).toBe('junior_leader');
      expect((await insert(younger.personId)).data?.participant_class).toBe('scout');
      expect((await insert(overridden.personId)).data?.participant_class).toBe('junior_leader');

      // Same answers from the TS twin — the two rules must never drift.
      expect(defaultClassFor({ isScout: true, graduationYear: 2030, override: null, onDate: '2027-01-01' })).toBe(
        'junior_leader'
      );
      expect(defaultClassFor({ isScout: true, graduationYear: 2032, override: null, onDate: '2027-01-01' })).toBe(
        'scout'
      );
      expect(defaultClassFor({ isScout: true, graduationYear: 2032, override: 'yes', onDate: '2027-01-01' })).toBe(
        'junior_leader'
      );
    } finally {
      await deleteTestEvent(admin, event);
      await deleteTestScout(admin, freshman);
      await deleteTestScout(admin, younger);
      await deleteTestScout(admin, overridden);
    }
  });
});
