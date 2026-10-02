/**
 * Client-side specimen wrappers for /admin/styleguide/public — the shared
 * TabStrip needs client state for its onSelect demo. Display-only.
 */
'use client';

import { useState } from 'react';
import { TabStrip } from '@/app/_components/tab-strip';
import sg from './public-styleguide.module.css';
import { AmountInput, Stepper } from '@/app/_components/stepper';
import { IngredientList } from '@/app/(public)/library/menu-monster/_components/ingredient-list';

export function PublicTabStripSpecimen() {
  const [active, setActive] = useState('week');
  return (
    <TabStrip
      ariaLabel="TabStrip specimen"
      activeKey={active}
      items={[
        { key: 'week', label: 'This Week', count: 4, onSelect: () => setActive('week') },
        { key: 'month', label: 'This Month', onSelect: () => setActive('month') },
        { key: 'all', label: 'All', count: 132, onSelect: () => setActive('all') }
      ]}
    />
  );
}

/** The shared compact dialer, live: a labelled Stepper (Label: − n +), a bare one at its minimum, and the framed cents box. */
export function PublicStepperSpecimen() {
  const [people, setPeople] = useState(8);
  const [days, setDays] = useState(1);
  return (
    <div className={sg.stepperSpecimen}>
      <Stepper
        id="sg-people"
        label="People"
        value={people}
        min={2}
        max={50}
        onChange={setPeople}
        groupLabel="People"
        lessLabel="One fewer person"
        moreLabel="One more person"
      />
      <Stepper
        id="sg-days"
        inputLabel="Days"
        value={days}
        min={1}
        max={14}
        onChange={setDays}
        groupLabel="Days (at its minimum, − is disabled)"
        lessLabel="One fewer day"
        moreLabel="One more day"
      />
      <span>
        $ <AmountInput aria-label="Amount, dollars and cents" defaultValue="12.50" min="0.01" step="0.01" />
      </span>
    </div>
  );
}

/**
 * IngredientList in menu-edit mode, display-only: one row of each state a menu's
 * own version of a recipe can show (changed, swapped, added, left out, plain).
 * The ⋯ menus and both searches are the live component; the actions do nothing.
 */
export function PublicMenuEditListSpecimen() {
  const edit = (id: string, op?: 'amount' | 'swap' | 'leave_out', kind: 'base' | 'added' = 'base') => ({
    kind,
    ingredientId: id,
    currentIngredientId: id,
    qtyPerPerson: 1,
    unitLabel: 'cups',
    baseQty: 1,
    baseName: 'Pancake mix',
    op
  });
  return (
    <IngredientList
      mode="menu-edit"
      ariaLabel="Pancakes ingredients, menu version (specimen)"
      rows={[
        { key: 'a', name: 'Pancake mix', amount: '5 cups', note: null, marker: { kind: 'changed', was: '3½ cups' }, edit: edit('pancake-mix', 'amount') },
        { key: 'b', name: 'Turkey bacon', amount: '16 slices', note: null, marker: { kind: 'swapped', was: 'Bacon' }, edit: edit('bacon', 'swap') },
        { key: 'c', name: 'Eggs', amount: '2', note: null, edit: edit('eggs') },
        { key: 'd', name: 'Syrup', amount: '', note: null, marker: { kind: 'out' }, edit: edit('syrup', 'leave_out') },
        { key: 'e', name: 'Blueberries', amount: '2 cups', note: null, marker: { kind: 'added' }, edit: edit('blueberries', undefined, 'added') }
      ]}
      choices={[
        { id: 'honey', name: 'Honey' },
        { id: 'peaches', name: 'Peaches' }
      ]}
      onAction={() => {}}
      onAnnounce={() => {}}
    />
  );
}
