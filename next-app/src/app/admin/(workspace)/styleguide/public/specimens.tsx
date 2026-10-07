/**
 * Client-side specimen wrappers for /admin/styleguide/public — the shared
 * TabStrip needs client state for its onSelect demo. Display-only.
 */
'use client';

import { useState } from 'react';
import { TabStrip } from '@/app/_components/tab-strip';
import { Button } from '@/app/_components/button';
import { Field, SaveProblem, TextInput } from '@/app/_components/form';
import sg from './public-styleguide.module.css';
import { AmountInput, Stepper } from '@/app/_components/stepper';
import { IngredientList } from '@/app/(public)/library/menu-monster/_components/ingredient-list';
import { AmountEditor } from '@/app/(public)/library/menu-monster/_components/ingredient-list-edit';
import { GearChips, GearPicker } from '@/app/(public)/library/menu-monster/_components/gear-picker';
import { sortGear, type GearItem } from '@/lib/menu-monster/gear';
import { FinishLine } from '@/app/(public)/library/menu-monster/menus/_components/finish-line';
import type { RestrictionKey } from '@/lib/menu-monster/types';

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

/** A small fixed gear list for the GearPicker / GearChips specimens. */
const SPECIMEN_GEAR: GearItem[] = ['Dutch oven', 'Griddle', 'Lantern', 'Skillet', 'Two-burner stove'].map((name, i) => ({
  id: i + 1,
  name,
  home: 'trailer',
  perPerson: false,
  retiredAt: null,
  description: name === 'Dutch oven' ? 'Cast iron, 12 inch, with lid; trailer, left bin' : null
}));

/** The blocked-save standard (D-331), live: Add stays enabled; pressed empty it marks the field and says why beside the button. */
export function PublicBlockedSaveSpecimen() {
  const [name, setName] = useState('');
  const [tried, setTried] = useState(false);
  const bad = tried && !name.trim();
  return (
    <div className={sg.stepperSpecimen}>
      <Field label="Name" problem={bad ? 'Give it a name.' : undefined}>
        <TextInput value={name} autoComplete="off" onChange={(e) => setName(e.target.value)} />
      </Field>
      <span>
        <Button size="sm" variant="primary" onClick={() => setTried(true)}>
          Add food
        </Button>{' '}
        <SaveProblem action="add" reason={bad ? 'give it a name' : null} />
      </span>
    </div>
  );
}

/** GearPicker + GearChips live: pick from the troop's list (never typed in), then dial the count or remove. */
export function PublicGearSpecimen() {
  const [gear, setGear] = useState<string[]>(['Skillet × 2', 'Griddle']);
  return (
    <div>
      <GearChips gear={gear} onChange={setGear} idPrefix="sg-" />
      <GearPicker list={SPECIMEN_GEAR} taken={gear} onPick={(name) => setGear(sortGear([...gear, name]))} />
    </div>
  );
}

/**
 * IngredientList in menu-edit mode on a meal with a gluten-free and a vegetarian scout: the three
 * diet-scoped row states (only for a diet, everyone except a diet, a diet nobody on the meal is in)
 * and the "Add for" choice beside the add search. Display-only.
 */
export function PublicDietRowsSpecimen() {
  const edit = (id: string, scope?: RestrictionKey) => ({
    kind: 'base' as const,
    ingredientId: id,
    currentIngredientId: id,
    qtyPerPerson: 1,
    unitLabel: 'cups',
    scope
  });
  return (
    <IngredientList
      mode="menu-edit"
      ariaLabel="Pancakes ingredients, diet rows (specimen)"
      rows={[
        { key: 'a', name: 'Pancake mix', amount: '3½ cups', note: null, scope: { mode: 'except', restrictions: ['gf'], idle: false }, edit: edit('pancake-mix') },
        { key: 'b', name: 'Almond flour', amount: '1 cup', note: null, scope: { mode: 'only', restrictions: ['gf'], idle: false }, marker: { kind: 'added' }, edit: edit('almond-flour', 'gf') },
        { key: 'c', name: 'Dairy-free butter', amount: '', note: null, scope: { mode: 'only', restrictions: ['dairy'], idle: true }, marker: { kind: 'added' }, edit: edit('df-butter', 'dairy') }
      ]}
      choices={[
        { id: 'honey', name: 'Honey' },
        { id: 'peaches', name: 'Peaches' }
      ]}
      restrictions={{ gf: 2, nut: 0, dairy: 0, veg: 1 }}
      onAction={() => {}}
      onAnnounce={() => {}}
    />
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

/** The Shopping step's finishing line in both states: ready (Print + Share) and something left to fix (a link to it). Display-only. */
export function PublicFinishLineSpecimen() {
  return (
    <div>
      <FinishLine toFix={0} fix={{ href: '#' }} onPrint={() => {}} shareHref="#" />
      <FinishLine toFix={2} fix={{ href: '#' }} onPrint={() => {}} />
    </div>
  );
}

/** The amount box of a recipe being written: a number, its unit, and what it is for (each person, or the whole meal). Display-only. */
export function PublicAmountScaleSpecimen() {
  return <AmountEditor name="Cooking oil" unitLabel="cups" value={4} scale="meal" canScale onCommit={() => {}} onCancel={() => {}} />;
}
