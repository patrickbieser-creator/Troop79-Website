import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChangeRequestRow } from '../src/lib/change-requests';
import HouseholdMembers, {
  type HouseholdMemberView
} from '../src/app/(public)/profile/household-members';
import type { ScoutProfileFields } from '../src/app/(public)/profile/profile-editor';
import type { AdultProfileFields } from '../src/app/(public)/profile/adult-editor';

/**
 * The /profile household switcher, in a real renderer.
 *
 * WHY THESE ARE DOM TESTS. Every behaviour below is invisible to the DB suite:
 * the data was always correct in the cases that shipped broken. D-098 put one
 * member's values under another member's name because a props-seeded form
 * reused its mounted instance — a rendering fault with a clean database
 * behind it. The 2026-08-15 work (a form that shows what is queued, keeps
 * unsubmitted edits across a switch, and disables submit when there is nothing
 * to send) is the same shape: state, not storage.
 *
 * The server actions are vi.fn() — this is the client half of the contract.
 * What lands in `proposed_changes` is decided server-side and covered by
 * change-requests-adult.test.ts.
 */

const MAYA: ScoutProfileFields = {
  id: 'mtest',
  displayName: 'Maya Tester',
  address_line1: '100 Oak St',
  address_line2: null,
  city: 'Milwaukee',
  state: 'WI',
  zip: '53202',
  phone: '(414) 555-0100',
  email: 'maya@example.com',
  school: 'Riverside',
  graduation_year: 2031,
  swim_class: 'swimmer',
  birthdate: '2013-04-02',
  things_we_should_know: null
};

const PATRICK: AdultProfileFields = {
  personId: 501,
  displayName: 'Patrick Tester',
  relationship: 'Dad',
  first_name: 'Patrick',
  last_name: 'Tester',
  birthdate: '1980-01-15',
  primary_email: 'patrick@example.com',
  primary_phone: '(414) 555-0101',
  address_line1: '100 Oak St',
  address_line2: null,
  city: 'Milwaukee',
  state: 'WI',
  zip: '53202'
};

const JAMIE: AdultProfileFields = {
  personId: 502,
  displayName: 'Jamie Tester',
  relationship: 'Mom',
  first_name: 'Jamie',
  last_name: 'Tester',
  birthdate: '1982-06-30',
  primary_email: 'jamie@example.com',
  primary_phone: '(414) 555-0102',
  address_line1: '100 Oak St',
  address_line2: null,
  city: 'Milwaukee',
  state: 'WI',
  zip: '53202'
};

const MEMBERS: HouseholdMemberView[] = [
  { key: 'scout:mtest', name: 'Maya Tester', role: 'Scout', kind: 'scout', hasPending: false },
  { key: 'person:501', name: 'Patrick Tester', role: 'Dad', kind: 'adult', hasPending: false },
  { key: 'person:502', name: 'Jamie Tester', role: 'Mom', kind: 'adult', hasPending: false }
];

function pendingRow(
  entityType: 'scout' | 'adult',
  entityId: string,
  proposed: ChangeRequestRow['proposed_changes']
): ChangeRequestRow {
  return {
    id: 7,
    entity_type: entityType,
    entity_id: entityId,
    submitted_by_person_id: 501,
    submitted_at: '2026-08-15T14:00:00.000Z',
    proposed_changes: proposed,
    status: 'pending',
    reviewed_by: null,
    reviewed_at: null,
    rejection_reason: null
  };
}

type ActionMock = Mock<(formData: FormData) => Promise<void>>;

let submitScout: ActionMock;
let submitAdult: ActionMock;
let withdraw: ActionMock;
let addMember: ActionMock;
let addEmail: ActionMock;
let setPrimaryEmail: ActionMock;
let removeEmail: ActionMock;

beforeEach(() => {
  const noop = (): ActionMock => vi.fn<(formData: FormData) => Promise<void>>(async () => {});
  submitScout = noop();
  submitAdult = noop();
  withdraw = noop();
  addMember = noop();
  addEmail = noop();
  setPrimaryEmail = noop();
  removeEmail = noop();
});

