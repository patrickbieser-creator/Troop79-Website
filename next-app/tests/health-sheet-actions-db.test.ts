import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { memoryHealthStorage } from '../src/lib/health-files';
import { centralToday } from '../src/lib/dates';
import type { HealthDeps } from '../src/lib/health-store';

/**
 * The record sheet's writes against the real local database (Plans/Admin-Health-Record-Sheet-Redesign.md). The admin
 * gate is faked at lib/health-access; storage is in memory; no email leaves (the sender is a spy).
 */
const admin = adminClient();
const deps: HealthDeps = { supabase: admin, storage: memoryHealthStorage(), today: centralToday };
const state = vi.hoisted(() => ({ access: null as unknown }));
const sent = vi.hoisted(() => ({ mails: [] as { to: string[]; subject: string }[] }));

vi.mock('../src/lib/health-access', () => ({ healthAdminAccess: async () => state.access, healthDeps: () => deps }));
vi.mock('../src/lib/supabase/server', async () => {
  const { adminClient: client } = await import('./helpers/admin-client');
  return { createAdminClient: () => client() };
});
vi.mock('../src/lib/health-files', async (orig) => ({ ...(await orig<typeof import('../src/lib/health-files')>()), healthFilesConfigured: () => true }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('../src/lib/email', async (orig) => ({
  ...(await orig<typeof import('../src/lib/email')>()),
  sendEmail: async (m: { to: string[]; subject: string; confirm: boolean }) => {
    sent.mails.push(m);
    return { status: m.confirm ? 'sent' : 'dry-run', to: m.to };
  }
}));

import {
  openHealthRecordAction,
  removeHealthPageAdminAction,
  saveHealthGoodUntilAdminAction,
  saveHealthNoteAdminAction,
  sendHealthReminderAdminAction,
  setHealthReviewedAdminAction,
  setImmunizationInBsaFormAdminAction,
  uploadHealthPageAdminAction
} from '../src/app/admin/(workspace)/health-forms/actions';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
let leaderId: number;
let subjectId: number;
let otherId: number;

const asLeader = () => (state.access = { me: { personId: leaderId, name: 'ZZVITEST Sheet Leader' }, family: [], named: true, trips: [] });
const asNobody = () => (state.access = null);
const form = (personId: number, kind = 'insurance', page = 1, goodUntil?: string) => {
  const fd = new FormData();
  fd.set('personId', String(personId));
  fd.set('kind', kind);
  fd.set('page', String(page));
  fd.set('file', new File([JPEG], 'p.jpg', { type: 'image/jpeg' }));
  if (goodUntil) fd.set('goodUntil', goodUntil);
  return fd;
};
const count = async (table: string, personId: number) => (await admin.from(table).select('person_id', { count: 'exact', head: true }).eq('person_id', personId)).count;

async function wipe(personId: number) {
  for (const t of ['health_documents', 'health_access_log', 'health_reviews', 'health_reminders_sent', 'health_immunization_in_bsa_form']) await admin.from(t).delete().eq('person_id', personId);
}

beforeAll(async () => {
  const mk = async (name: string, email: string | null) => {
    const { data, error } = await admin.from('people').insert({ display_name: name, primary_email: email }).select('id').single();
    if (error) throw new Error(error.message);
    return Number(data!.id);
  };
  leaderId = await mk('ZZVITEST Sheet Leader', null);
  subjectId = await mk('ZZVITEST Sheet Adult', 'zzvitest-sheet-adult@example.test');
  otherId = await mk('ZZVITEST Sheet Other', null);
});

afterAll(async () => {
  for (const id of [leaderId, subjectId, otherId]) await wipe(id);
  await admin.from('health_access_log').delete().eq('viewer_person_id', leaderId);
  await admin.from('people').delete().in('id', [leaderId, subjectId, otherId]);
});

beforeEach(async () => {
  await wipe(subjectId);
  await wipe(otherId);
  sent.mails.length = 0;
});

describe('who may write', () => {
  it('NonViewer_CannotRemindUploadReviewOrSetInBsaForm', async () => {
    asNobody();
    const results = await Promise.all([
      sendHealthReminderAdminAction(subjectId),
      uploadHealthPageAdminAction(form(subjectId)),
      removeHealthPageAdminAction('00000000-0000-0000-0000-000000000000', subjectId),
      setHealthReviewedAdminAction(subjectId, true),
      setImmunizationInBsaFormAdminAction(subjectId, true),
      saveHealthGoodUntilAdminAction({ personId: subjectId, kind: 'insurance', goodUntil: '2027-06-01' }),
      saveHealthNoteAdminAction(subjectId, 'Not allowed.')
    ]);
    const written = await Promise.all(['health_reminders_sent', 'health_documents', 'health_reviews', 'health_immunization_in_bsa_form'].map((t) => count(t, subjectId)));
    expect([results.map((r) => r.ok), written, sent.mails.length, await count('health_access_log', subjectId)]).toEqual([[false, false, false, false, false, false, false], [0, 0, 0, 0], 0, 0]);
  });

  it('NonViewer_CannotOpenARecord', async () => {
    asNobody();
    expect((await openHealthRecordAction(subjectId)).ok).toBe(false);
  });
});

describe('Email reminder', () => {
  it('NamedLeader_CanEmailReminder_ForOnePerson_RecordsSentAtAndRecipient', async () => {
    asLeader();
    const res = await sendHealthReminderAdminAction(subjectId);
    expect([res.ok && res.record.lastReminder?.to, res.ok && res.record.lastReminder?.byName, sent.mails.map((m) => m.to)]).toEqual([
      ['zzvitest-sheet-adult@example.test'],
      'ZZVITEST Sheet Leader',
      [['zzvitest-sheet-adult@example.test']]
    ]);
  });

  it('NamedLeader_ReminderCard_ShowsLastSent_AfterReload', async () => {
    asLeader();
    await sendHealthReminderAdminAction(subjectId);
    const opened = await openHealthRecordAction(subjectId);
    expect(opened.ok && opened.record.lastReminder?.to).toEqual(['zzvitest-sheet-adult@example.test']);
  });

  it('Reminder_AsksForPartCAndTheImmunizationRecord_UnlessMarkedOnPartC', async () => {
    asLeader();
    await uploadHealthPageAdminAction(form(subjectId, 'bsa_c'));
    await sendHealthReminderAdminAction(subjectId);
    await setImmunizationInBsaFormAdminAction(subjectId, true);
    await sendHealthReminderAdminAction(subjectId);
    const said = sent.mails.map((m) => {
      const body = (m as unknown as { text?: string; html?: string }).text ?? (m as unknown as { html?: string }).html ?? '';
      return [/Immunization record: missing/.test(body), /Part C: missing/.test(body)];
    });
    expect(said).toEqual([
      [true, false],
      [false, false]
    ]);
  });

  it('Reminder_WithNoEmailOnFile_SaysSo_AndSendsNothing', async () => {
    asLeader();
    const res = await sendHealthReminderAdminAction(otherId);
    expect([res.ok, !res.ok && /no email/i.test(res.error), sent.mails.length]).toEqual([false, true, 0]);
  });
});

describe('writes in the sheet', () => {
  it('UploadForFamily_IsLoggedAsTheNamedLeader_AndAnswersWithTheRecord', async () => {
    asLeader();
    const res = await uploadHealthPageAdminAction(form(subjectId, 'insurance', 1, '2027-05-01'));
    const { data } = await admin.from('health_access_log').select('action, via, viewer_person_id').eq('person_id', subjectId).single();
    expect([res.ok && res.record.pages.map((p) => `${p.kind}:${p.expiresOn}`), data]).toEqual([['insurance:2027-05-01'], { action: 'upload', via: 'named', viewer_person_id: leaderId }]);
  });

  it('GoodUntil_CanBeEdited_ByNamedLeader', async () => {
    asLeader();
    await uploadHealthPageAdminAction(form(subjectId, 'bsa_c'));
    const res = await saveHealthGoodUntilAdminAction({ personId: subjectId, kind: 'bsa_c', goodUntil: '2027-02-02' });
    expect(res.ok && res.record.pages.map((p) => p.expiresOn)).toEqual(['2027-02-02']);
  });

  it('Note_PastedByANamedLeader_IsSaved_AndLogged', async () => {
    asLeader();
    const res = await saveHealthNoteAdminAction(subjectId, '  Pasted from an email.\r\n\r\nSecond paragraph.  ');
    const { data } = await admin.from('health_access_log').select('action, kind, viewer_person_id').eq('person_id', subjectId).single();
    expect([res.ok && res.record.told, data]).toEqual(['Pasted from an email.\n\nSecond paragraph.', { action: 'edit', kind: 'note', viewer_person_id: leaderId }]);
    await admin.from('people').update({ things_we_should_know: null }).eq('id', subjectId);
  });

  it('Note_Blank_ClearsIt', async () => {
    asLeader();
    await saveHealthNoteAdminAction(subjectId, 'Something.');
    const res = await saveHealthNoteAdminAction(subjectId, '   ');
    expect(res.ok && res.record.told).toBeNull();
  });

  it('Note_TooLong_IsRefused_AndNothingIsWritten', async () => {
    asLeader();
    const res = await saveHealthNoteAdminAction(subjectId, 'x'.repeat(10_001));
    expect([res.ok, await count('health_access_log', subjectId)]).toEqual([false, 0]);
  });

  it('Remove_OfAnotherPersonsPage_IsRefused', async () => {
    asLeader();
    const up = await uploadHealthPageAdminAction(form(otherId));
    const pageId = up.ok ? up.record.pages[0].id : '';
    const res = await removeHealthPageAdminAction(pageId, subjectId);
    expect([res.ok, await count('health_documents', otherId)]).toEqual([false, 1]);
  });

  it('NamedLeader_UndoReview_ShowsWhoUndidIt', async () => {
    asLeader();
    await setHealthReviewedAdminAction(subjectId, true);
    const res = await setHealthReviewedAdminAction(subjectId, false);
    expect([res.ok && res.record.review, res.ok && res.record.reviewChange?.action, res.ok && res.record.reviewChange?.byName]).toEqual([null, 'unreview', 'ZZVITEST Sheet Leader']);
  });

  it('InBsaForm_SetByNamedLeader_ShowsWhoSetIt', async () => {
    asLeader();
    const res = await setImmunizationInBsaFormAdminAction(subjectId, true);
    expect(res.ok && res.record.inBsaForm?.byName).toBe('ZZVITEST Sheet Leader');
  });

  it('EveryWrite_LeavesItsOwnLogLine_NotAnOpenedLine', async () => {
    asLeader();
    await setImmunizationInBsaFormAdminAction(subjectId, true);
    await sendHealthReminderAdminAction(subjectId);
    const { data } = await admin.from('health_access_log').select('action, via, viewer_person_id').eq('person_id', subjectId).order('id');
    expect(data).toEqual([
      { action: 'edit', via: 'named', viewer_person_id: leaderId },
      { action: 'remind', via: 'named', viewer_person_id: leaderId }
    ]);
  });

  it('AnAdultWithNoParent_IsTheirOwnContact', async () => {
    asLeader();
    const opened = await openHealthRecordAction(subjectId);
    expect(opened.ok && opened.record.contacts.map((c) => [c.name, c.email])).toEqual([['ZZVITEST Sheet Adult', 'zzvitest-sheet-adult@example.test']]);
  });
});
