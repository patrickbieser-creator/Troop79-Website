import { describe, it, expect } from 'vitest';
import { publicScoutName } from '../src/lib/scout-name';

/** The public "First L." name uses the name a scout goes by (2026-10-20). */
describe('publicScoutName', () => {
  it('PublicName_UsesFirstName_WhenNoNickname', () => {
    expect(publicScoutName({ first_name: 'Alex', last_name: 'Moore' })).toBe('Alex M.');
  });

  it('PublicName_UsesTheNickname_WhenGiven', () => {
    expect(publicScoutName({ first_name: 'Winnefred', last_name: 'Black', nickname: 'Winnie' })).toBe('Winnie B.');
  });

  it('PublicName_UsesTheDisplayNamesFirstPart_WhenThatIsAllItHas', () => {
    expect(publicScoutName({ first_name: 'Aditya', last_name: 'Alfred', display_name: 'Adi Alfred' })).toBe('Adi A.');
  });

  it('PublicName_KeepsATwoWordLastName_OutOfTheFirstName', () => {
    expect(publicScoutName({ first_name: 'Maya', last_name: 'Sankpal-Tatera', display_name: 'Maya Sankpal-Tatera' })).toBe('Maya S.');
  });
});