function renderHousehold(opts: {
  pending?: Record<string, ChangeRequestRow>;
  members?: HouseholdMemberView[];
  initialKey?: string | null;
  selfPersonId?: number | null;
  selfEmails?: import('../src/lib/person-emails').PersonEmailRow[];
} = {}) {
  return render(
    <HouseholdMembers
      members={opts.members ?? MEMBERS}
      scouts={{ 'scout:mtest': MAYA }}
      adults={{ 'person:501': PATRICK, 'person:502': JAMIE }}
      pending={opts.pending ?? {}}
      initialKey={opts.initialKey ?? null}
      submitScoutAction={submitScout}
      submitAdultAction={submitAdult}
      withdrawAction={withdraw}
      addMemberAction={addMember}
      canAddMember={false}
      selfPersonId={opts.selfPersonId === undefined ? 501 : opts.selfPersonId}
      selfEmails={opts.selfEmails ?? []}
      addEmailAction={addEmail}
      setPrimaryEmailAction={setPrimaryEmail}
      removeEmailAction={removeEmail}
    />
  );
}

/** The member chip in the tablist — distinct from the panel heading, which
 *  carries the same name. */
function chip(name: string): HTMLElement {
  return within(screen.getByRole('tablist')).getByRole('tab', { name: new RegExp(name) });
}

function field(label: string): HTMLInputElement {
  return screen.getByLabelText(label) as HTMLInputElement;
}

describe('member switcher', () => {
  it('MemberForm_ShowsTheSelectedMembersOwnValues_WhenSwitchingBetweenTwoAdults', async () => {
    // D-098, reported as "Patrick and Jamie Lynn show Maya's profile". Both
    // adults render the SAME component at the SAME tree position, which is the
    // condition that lets a form keep the previous member's state.
    const user = userEvent.setup();
    renderHousehold({ initialKey: 'person:501' });

    // Email is no longer a shared EditField (Plans/Retire-Roster-Contact-
    // Columns.md Phase 2 — the signed-in adult gets the EmailEditor, everyone
    // else a read-only line), so Phone is what proves the D-098 regression
    // stays caught: the selected member's OWN values, not a leaked instance.
    expect(field('Phone').value).toBe('(414) 555-0101');

    await user.click(chip('Jamie Tester'));

    expect(screen.getByRole('heading', { name: 'Jamie Tester' })).toBeTruthy();
    expect(field('Phone').value).toBe('(414) 555-0102');
    expect(field('First Name').value).toBe('Jamie');
  });

  it('MemberForm_KeepsUnsubmittedEdits_WhenSwitchingAwayAndBack', async () => {
    // The workflow the whole draft store exists for: a parent works through
    // the household, and switching member is not a decision to throw work away.
    const user = userEvent.setup();
    renderHousehold({ initialKey: 'person:501' });

    await user.clear(field('Phone'));
    await user.type(field('Phone'), '(414) 555-9999');

    await user.click(chip('Jamie Tester'));
    await user.click(chip('Patrick Tester'));

    expect(field('Phone').value).toBe('(414) 555-9999');
  });

  it('MemberForm_KeepsEachMembersEditsSeparate_WhenBothAreEdited', async () => {
    const user = userEvent.setup();
    renderHousehold({ initialKey: 'person:501' });

    await user.clear(field('First Name'));
    await user.type(field('First Name'), 'Pat');

    await user.click(chip('Jamie Tester'));
    expect(field('First Name').value).toBe('Jamie');

    await user.clear(field('First Name'));
    await user.type(field('First Name'), 'Jay');

    await user.click(chip('Patrick Tester'));
    expect(field('First Name').value).toBe('Pat');
  });

  it('MemberChip_ReadsEdited_WhenAMemberHasUnsubmittedChanges', async () => {
    const user = userEvent.setup();
    renderHousehold({ initialKey: 'person:501' });

    expect(chip('Patrick Tester').textContent).not.toContain('edited');

    await user.type(field('City'), 'x');

    expect(chip('Patrick Tester').textContent).toContain('edited');
  });
});

