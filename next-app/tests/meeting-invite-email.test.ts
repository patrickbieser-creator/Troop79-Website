import { describe, it, expect } from 'vitest';
import { DEFAULT_PICK_INVITE, DEFAULT_TEACH_INVITE, renderPickInvite, renderTeachInvite } from '../src/lib/meeting-invite-email';
import { fromWithName } from '../src/lib/email';
import { templateKind } from '../src/lib/email-templates';

/** Meeting invites, P1: the teacher invite email (Plans/Matcher-Tune-Up.md T-5). */

const vals = {
  name: 'Dan',
  topic: 'First Aid for Tenderfoot',
  code: 'Tenderfoot 4a',
  minutes: 'about 40 min',
  parts: ['4a.1 Simple cuts', '4a.2 Blisters'],
  day: 'Sunday, October 25'
};

describe('teacher invite email', () => {
  it('Invite_NamesTheTopicDayAndTime_InTheDefaultCopy', () => {
    const r = renderTeachInvite(DEFAULT_TEACH_INVITE, vals);
    expect([r.subject, r.md.includes('First Aid for Tenderfoot'), r.md.includes('Sunday, October 25'), r.md.includes('about 40 min')]).toEqual([
      'Can you teach First Aid for Tenderfoot on Sunday, October 25?',
      true,
      true,
      true
    ]);
  });

  it('Invite_ListsTheParts_WhenTheTopicHasThem', () => {
    expect(renderTeachInvite(DEFAULT_TEACH_INVITE, vals).md).toContain('- 4a.1 Simple cuts\n- 4a.2 Blisters');
  });

  it('Invite_DropsThePartsLine_WhenThereAreNone', () => {
    expect(renderTeachInvite(DEFAULT_TEACH_INVITE, { ...vals, parts: [] }).md).not.toContain('[parts]');
  });

  it('Invite_ComesFromTheTroop79Bugler_KeepingTheConfiguredAddress', () => {
    expect([fromWithName('Troop 79 <news@troop-79.com>', 'Troop 79 Bugler'), fromWithName('news@troop-79.com', 'Troop 79 Bugler')]).toEqual([
      'Troop 79 Bugler <news@troop-79.com>',
      'Troop 79 Bugler <news@troop-79.com>'
    ]);
  });

  it('InviteCopy_IsAnEditableTemplateKind', () => {
    expect(templateKind('meeting.invite.teacher')?.fields.map((f) => f.token)).toEqual(['name', 'topic', 'code', 'minutes', 'parts', 'day']);
  });

  it('ScoutInvite_ToAParent_CarriesALinkForEachScout', () => {
    const r = renderPickInvite(DEFAULT_PICK_INVITE, { ...vals, scouts: 'Anjali S and Finn S' }, [
      { scoutName: 'Anjali S', url: 'https://x/i/a' },
      { scoutName: 'Finn S', url: 'https://x/i/b' }
    ], false);
    expect([r.md.includes('[Answer for Anjali S](https://x/i/a)'), r.md.includes('[Answer for Finn S](https://x/i/b)'), r.md.includes('Reply to a leader')]).toEqual([true, true, true]);
  });

  it('ScoutInvite_ToTheScout_HasOneAnswerLink', () => {
    const r = renderPickInvite(DEFAULT_PICK_INVITE, { ...vals, scouts: 'you' }, [{ scoutName: 'Anjali S', url: 'https://x/i/a' }], true);
    expect([r.md.includes('[Answer the invite](https://x/i/a)'), r.md.includes('Answer for')]).toEqual([true, false]);
  });
});
