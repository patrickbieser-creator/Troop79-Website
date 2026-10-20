import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemberProxyBanner } from '../src/app/(public)/member/member-proxy-banner';
import { HouseholdReadOnly, scoutRows, adultRows } from '../src/app/(public)/profile/household-readonly';

/**
 * Members superuser proxy is READ-ONLY (Patrick, 2026-10-13): the proxied
 * household renders with no form, no input and no button of its own, and the
 * banner names who is being viewed with an exit.
 */
const OPTIONS = [
  { personId: 11, name: 'Anjali S' },
  { personId: 12, name: 'Damian R' }
];

describe('MemberProxyBanner', () => {
  it('MembersProxy_RendersNothing_ForAViewerWithoutProxyRights', () => {
    const { container } = render(<MemberProxyBanner viewer={{ kind: 'own', switchOptions: [] }} />);
    expect(container.innerHTML).toBe('');
  });

  it('MembersProxy_OffersThePicker_WhenNotProxying', () => {
    render(<MemberProxyBanner viewer={{ kind: 'proxy-available', options: OPTIONS }} />);
    expect(screen.getByText(/Superuser: view Members as any active scout/)).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'View as scout' })).toBeTruthy();
  });

  it('MembersProxy_SaysYouAreViewingYourOwnFamily_WhenALeaderIsNotProxying', () => {
    render(<MemberProxyBanner viewer={{ kind: 'own', switchOptions: OPTIONS }} />);
    expect(screen.getByText(/Viewing your own family/)).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'View as scout' })).toBeTruthy();
  });

  it('MembersProxy_NamesTheFamilyAndOffersExit_WhenProxying', () => {
    render(<MemberProxyBanner viewer={{ kind: 'proxy', personId: 11, name: 'Anjali S', switchOptions: OPTIONS }} />);
    expect(screen.getByText('Anjali S', { selector: 'strong' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Exit proxy view' }).getAttribute('href')).toBe('/member');
  });
});

describe('HouseholdReadOnly', () => {
  const members = [
    {
      key: 'scout:anjali',
      name: 'Anjali S',
      role: 'Scout',
      rows: scoutRows({
        id: 'anjali',
        displayName: 'Anjali S',
        nickname: null,
        address_line1: '1 Main St',
        address_line2: null,
        city: 'Milwaukee',
        state: 'WI',
        zip: '53202',
        phone: '414-555-0100',
        email: null,
        school: 'Lincoln',
        graduation_year: 2030,
        swim_class: 'swimmer',
        birthdate: null,
        things_we_should_know: 'Peanut allergy'
      })
    },
    {
      key: 'person:7',
      name: 'Pat S',
      role: 'Dad',
      rows: adultRows({
        personId: 7,
        displayName: 'Pat S',
        nickname: null,
        relationship: 'Dad',
        first_name: 'Pat',
        last_name: 'S',
        birthdate: null,
        primary_email: 'pat@example.com',
        primary_phone: null,
        address_line1: null,
        address_line2: null,
        city: null,
        state: null,
        zip: null
      })
    }
  ];

  it('MembersProxy_ShowsEveryHouseholdMembersDetails', () => {
    render(<HouseholdReadOnly members={members} />);
    expect(screen.getByText('1 Main St, Milwaukee, WI 53202')).toBeTruthy();
    expect(screen.getByText('Peanut allergy')).toBeTruthy();
    expect(screen.getByText('pat@example.com')).toBeTruthy();
  });

  it('MembersProxy_RendersNoSubmitOrSaveControls_WhenViewingAHousehold', () => {
    const { container } = render(<HouseholdReadOnly members={members} />);
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('input, textarea, select')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
