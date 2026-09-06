import { describe, it, expect } from 'vitest';
import { parseNewAdults, newAdultEmailError } from '../src/lib/new-adults';

/**
 * 2026-09-06: an adult signing up for the Eagle Court of Honor typed something
 * that was not an email address into the on-the-fly "Add another parent or
 * guardian" email box. The value went straight to `add_parent_to_household`,
 * whose `people.primary_email` trigger inserts into `person_emails`, and the
 * whole signup bounced with the raw Postgres message
 * `new row for relation "person_emails" violates check constraint
 * "person_emails_email_shape"`. Nobody can act on that. The shape check now
 * happens in the action, before any write, with a message that names the
 * adult and the value so the family can fix it.
 */
describe('newAdultEmailError', () => {
  it('Family_GetsNoError_WhenTheEmailIsBlank', () => {
    expect(newAdultEmailError('Jodi K', '')).toBeNull();
    expect(newAdultEmailError('Jodi K', '   ')).toBeNull();
  });

  it('Family_GetsNoError_WhenTheEmailLooksLikeOne', () => {
    expect(newAdultEmailError('Jodi K', 'jodi@example.com')).toBeNull();
    expect(newAdultEmailError('Jodi K', '  Jodi@Example.com ')).toBeNull();
  });

  it('Family_IsToldWhichAdultAndValue_WhenTheEmailHasNoAtSign', () => {
    const msg = newAdultEmailError('Jodi K', '414-555-0100');
    expect(msg).toContain('Jodi K');
    expect(msg).toContain('414-555-0100');
    expect(msg).toMatch(/email/i);
  });

  it('Family_IsToldTheEmailIsWrong_WhenItHasNoDomain', () => {
    expect(newAdultEmailError('Jodi K', 'jodi@')).not.toBeNull();
    expect(newAdultEmailError('Jodi K', '@example.com')).not.toBeNull();
  });
});

describe('parseNewAdults', () => {
  it('Action_GetsAnEmptyList_WhenTheFieldIsMissingOrNotJson', () => {
    expect(parseNewAdults(null)).toEqual({ ok: true, adults: [] });
    expect(parseNewAdults('')).toEqual({ ok: true, adults: [] });
    expect(parseNewAdults('not json')).toEqual({ ok: true, adults: [] });
    expect(parseNewAdults('{"a":1}')).toEqual({ ok: true, adults: [] });
  });

  it('Action_DropsNamelessRows_AndTrimsTheRest', () => {
    const raw = JSON.stringify([
      { name: '  ', email: 'x@y.com', relationship: 'Mom' },
      { name: ' Jodi K ', email: ' jodi@example.com ', relationship: ' Mom ' },
      { name: 'Sam K', email: '', relationship: '' }
    ]);
    expect(parseNewAdults(raw)).toEqual({
      ok: true,
      adults: [
        { name: 'Jodi K', email: 'jodi@example.com', relationship: 'Mom' },
        { name: 'Sam K', email: null, relationship: null }
      ]
    });
  });

  it('Action_StopsBeforeAnyWrite_WhenOneEmailIsMalformed', () => {
    const raw = JSON.stringify([
      { name: 'Sam K', email: 'sam@example.com' },
      { name: 'Jodi K', email: 'jodi kleinfeld' }
    ]);
    const res = parseNewAdults(raw);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('Jodi K');
      expect(res.error).toContain('jodi kleinfeld');
    }
  });
});
