/**
 * Menu Monster — the store sheet + counselor summary. Rendered on every
 * paint, shown only under @media print (D-017: a fixed, explicit print
 * template, not a "print what's on screen" gamble). Copy is the validated
 * prototype's, verbatim where it mattered to Patrick: blank Qty bought /
 * Actual price boxes, a "Bringing, not buying" table, the totals box with an
 * actual-total blank, and the counselor summary with the cross-contamination
 * checklist and signature lines.
 *
 * The site chrome, the shelf header and the resource list are hidden for
 * this page by the `body:has(#mm-print-sheet)` rule in globals.css (same
 * mechanism as the Scout Clipboard's opt-out).
 */
import { fmtDateFull } from '@/lib/format-date';
import { money } from '@/lib/event-money';
import type { Catalog, Plan, RestrictionWarning, ShoppingLine, Totals } from '@/lib/menu-monster/types';
import { RESTRICTIONS, SECTIONS, SECTION_ORDER, qtyText } from '@/lib/menu-monster/units';
import { effectiveRestrictions, isUsable, packCount, packNoun, sourcesText } from '@/lib/menu-monster/engine';
import { MEALS } from '@/lib/menu-monster/units';
import s from './planner.module.css';

const REQUIREMENT = 'Cooking 5b';

export function PrintSheet({
  plan,
  catalog,
  lines,
  totals: t,
  warnings
}: {
  plan: Plan;
  catalog: Catalog;
  lines: ShoppingLine[];
  totals: Totals;
  warnings: RestrictionWarning[];
}) {
  const R = effectiveRestrictions(plan);
  const active = RESTRICTIONS.filter((r) => R[r.key] > 0);
  const restrTxt = active.map((r) => `${r.label}: ${R[r.key]}`).join(', ') || 'None';
  const dateTxt = plan.date ? fmtDateFull(plan.date) : '________';
  const buyable = lines.filter((l) => l.status !== 'staple' && l.status !== 'bring');
  const bringing = lines.filter((l) => l.status === 'bring');
  const staples = lines.filter((l) => l.status === 'staple');
  const sections = SECTION_ORDER.filter((sec) => buyable.some((l) => l.ing.section === sec));
  const RCP = new Map(catalog.recipes.map((r) => [r.id, r]));
  const ING = new Map(catalog.ingredients.map((i) => [i.id, i]));
  const menuNames = plan.recipeIds.map((id) => RCP.get(id)?.name ?? id).join(', ') || 'No menu items chosen';
  const mealLabel = MEALS.find((m) => m.key === plan.meal)?.label ?? plan.meal;
  const H = plan.headcount;

  const accommodated = active.map((r) => {
    const swaps: string[] = [];
    for (const rid of plan.recipeIds) {
      const rc = RCP.get(rid);
      if (!rc) continue;
      const only = rc.lines.filter((l) => l.servesRule === 'only' && l.servesRestriction === r.key);
      if (only.length) {
        swaps.push(`${rc.name}: ${only.map((l) => (ING.get(l.ingredientId)?.name ?? l.ingredientId).toLowerCase()).join(', ')}`);
      }
    }
    return { r, text: swaps.length ? swaps.join('; ') : 'no substitutions in this menu' };
  });

  return (
    <section id="mm-print-sheet" className={s.printSheet}>
      <div className={s.pKicker}>Troop 79 · Menu Monster · Shopping list</div>
      <h1 className={s.pTitle}>
        {mealLabel} — {plan.patrol.trim() || '______________________'}
      </h1>
      <div className={s.pMeta}>
        <span>
          <b>Date:</b> {dateTxt}
        </span>
        <span>
          <b>People eating:</b> {H} (scouts and adults)
        </span>
        <span>
          <b>Restrictions:</b> {restrTxt}
        </span>
        <span>
          <b>Requirement:</b> {REQUIREMENT}
        </span>
        <span>
          <b>Shopper:</b> ______________________
        </span>
      </div>
      <p className={s.pHow}>
        At the store: buy what the list says, then write how many you bought and the price from the shelf or receipt in
        the empty boxes. Type them into the plan afterward. Scaled amounts are estimates — round up for hungry scouts.
      </p>

      {sections.map((sec) => (
        <div key={sec}>
          <h2 className={s.pH2}>{SECTIONS[sec]}</h2>
          <table className={s.pTable}>
            <thead>
              <tr>
                <th>Ingredient</th>
                <th>Need</th>
                <th>Package</th>
                <th className={s.pR}>Qty to buy</th>
                <th className={s.pR}>Est. price</th>
                <th>Qty bought</th>
                <th>Actual price</th>
              </tr>
            </thead>
            <tbody>
              {buyable
                .filter((l) => l.ing.section === sec)
                .map((l) => {
                  const pk = l.pkg;
                  if (l.status === 'unpriced' || !pk || !isUsable(pk)) {
                    return (
                      <tr key={l.ing.id}>
                        <td>
                          <b>{l.ing.name}</b>
                        </td>
                        <td>{qtyText(l.need, l.ing.unit)}</td>
                        <td>
                          <i>Not priced yet — pick something at the store</i>
                        </td>
                        <td className={s.pR}>?</td>
                        <td className={s.pR}>?</td>
                        <td className={s.pBlank} />
                        <td className={s.pBlank} />
                      </tr>
                    );
                  }
                  const per =
                    packNoun(pk) === 'each' && pk.yield === 1
                      ? 'sold one at a time'
                      : `${qtyText(pk.yield, l.ing.unit)} per ${packNoun(pk)}`;
                  return (
                    <tr key={l.ing.id}>
                      <td>
                        <b>{l.ing.name}</b>
                        <br />
                        <small>{sourcesText(l)}</small>
                        {l.note && (
                          <>
                            <br />
                            <small>
                              <b>Note:</b> {l.note}
                            </small>
                          </>
                        )}
                      </td>
                      <td>{qtyText(l.need, l.ing.unit)}</td>
                      <td>
                        {pk.name}
                        <br />
                        <small>
                          {per}
                          {l.status === 'short' ? ` · SHORT ${qtyText(l.shortQty, l.ing.unit)}` : ''}
                        </small>
                      </td>
                      <td className={s.pR}>
                        <b>{packCount(l.qty, pk)}</b>
                      </td>
                      <td className={s.pR}>{money(l.spent)}</td>
                      <td className={s.pBlank} />
                      <td className={s.pBlank} />
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      ))}

      {bringing.length > 0 && (
        <>
          <h2 className={s.pH2}>Bringing, not buying</h2>
          <table className={s.pTable}>
            <thead>
              <tr>
                <th>Ingredient</th>
                <th>Need</th>
                <th>From</th>
                <th>Note</th>
                <th>Packed?</th>
              </tr>
            </thead>
            <tbody>
              {bringing.map((l) => (
                <tr key={l.ing.id}>
                  <td>
                    <b>{l.ing.name}</b>
                    <br />
                    <small>{sourcesText(l)}</small>
                  </td>
                  <td>{qtyText(l.need, l.ing.unit)}</td>
                  <td>{l.source === 'pantry' ? 'Troop pantry' : 'Home'}</td>
                  <td>{l.note || ''}</td>
                  <td className={s.pBlank} />
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {staples.length > 0 && (
        <p className={s.pNote}>
          <b>From the patrol box (not bought):</b>{' '}
          {staples.map((l) => `${l.ing.name.toLowerCase()} ${qtyText(l.need, l.ing.unit)}`).join(', ')}. Check the box
          before you leave.
        </p>
      )}

      <div className={s.pTotals}>
        <div className={s.pBox}>
          <div className={s.bLbl}>Estimated total (Spent)</div>
          <div className={s.bVal}>{money(t.spent)}</div>
          <div>
            {money(t.perSpent)} per person · budget target {money(plan.budgetPerPerson)}
          </div>
        </div>
        <div className={s.pBox}>
          <div className={s.bLbl}>Actual total from receipt</div>
          <div className={s.bBlank} />
          <div className={s.bLbl}>Actual per person (total ÷ {H})</div>
          <div className={s.bBlank} />
        </div>
      </div>

      <div className={s.counselor}>
        <h2 className={s.pH2}>Counselor summary — {REQUIREMENT}</h2>
        <dl className={s.pDl}>
          <dt>Menu</dt>
          <dd>{menuNames}</dd>
          <dt>Cost per meal</dt>
          <dd>
            {money(t.spent)} estimated (Spent)
            {t.unpriced.length ? `, not counting ${t.unpriced.join(', ').toLowerCase()}` : ''}
          </dd>
          <dt>Cost per person</dt>
          <dd>
            <b>{money(t.perSpent)} Spent</b> · {money(t.perUsed)} Used (true cost of the meal) · {money(t.perLeft)}{' '}
            leftover going home or into the patrol box
            {t.stapleUsed > 0 ? ` · plus about ${money(t.stapleUsed / H)} of patrol-box staples` : ''}
            {t.bringUsed > 0 ? ` · plus about ${money(t.bringUsed / H)} of food brought from the pantry or home` : ''}
          </dd>
          <dt>Restrictions accommodated</dt>
          <dd>
            {accommodated.length ? (
              <ul>
                {accommodated.map(({ r, text }) => (
                  <li key={r.key}>
                    <b>
                      {r.label} ({R[r.key]})
                    </b>{' '}
                    — {text}
                  </li>
                ))}
              </ul>
            ) : (
              'None reported'
            )}
          </dd>
          {warnings.length > 0 && (
            <>
              <dt>Needs attention</dt>
              <dd>
                <ul>
                  {warnings.map((w) => (
                    <li key={`${w.recipe.id}-${w.restriction.key}`}>
                      {w.recipe.name} has {w.ingredients.join(', ').toLowerCase()}; {w.count}{' '}
                      {w.restriction.label.toLowerCase()} {w.count === 1 ? 'person needs' : 'people need'} something else.
                    </li>
                  ))}
                </ul>
              </dd>
            </>
          )}
          <dt>Cross-contamination</dt>
          <dd>
            ☐ Separate pan or foil for gluten-free items &nbsp; ☐ Wash hands and utensils between batches &nbsp; ☐ Label
            the GF plate
          </dd>
        </dl>
        <div className={s.sig}>
          <div>Scout signature / date</div>
          <div>Counselor signature / date</div>
        </div>
      </div>
    </section>
  );
}
