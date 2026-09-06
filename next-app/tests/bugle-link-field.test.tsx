import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BugleLinkField, bugleRegisterLink, BUGLE_MERGE_TAG } from '../src/app/admin/(workspace)/events/[id]/bugle-link-field';

/** Plans/Bugle-Register-Now-Links.md, decision B11 — the one place the
 *  EmailOctopus merge tag is spelled. */
describe('BugleLinkField', () => {
  it('BugleLink_TargetsTheIntake_WithTheMergeTagAndThisEventsSignupPath', () => {
    const link = bugleRegisterLink(123, 'https://www.troop-79.com');
    expect(link).toBe(`https://www.troop-79.com/signin/hint?for=${BUGLE_MERGE_TAG}&next=%2Fevents%2F123%2Fsignup`);
  });

  it('BugleLink_MergeTag_IsNotUrlEncoded', () => {
    // EmailOctopus must see the literal tag to substitute it; an encoded
    // `%7B%7BEmailAddress%7D%7D` would ship to every family verbatim.
    expect(bugleRegisterLink(1, 'https://x')).toContain('for={{EmailAddress}}');
  });

  it('BugleLinkField_RendersTheLinkReadOnly_WithACopyButton', () => {
    render(<BugleLinkField calendarEntryId={7} />);
    const input = screen.getByLabelText('Bugle Register Now link') as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    expect(input.value).toContain('/signin/hint?for={{EmailAddress}}&next=%2Fevents%2F7%2Fsignup');
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
  });
});
