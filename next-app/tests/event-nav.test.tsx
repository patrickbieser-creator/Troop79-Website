import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EventNav, eventNavItems } from '../src/app/admin/(workspace)/rosters/[id]/event-nav';

/**
 * One event's leader pages as tabs (Patrick, 2026-08-22: "buttons or tabs
 * consistent with the other admin screens", then "expose the entire
 * navigation at the top at all times … Money and Snapshot are the last
 * things") — the shared TabStrip in link mode, rendered identically by
 * Builder, Roster, the assignments board, Money and Snapshot.
 */
const SETS = [
  { id: 31, label: 'Patrols' },
  { id: 32, label: 'Tents' },
  { id: 33, label: 'Cars there' },
  { id: 34, label: 'Cars back' }
];

describe('EventNav', () => {
  it('EventNav_ListsBuilderRoster_EverySet_ThenMoneyAndSnapshot', () => {
    render(<EventNav signupId={7} active="roster" sets={SETS} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Builder', 'Roster', 'Patrols', 'Tents', 'Cars there', 'Cars back', 'Money', 'Snapshot']);
    expect(tabs.map((t) => t.getAttribute('href'))).toEqual([
      '/admin/events/7',
      '/admin/rosters/7',
      '/admin/rosters/7/assignments?set=31',
      '/admin/rosters/7/assignments?set=32',
      '/admin/rosters/7/assignments?set=33',
      '/admin/rosters/7/assignments?set=34',
      '/admin/rosters/7/money',
      '/admin/rosters/7/snapshot'
    ]);
  });

  it('EventNav_MarksTheCurrentPageOrSetSelected', () => {
    render(<EventNav signupId={7} active="set:32" sets={SETS} />);
    const selected = screen.getAllByRole('tab').filter((t) => t.getAttribute('aria-selected') === 'true');
    expect(selected.map((t) => t.textContent)).toEqual(['Tents']);
  });

  it('EventNav_ShowsNoSetTabs_AndNoPlaceholder_WhenTheEventHasNoSets', () => {
    // A service project: no cars, no patrols — no assignment tabs at all (Patrick, 2026-08-22).
    expect(eventNavItems(3, []).map((i) => i.key)).toEqual(['builder', 'roster', 'money', 'snapshot']);
  });

  it('EventNav_HidesMoney_WhenTheEventHasNoMoney_UnlessYouAreOnIt', () => {
    expect(eventNavItems(3, [], { hasMoney: false }).map((i) => i.key)).toEqual(['builder', 'roster', 'snapshot']);
    expect(eventNavItems(3, [], { hasMoney: false, active: 'money' }).map((i) => i.key)).toEqual(['builder', 'roster', 'money', 'snapshot']);
    render(<EventNav signupId={3} active="roster" hasMoney={false} />);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Builder', 'Roster', 'Snapshot']);
  });
});
