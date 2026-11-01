import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { DrawerAsk } from '../src/lib/teacher-asks';
import { TheirTeachingAnswers } from '../src/app/(public)/planner/teacher-answer-for-them';

/** Patrick, 2026-11-01: a teacher texts "I'll be there"; in their drawer an editor records that answer for them. */
const ask = (o: Partial<DrawerAsk> = {}): DrawerAsk => ({ key: 'fr:scout', title: 'Scout Group 1', state: 'asked', enteredBy: null, ...o });

afterEach(cleanup);

function show(asks: DrawerAsk[], onAnswer = vi.fn(async () => true)) {
  render(<TheirTeachingAnswers asks={asks} busy={false} onAnswer={onAnswer} />);
  return onAnswer;
}

describe('TheirTeachingAnswers', () => {
  it('EachClass_SaysWhereTheirAnswerStands', () => {
    show([ask(), ask({ key: 'mb:first-aid', title: 'First Aid', state: 'confirmed', enteredBy: 'Patrick Bieser' })]);
    expect(screen.getAllByRole('listitem').map((li) => li.textContent?.replace(/They said (yes|no)/g, '').trim())).toEqual([
      'Scout Group 1Asked, no answer yet',
      'First Aid✓ Confirmed · entered by PB'
    ]);
  });

  it('TheySaidYes_SavesTheirYes', () => {
    const onAnswer = show([ask()]);
    fireEvent.click(screen.getByRole('button', { name: 'They said yes to Scout Group 1' }));
    expect(onAnswer).toHaveBeenCalledWith('fr:scout', 'yes', null);
  });

  it('AConfirmedClass_OffersOnlyTheirNo', () => {
    show([ask({ state: 'confirmed' })]);
    expect(screen.queryByRole('button', { name: 'They said yes to Scout Group 1' })).toBeNull();
  });

  it('TheySaidNo_AsksWhy_ThenSavesTheirNoWithTheNote', () => {
    const onAnswer = show([ask()]);
    fireEvent.click(screen.getByRole('button', { name: 'They said no to Scout Group 1' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Why not (optional)' }), { target: { value: 'Out of town' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save their no' }));
    expect(onAnswer).toHaveBeenCalledWith('fr:scout', 'no', 'Out of town');
  });
});
