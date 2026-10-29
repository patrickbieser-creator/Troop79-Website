import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ReqItem } from '../src/app/(public)/planner/this-week-parts';

/** A group card's requirement row: one with sub-requirements opens on a click to list them, each with how many in the
 *  group still need it; closed by default so the card stays short. */
const col = {
  key: 'tenderfoot-4a',
  code: '4a',
  label: 'First Aid for Tenderfoot',
  need: 11,
  subs: [
    { key: 'tenderfoot-4a.1', code: '4a.1', label: 'Simple cuts', need: 8 },
    { key: 'tenderfoot-4a.2', code: '4a.2', label: 'Blisters', need: 6 }
  ]
};

afterEach(cleanup);

describe('ReqItem', () => {
  it('Subs_AreHidden_UntilTheRowIsClicked', () => {
    render(<ul><ReqItem col={col} /></ul>);
    expect(screen.queryByText('Simple cuts')).toBeNull();
  });

  it('ClickingTheRow_ListsEachSubWithItsNeedCount', async () => {
    render(<ul><ReqItem col={col} /></ul>);
    screen.getByRole('button', { name: /4a First Aid for Tenderfoot/ }).click();
    expect((await screen.findByText('Simple cuts')).closest('li')?.textContent).toBe('4a.1Simple cuts8 need it');
  });

  it('TheRow_SaysWhetherItIsOpen', async () => {
    render(<ul><ReqItem col={col} /></ul>);
    const b = screen.getByRole('button', { name: /4a First Aid for Tenderfoot/ });
    b.click();
    await screen.findByText('Blisters');
    expect(b.getAttribute('aria-expanded')).toBe('true');
  });

  it('ARowWithoutSubs_IsPlainText', () => {
    render(<ul><ReqItem col={{ ...col, subs: [] }} /></ul>);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
