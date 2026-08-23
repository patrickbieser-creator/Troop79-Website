import { describe, it, expect } from 'vitest';
import { guestModePresetFor, defaultGuestPrompt, GUEST_MODE_PRESETS } from '../src/lib/guest-mode';
import { GUEST_MODES, isGuestMode } from '../src/lib/event-signup';

/**
 * Guests as People (Plans/Guests-As-People.md): the Builder's guest mode is
 * seeded by category — count where only the number matters, named where the
 * people do (overnight, priced), none elsewhere.
 */
describe('guest mode presets (pure)', () => {
  it('Builder_GuestMode_DefaultsByCategory', () => {
    expect(guestModePresetFor('Ceremony / Recognition')).toBe('count');
    expect(guestModePresetFor('Service Project')).toBe('count');
    expect(guestModePresetFor('Recruiting / Outreach')).toBe('count');
    expect(guestModePresetFor('Social Event')).toBe('count');
    expect(guestModePresetFor('Fundraiser')).toBe('count');
    expect(guestModePresetFor('Campout / Overnight')).toBe('named');
    expect(guestModePresetFor('Summer Camp')).toBe('named');
    expect(guestModePresetFor('High Adventure')).toBe('named');
  });

  it('Builder_GuestMode_IsNone_ForEverythingElse', () => {
    expect(guestModePresetFor('Training')).toBe('none');
    expect(guestModePresetFor('Day Activity / Outing')).toBe('none');
    expect(guestModePresetFor('Leadership / Planning')).toBe('none');
    expect(guestModePresetFor('Something New')).toBe('none');
    expect(guestModePresetFor(null)).toBe('none');
    expect(guestModePresetFor(undefined)).toBe('none');
  });

  it('Presets_OnlyEverNameAValidMode', () => {
    for (const mode of Object.values(GUEST_MODE_PRESETS)) expect(GUEST_MODES).toContain(mode);
    expect(isGuestMode('count')).toBe(true);
    expect(isGuestMode('maybe')).toBe(false);
  });

  it('DefaultPrompt_AsksForANumberInCountMode_AndNamesOtherwise', () => {
    expect(defaultGuestPrompt('count')).toBe('How many guests are you bringing?');
    expect(defaultGuestPrompt('named')).toBe('Bringing anyone else?');
  });
});
