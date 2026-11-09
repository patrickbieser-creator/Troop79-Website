import { describe, it, expect } from 'vitest';
import { counselorNames } from '../src/lib/mb-counselors';

/**
 * A badge's registered counselors, by name, for the public badge page (signed-in only). Moved from the retired admin
 * MB Progress drill-in (Patrick, 2026-11-09). A counselor is a person, or a non-person source such as Summer Camp.
 */
const sources = [{ code: 'SC', name: 'Summer Camp', person_id: null, is_person: false }];

describe('counselorNames', () => {
  it('Counselor_IsThePersonsName', () => {
    expect(counselorNames([{ person_id: 7, leader_code: null, people: { display_name: 'Pat Bieser' } }], sources)).toEqual(['Pat Bieser']);
  });

  it('Counselor_IsTheSourcesName_ForANonPersonSource', () => {
    expect(counselorNames([{ person_id: null, leader_code: 'SC', people: null }], sources)).toEqual(['Summer Camp']);
  });

  it('Counselor_ReadsAnEmbeddedArrayOfPeople', () => {
    expect(counselorNames([{ person_id: 7, leader_code: null, people: [{ display_name: 'Pat Bieser' }] }], sources)).toEqual(['Pat Bieser']);
  });

  it('Counselor_WithNoName_IsLeftOut', () => {
    expect(counselorNames([{ person_id: 9, leader_code: null, people: null }], sources)).toEqual([]);
  });
});