describe('email addresses — self vs. another household adult', () => {
  // Plans/Retire-Roster-Contact-Columns.md Phase 2: only the signed-in
  // adult gets add/promote/remove controls for their own addresses; every
  // other adult in the household shows a read-only line instead. A rendering
  // concern (same class of bug as D-098 above), so it belongs in this suite,
  // not the db one.
  const patrickEmails = [
    {
      id: 1,
      personId: 501,
      email: 'patrick@example.com',
      label: 'home' as const,
      isPrimary: true,
      verifiedAt: null,
      bouncedAt: null,
      unsubscribedAt: null
    }
  ];

  it('SelfAdult_SeesTheEmailEditor_WithAddPromoteRemoveControls', () => {
    renderHousehold({ initialKey: 'person:501', selfPersonId: 501, selfEmails: patrickEmails });

    // The EmailEditor's own address rows, not an <input>.
    expect(screen.getByText('patrick@example.com')).toBeTruthy();
    expect(screen.getByLabelText('New email address')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add address' })).toBeTruthy();
  });

  it('AnotherAdult_SeesEmailReadOnly_NotTheEmailEditor', async () => {
    const user = userEvent.setup();
    renderHousehold({ initialKey: 'person:501', selfPersonId: 501, selfEmails: patrickEmails });

    await user.click(chip('Jamie Tester'));

    // Jamie's own address, shown as plain text — no add-address control for
    // an address that isn't the signed-in adult's own.
    expect(screen.getByText('jamie@example.com')).toBeTruthy();
    expect(screen.queryByLabelText('New email address')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add address' })).toBeNull();
  });
});

describe('a form that shows what is pending', () => {
  const pendingPatrick = {
    'person:501': pendingRow('adult', '501', { primary_phone: '(414) 555-7777' })
  };

  it('MemberForm_ShowsTheProposedValue_WhenAnUpdateIsAwaitingReview', () => {
    // The reversal: the field used to show the LIVE value with a banner naming
    // which fields had changed, so a family could never re-read what it sent.
    renderHousehold({ initialKey: 'person:501', pending: pendingPatrick });

    expect(field('Phone').value).toBe('(414) 555-7777');
  });

  it('MemberForm_StillShowsTheLiveValue_WhenAFieldIsAwaitingReview', () => {
    // Showing the proposal must not hide the record — that is the value a
    // leader is still looking at.
    renderHousehold({ initialKey: 'person:501', pending: pendingPatrick });

    const note = document.getElementById('pf-primary_phone-note');
    expect(note?.textContent).toContain('(414) 555-0101');
    expect(field('Phone').getAttribute('aria-describedby')).toBe('pf-primary_phone-note');
  });

  it('MemberForm_MarksOnlyTheProposedFields_WhenAnUpdateIsAwaitingReview', () => {
    renderHousehold({ initialKey: 'person:501', pending: pendingPatrick });

    expect(document.getElementById('pf-primary_phone-note')).not.toBeNull();
    expect(document.getElementById('pf-primary_email-note')).toBeNull();
  });

  it('BirthdateField_IsDescribedByItsPendingNote_LikeEveryOtherField', () => {
    // DatePickerField is a shared admin component with an explicit prop list,
    // so it had to be taught aria-describedby — without it the one field that
    // isn't a plain <input> would announce with no pending context at all.
    renderHousehold({
      initialKey: 'person:501',
      pending: { 'person:501': pendingRow('adult', '501', { birthdate: '1982-07-01' }) }
    });

    expect(screen.getByLabelText('Birthdate').getAttribute('aria-describedby')).toBe(
      'pf-birthdate-note'
    );
  });

  it('MemberForm_KeepsThePendingValue_WhenSwitchingAwayAndBack', async () => {
    // The originally reported symptom: submit, switch, come back, and the
    // update you made is nowhere on screen.
    const user = userEvent.setup();
    renderHousehold({ initialKey: 'person:501', pending: pendingPatrick });

    await user.click(chip('Jamie Tester'));
    await user.click(chip('Patrick Tester'));

    expect(field('Phone').value).toBe('(414) 555-7777');
  });

  it('ScoutForm_ShowsTheProposedGrade_WhenGraduationYearIsAwaitingReview', () => {
    // graduation_year is the one field the form doesn't edit directly — the
    // control offers a grade, so a pending value has to convert on the way in.
    renderHousehold({
      initialKey: 'scout:mtest',
      pending: { 'scout:mtest': pendingRow('scout', 'mtest', { graduation_year: 2030 }) }
    });

    const live = screen.getByLabelText('Grade') as HTMLSelectElement;
    // One year earlier than the live 2031 record means one grade higher.
    expect(live.value).not.toBe('');
    expect(document.getElementById('pf-graduation_year-note')).not.toBeNull();
  });
});

describe('submit is offered only when there is something to send', () => {
  it('Submit_IsDisabled_WhenNothingHasBeenEdited', () => {
    renderHousehold({ initialKey: 'person:501' });

    expect((screen.getByRole('button', { name: 'Submit update' }) as HTMLButtonElement).disabled).toBe(
      true
    );
    expect(screen.getByText('No changes to submit.')).toBeTruthy();
  });

  it('Submit_IsDisabled_WhenTheFormMatchesWhatIsAlreadyQueued', () => {
    // Nothing further has changed, so there is nothing to resubmit — the
    // pending row already says it.
    renderHousehold({
      initialKey: 'person:501',
      pending: { 'person:501': pendingRow('adult', '501', { primary_phone: '(414) 555-7777' }) }
    });

    const button = screen.getByRole('button', {
      name: 'Replace pending update'
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('Submit_Enables_WhenAFieldIsEdited', async () => {
    const user = userEvent.setup();
    renderHousehold({ initialKey: 'person:501' });

    await user.type(field('City'), 'x');

    expect((screen.getByRole('button', { name: 'Submit update' }) as HTMLButtonElement).disabled).toBe(
      false
    );
  });

  it('Submit_StaysDisabled_WhenAnEditIsOnlyWhitespace', async () => {
    // The server trims before diffing (parseFieldValue), so the button must
    // agree — otherwise it invites a submit the server answers with "nothing
    // changed".
    const user = userEvent.setup();
    renderHousehold({ initialKey: 'person:501' });

    await user.type(field('City'), '   ');

    expect((screen.getByRole('button', { name: 'Submit update' }) as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  it('Submit_SendsTheEditedValue_WhenReplacingAPendingUpdate', async () => {
    const user = userEvent.setup();
    renderHousehold({
      initialKey: 'person:501',
      pending: { 'person:501': pendingRow('adult', '501', { primary_phone: '(414) 555-7777' }) }
    });

    await user.clear(field('Phone'));
    await user.type(field('Phone'), '(414) 555-8888');
    await user.click(screen.getByRole('button', { name: 'Replace pending update' }));

    expect(submitAdult).toHaveBeenCalledTimes(1);
    const sent = submitAdult.mock.calls[0][0] as FormData;
    expect(sent.get('primary_phone')).toBe('(414) 555-8888');
    expect(sent.get('personId')).toBe('501');
  });

  it('Submit_SendsEveryEditableField_SoTheServerCanDiffTheWholeRecord', async () => {
    const user = userEvent.setup();
    renderHousehold({ initialKey: 'scout:mtest' });

    await user.clear(field('School'));
    await user.type(field('School'), 'Lakeside');
    await user.click(screen.getByRole('button', { name: 'Submit update' }));

    const sent = submitScout.mock.calls[0][0] as FormData;
    expect(sent.get('school')).toBe('Lakeside');
    // Unchanged fields still travel — the diff is the server's job, and an
    // absent key would read as "not offered" rather than "not changed".
    expect(sent.get('city')).toBe('Milwaukee');
    expect(sent.get('graduation_year')).toBe('2031');
  });
});

describe('discarding and withdrawing', () => {
  const pendingPatrick = {
    'person:501': pendingRow('adult', '501', { primary_phone: '(414) 555-7777' })
  };

  it('DiscardEdits_RestoresThePendingValue_WhenTheFormHadBeenEditedFurther', async () => {
    const user = userEvent.setup();
    renderHousehold({ initialKey: 'person:501', pending: pendingPatrick });

    await user.clear(field('Phone'));
    await user.type(field('Phone'), '(414) 555-0000');
    await user.click(screen.getByRole('button', { name: 'Discard edits' }));

    // Back to what is queued, NOT back to the live record — discarding an edit
    // is not withdrawing a submission.
    expect(field('Phone').value).toBe('(414) 555-7777');
  });

  it('DiscardEdits_LeavesOtherMembersEditsAlone_WhenClicked', async () => {
    const user = userEvent.setup();
    renderHousehold({ initialKey: 'person:501' });

    await user.type(field('City'), 'x');
    await user.click(chip('Jamie Tester'));
    await user.type(field('City'), 'y');
    await user.click(screen.getByRole('button', { name: 'Discard edits' }));

    await user.click(chip('Patrick Tester'));
    expect(field('City').value).toBe('Milwaukeex');
  });

  it('Undo_IsNotOffered_WhenNothingIsPending', () => {
    renderHousehold({ initialKey: 'person:501' });

    expect(screen.queryByRole('button', { name: 'Undo pending update' })).toBeNull();
  });

  it('Undo_AsksBeforeRemoving_WhenClicked', async () => {
    const user = userEvent.setup();
    renderHousehold({ initialKey: 'person:501', pending: pendingPatrick });

    await user.click(screen.getByRole('button', { name: 'Undo pending update' }));

    expect(screen.getByRole('button', { name: 'Yes, remove it' })).toBeTruthy();
    expect(withdraw).not.toHaveBeenCalled();
  });

  it('Undo_DoesNothing_WhenTheConfirmationIsDeclined', async () => {
    const user = userEvent.setup();
    renderHousehold({ initialKey: 'person:501', pending: pendingPatrick });

    await user.click(screen.getByRole('button', { name: 'Undo pending update' }));
    await user.click(screen.getByRole('button', { name: 'Keep it' }));

    expect(withdraw).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Undo pending update' })).toBeTruthy();
  });

  it('Undo_SendsTheEntityToTheWithdrawAction_WhenConfirmed', async () => {
    const user = userEvent.setup();
    renderHousehold({ initialKey: 'person:501', pending: pendingPatrick });

    await user.click(screen.getByRole('button', { name: 'Undo pending update' }));
    await user.click(screen.getByRole('button', { name: 'Yes, remove it' }));

    expect(withdraw).toHaveBeenCalledTimes(1);
    const sent = withdraw.mock.calls[0][0] as FormData;
    expect(sent.get('entityType')).toBe('adult');
    expect(sent.get('entityId')).toBe('501');
  });

  it('Undo_SendsTheScoutId_WhenTheMemberIsAScout', async () => {
    const user = userEvent.setup();
    renderHousehold({
      initialKey: 'scout:mtest',
      pending: { 'scout:mtest': pendingRow('scout', 'mtest', { city: 'Shorewood' }) }
    });

    await user.click(screen.getByRole('button', { name: 'Undo pending update' }));
    await user.click(screen.getByRole('button', { name: 'Yes, remove it' }));

    const sent = withdraw.mock.calls[0][0] as FormData;
    expect(sent.get('entityType')).toBe('scout');
    expect(sent.get('entityId')).toBe('mtest');
  });

  it('UndoConfirmation_Resets_WhenSwitchingToAnotherMember', async () => {
    // The confirmation is transient UI on a form that is about to be replaced;
    // carrying it across a switch would arm a destructive button for a member
    // the family never asked about.
    const user = userEvent.setup();
    renderHousehold({
      initialKey: 'person:501',
      pending: {
        'person:501': pendingRow('adult', '501', { primary_phone: '(414) 555-7777' }),
        'person:502': pendingRow('adult', '502', { primary_phone: '(414) 555-6666' })
      }
    });

    await user.click(screen.getByRole('button', { name: 'Undo pending update' }));
    await user.click(chip('Jamie Tester'));

    expect(screen.queryByRole('button', { name: 'Yes, remove it' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Undo pending update' })).toBeTruthy();
  });
});
