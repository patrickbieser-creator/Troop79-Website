import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { TwTeacher } from '../src/lib/this-week';

/** A group's or class's teachers (any number): the slot names them all, a tap on a name adds or takes off that one
 *  person, and the menu stays open so a planner can pick several. */
const m = vi.hoisted(() => ({ canEdit: true }));
vi.mock('../src/app/(public)/planner/planner-client', () => ({
  usePlanner: () => ({ canEdit: m.canEdit, canEmail: false, sync: { run: (w: () => Promise<unknown>) => w() } }),
  SAVE_FAILED: 'That didn’t save.'
}));
const { TeacherSlot } = await import('../src/app/(public)/planner/this-week-parts');

const t = (personId: number, name: string): TwTeacher => ({ personId, name, kind: 'adult', intent: 'coming', note: null, formal: name });
const A = t(1, 'Ann Vest');
const B = t(2, 'Bo Ruiz');

afterEach(() => {
  cleanup();
  m.canEdit = true;
});

function slot(teachers: TwTeacher[], onSet = vi.fn(async () => true)) {
  render(<TeacherSlot slotKey="fr:tenderfoot" title="the Tenderfoot group" teachers={teachers} candidates={[A, B]} everyone={[A, B]} onSet={onSet} />);
  return onSet;
}

describe('TeacherSlot', () => {
  it('Slot_WithNobody_ReadsNoTeachersYet', () => {
    m.canEdit = false;
    slot([]);
    expect(screen.getByText('No teachers yet')).toBeTruthy();
  });

  it('Slot_WithTwo_NamesBoth', () => {
    m.canEdit = false;
    slot([A, B]);
    expect(screen.getByText('Teachers: Ann Vest and Bo Ruiz')).toBeTruthy();
  });

  it('TappingSomeoneNotTeaching_AddsThem', async () => {
    const onSet = slot([A]);
    screen.getByRole('button', { name: /Teacher: Ann Vest/ }).click();
    (await screen.findByRole('button', { name: /^Bo Ruiz/, pressed: false })).click();
    await vi.waitFor(() => expect(onSet).toHaveBeenCalledWith('fr:tenderfoot', 2, true));
  });

  it('TappingATeacher_TakesThemOff', async () => {
    const onSet = slot([A, B]);
    screen.getByRole('button', { name: /Teachers: Ann Vest and Bo Ruiz/ }).click();
    (await screen.findByRole('button', { name: /^Ann Vest/, pressed: true })).click();
    await vi.waitFor(() => expect(onSet).toHaveBeenCalledWith('fr:tenderfoot', 1, false));
  });

  it('Menu_StaysOpenAfterAPick_SoSeveralCanBeChosen', async () => {
    slot([]);
    screen.getByRole('button', { name: /No teachers yet/ }).click();
    (await screen.findByRole('button', { name: /^Ann Vest/ })).click();
    await vi.waitFor(() => expect(screen.getByRole('region', { name: 'Teachers for the Tenderfoot group' })).toBeTruthy());
  });
});
