'use client';

/**
 * Menu Monster leader tools — one form for a new food or ingredient.
 *
 * A single food (Cookies, Apples) is three rows in the model: an ingredient, a
 * priced package and a one-line menu item ("each person gets 2 cookies").
 * This form writes them together (actions.ts createFood), so a leader adds a
 * food in one place: the Price book's "+ New ingredient", the Food & recipes
 * tab's "+ New single food", and "+ New ingredient" inside a recipe all open
 * it. Brands and sizes of the same food (Oreos, Chips Ahoy) are more PACKAGES
 * on the one ingredient, added in the Price book.
 *
 * `menuFirst` ticks "on the menu by itself" to start with; the price is
 * optional (an unpriced food is saved as a draft and says so).
 */
import { useState, useTransition } from 'react';
import { Button } from '../../../_components/button';
import { FormPanel } from '../../../_components/form-panel';
import { Notice } from '../../_components/notice';
import { SaveFeedback, useSavePhase } from '../../_components/save-state';
import { FOOD_GROUPS, MEALS, RESTRICTIONS, SECTIONS, UNITS } from '@/lib/menu-monster/units';
import type { FoodGroup, MealSlot, RestrictionKey, Section, Unit, UnitKind } from '@/lib/menu-monster/types';
import { createFood, type FoodResult } from './actions';
import lib from '../library.module.css';
import styles from './menu-monster.module.css';

const VOLUME_UNITS = ['cup', 'tbsp', 'tsp', 'oz'];
const WEIGHT_UNITS = ['gram', 'ozw', 'lb'];
const SECTION_KEYS = Object.keys(SECTIONS) as Section[];

function unitFromChoice(kind: UnitKind, key: string, one: string, many: string): Unit {
  if (kind === 'count') return { key: 'count', one: one.trim(), many: many.trim(), kind: 'count' };
  return UNITS[key] ?? UNITS.cup;
}

const toggle = <T,>(list: T[], key: T, on: boolean): T[] => (on ? (list.includes(key) ? list : [...list, key]) : list.filter((k) => k !== key));

