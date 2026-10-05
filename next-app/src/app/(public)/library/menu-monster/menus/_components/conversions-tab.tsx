/**
 * The Conversions tab of a menu (Patrick, 2026-10-05): "a peek behind the magic curtain" — how Menu Monster
 * gets from what a recipe measures (cups, spoons) to what a store sells (ounces, pounds, gallons). Read-only
 * and written as a lesson, concrete first:
 *
 *   On this menu                   the scout's own foods, worked from the label to how many to buy
 *   Measures that always convert   a cup is a cup — the ladders the planner has built in
 *   Foods with their own number    weight ↔ cups depends on the food — the troop's conversion table
 *
 * Nothing here can be changed (leaders keep the table in the Price book), so it is a server component with
 * no state; everything it shows is decided in lib/menu-monster/conversion-lesson.ts.
 */

import type { ReactNode } from 'react';
import type { FoodRule, UnitLadder, WorkedExample } from '@/lib/menu-monster/conversion-lesson';
import s from './workspace.module.css';

export interface ConversionsTabProps {
  menuName: string;
  examples: WorkedExample[];
  ladders: UnitLadder[];
  rules: FoodRule[];
  tabs?: ReactNode;
  aside?: ReactNode;
}

export function ConversionsTab({ menuName, examples, ladders, rules, tabs, aside }: ConversionsTabProps) {
  return (
    <div>
      <div className={s.titleLine}>
        <h1 className={s.menuTitle}>{menuName.trim() || 'Untitled menu'}</h1>
      </div>
      {aside}
      {tabs != null && <div className={s.tabs}>{tabs}</div>}

      <p className={s.lessonLede}>
        Recipes measure in cups and spoons. Stores sell in ounces, pounds and gallons. This is how Menu Monster gets from one to the other.
      </p>

      <section className={s.section} aria-labelledby="mm-conv-menu">
        <h2 id="mm-conv-menu" className={s.heading}>
          On this menu
        </h2>
        {examples.length === 0 ? (
          <p className={s.foot}>Nothing to convert yet. Foods show up here as they go on the Plan tab.</p>
        ) : (
          <ul className={s.card} aria-label="On this menu">
            {examples.map((e) => (
              <li key={e.ingredientId} className={s.row}>
                <div className={s.rowMain}>
                  <span className={s.lessonName}>{e.name}</span>
                  <span className={s.meta}>
                    Needs {e.need} · {e.packageName}
                  </span>
                </div>
                <div className={s.lessonBuy}>Buy {e.buy}</div>
                <div className={s.inset}>
                  <p className={s.insetLine}>
                    {e.rule}, so {e.math}.
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={s.section} aria-labelledby="mm-conv-ladders">
        <h2 id="mm-conv-ladders" className={s.heading}>
          Measures that always convert
        </h2>
        <p className={s.foot}>A cup is a cup, whatever is in it. These never change, so nobody has to look them up.</p>
        <div className={s.ladders}>
          {ladders.map((l) => (
            <div key={l.key}>
              <h3 id={`mm-conv-${l.key}`} className={s.insetHead}>
                {l.label}
              </h3>
              <ul className={s.plainList} aria-labelledby={`mm-conv-${l.key}`}>
                {l.steps.map((step) => (
                  <li key={step} className={s.insetLine}>
                    {step}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className={s.section} aria-labelledby="mm-conv-foods">
        <h2 id="mm-conv-foods" className={s.heading}>
          Foods with their own number
        </h2>
        <p className={s.foot}>
          A cup of sugar weighs 7 oz. A cup of oats weighs 3. Going between how heavy something is and how much space it fills takes a number for each food.
        </p>
        {rules.length > 0 && (
          <table className={s.lessonTable} aria-labelledby="mm-conv-foods">
            <thead>
              <tr>
                <th scope="col">Food</th>
                <th scope="col">Its number</th>
                <th scope="col">Where it comes from</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={`${r.ingredientId}-${r.rule}`}>
                  <th scope="row">{r.name}</th>
                  <td>{r.rule}</td>
                  <td className={s.muted}>{r.source ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