export function NewFoodForm({
  title,
  menuFirst = false,
  stores,
  today,
  onDone,
  onCancel
}: {
  title: string;
  /** Start with "on the menu by itself" ticked (the Food & recipes tab). */
  menuFirst?: boolean;
  stores: readonly string[];
  today: string | null;
  onDone: (res: FoodResult) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<UnitKind>(menuFirst ? 'count' : 'volume');
  const [key, setKey] = useState('cup');
  const [one, setOne] = useState('');
  const [many, setMany] = useState('');
  const [section, setSection] = useState<Section>('dry');
  const [staple, setStaple] = useState(false);
  const [avoid, setAvoid] = useState<RestrictionKey[]>([]);
  const [product, setProduct] = useState('');
  const [store, setStore] = useState('');
  const [price, setPrice] = useState('');
  const [holds, setHolds] = useState('');
  const [onMenu, setOnMenu] = useState(menuFirst);
  const [amount, setAmount] = useState('');
  const [mealFit, setMealFit] = useState<MealSlot[]>([]);
  const [foodGroups, setFoodGroups] = useState<FoodGroup[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const feedback = useSavePhase();

  const unit = unitFromChoice(kind, key, one, many);
  const unitWord = unit.many || 'of them';
  const priced = price.trim() !== '' || holds.trim() !== '';
  const blocker = !name.trim()
    ? 'Name it first'
    : kind === 'count' && !(one.trim() && many.trim())
      ? 'Say what one is called and what several are called'
      : priced && !(Number(price) >= 0 && price.trim() !== '' && Number(holds) > 0)
        ? 'A price needs both what the package costs and how much it holds'
        : onMenu && !amount.trim()
          ? 'Say how much each person gets'
          : onMenu && mealFit.length === 0
            ? 'Pick at least one meal it fits'
            : null;

  function submit() {
    setError(null);
    feedback.start();
    start(async () => {
      const res = await createFood({
        ingredient: { name, unit, section, staple, avoid },
        package: priced ? { name: product, store: store || null, price: Number(price), holds: Number(holds), asOf: today } : null,
        menu: onMenu ? { amount, mealFit, foodGroups } : null
      });
      if (!res.ok) {
        feedback.fail();
        setError(res.error ?? 'Something went wrong.');
        // A later step failed after the ingredient was written: the list behind the form is stale.
        if (res.id) onDone(res);
        return;
      }
      feedback.done();
      onDone(res);
    });
  }

  return (
    <FormPanel title={title} aria-label={title} actions={<SaveFeedback phase={feedback.phase} />}>
      {error && <Notice>{error}</Notice>}
      <div className={lib.fieldGrid}>
        <div className={lib.fieldFull}>
          <label className={`adminLabel ${lib.fieldLabel}`} htmlFor="mm-new-name">
            Name
          </label>
          <input id="mm-new-name" className={lib.textInput} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Required" />
        </div>
        <div>
          <label className={`adminLabel ${lib.fieldLabel}`} htmlFor="mm-new-kind">
            Measured by
          </label>
          <select
            id="mm-new-kind"
            className={lib.selectInput}
            value={kind}
            onChange={(e) => {
              const k = e.target.value as UnitKind;
              setKind(k);
              setKey(k === 'weight' ? 'gram' : 'cup');
            }}
          >
            <option value="count">Count (one, two, three…)</option>
            <option value="volume">Volume (cups, Tbsp…)</option>
            <option value="weight">Weight (g, oz, lb)</option>
          </select>
        </div>
        {kind !== 'count' ? (
          <div>
            <label className={`adminLabel ${lib.fieldLabel}`} htmlFor="mm-new-unit">
              Recipe unit
            </label>
            <select id="mm-new-unit" className={lib.selectInput} value={key} onChange={(e) => setKey(e.target.value)}>
              {(kind === 'volume' ? VOLUME_UNITS : WEIGHT_UNITS).map((k) => (
                <option key={k} value={k}>
                  {UNITS[k].many}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <>
            <div>
              <label className={`adminLabel ${lib.fieldLabel}`} htmlFor="mm-new-one">
                One is called
              </label>
              <input id="mm-new-one" className={lib.textInput} value={one} maxLength={20} onChange={(e) => setOne(e.target.value)} placeholder="cookie" />
            </div>
            <div>
              <label className={`adminLabel ${lib.fieldLabel}`} htmlFor="mm-new-many">
                Several are called
              </label>
              <input id="mm-new-many" className={lib.textInput} value={many} maxLength={20} onChange={(e) => setMany(e.target.value)} placeholder="cookies" />
            </div>
          </>
        )}
        <div>
          <label className={`adminLabel ${lib.fieldLabel}`} htmlFor="mm-new-section">
            Store section
          </label>
          <select id="mm-new-section" className={lib.selectInput} value={section} onChange={(e) => setSection(e.target.value as Section)}>
            {SECTION_KEYS.map((s) => (
              <option key={s} value={s}>
                {SECTIONS[s]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <span className={`adminLabel ${lib.fieldLabel}`}>Flags</span>
          <label className={styles.listRow}>
            <input type="checkbox" checked={staple} onChange={(e) => setStaple(e.target.checked)} /> Patrol-box staple (counts in Used, never Spent)
          </label>
          {RESTRICTIONS.map((r) => (
            <label key={r.key} className={styles.listRow}>
              <input type="checkbox" checked={avoid.includes(r.key)} onChange={(e) => setAvoid((prev) => toggle(prev, r.key, e.target.checked))} /> Warn {r.label.toLowerCase()} people
            </label>
          ))}
        </div>
      </div>

      <fieldset className={styles.fieldset}>
        <legend className={`adminLabel ${lib.fieldLabel}`}>Price (optional — more brands and sizes go in the Price book)</legend>
        <div className={lib.fieldGrid}>
          <div>
            <label className={`adminLabel ${lib.fieldLabel}`} htmlFor="mm-new-product">
              Product on the label
            </label>
            <input id="mm-new-product" className={lib.textInput} value={product} maxLength={120} onChange={(e) => setProduct(e.target.value)} placeholder={name.trim() || 'Chips Ahoy, 13 oz'} />
          </div>
          <div>
            <label className={`adminLabel ${lib.fieldLabel}`} htmlFor="mm-new-store">
              Store
            </label>
            <select id="mm-new-store" className={lib.selectInput} value={store} onChange={(e) => setStore(e.target.value)}>
              <option value="">— not set —</option>
              {stores.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={`adminLabel ${lib.fieldLabel}`} htmlFor="mm-new-price">
              One package costs
            </label>
            <input id="mm-new-price" className={lib.textInput} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[$,\s]/g, ''))} placeholder="4.29" />
          </div>
          <div>
            <label className={`adminLabel ${lib.fieldLabel}`} htmlFor="mm-new-holds">
              One package holds ({unitWord})
            </label>
            <input id="mm-new-holds" className={lib.textInput} inputMode="decimal" value={holds} onChange={(e) => setHolds(e.target.value)} placeholder="36" />
          </div>
        </div>
      </fieldset>

      <label className={styles.listRow}>
        <input type="checkbox" checked={onMenu} onChange={(e) => setOnMenu(e.target.checked)} /> Scouts can put it on a menu by itself
      </label>
      {onMenu && (
        <div className={lib.fieldGrid}>
          <div className={lib.fieldFull}>
            <label className={`adminLabel ${lib.fieldLabel}`} htmlFor="mm-new-amount">
              Each person gets ({unitWord})
            </label>
            <input id="mm-new-amount" className={`${lib.textInput} ${styles.narrow}`} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="2" />
          </div>
          <fieldset className={styles.fieldset}>
            <legend className={`adminLabel ${lib.fieldLabel}`}>Meal fit</legend>
            {MEALS.map((m) => (
              <label key={m.key} className={styles.listRow}>
                <input type="checkbox" checked={mealFit.includes(m.key)} onChange={(e) => setMealFit((p) => toggle(p, m.key, e.target.checked))} /> {m.label}
              </label>
            ))}
          </fieldset>
          <fieldset className={styles.fieldset}>
            <legend className={`adminLabel ${lib.fieldLabel}`}>Food groups (MyPlate)</legend>
            {FOOD_GROUPS.map((g) => (
              <label key={g.key} className={styles.listRow}>
                <input type="checkbox" checked={foodGroups.includes(g.key)} onChange={(e) => setFoodGroups((p) => toggle(p, g.key, e.target.checked))} /> {g.label}
              </label>
            ))}
          </fieldset>
        </div>
      )}

      <div className={lib.actionsRow}>
        <Button variant="primary" disabled={pending || blocker != null} title={blocker ?? undefined} onClick={submit}>
          {pending ? 'Adding…' : onMenu ? 'Add food' : 'Add ingredient'}
        </Button>
        <Button variant="secondary" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </FormPanel>
  );
}
