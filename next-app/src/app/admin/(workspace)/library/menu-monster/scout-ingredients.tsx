'use client';

/**
 * New ingredients, the leader side (Plans/Menu-Monster-Scout-Workspace.md,
 * Phase 4B; approved design: concept-e admin.html › New recipes). A scout's
 * typed-in ingredient shows here once a shared recipe uses it — priced from the
 * scout's own entry, its diet ticks unverified. Per row:
 *
 *  - Match… — pick the price-book ingredient it really is and say how many of
 *    that one unit makes ("1 jar = 17.6 oz", prefilled when the units share a
 *    family). Every recipe line moves (mm_match_ingredient) and menus follow the
 *    alias on their next read.
 *  - Keep as new — it becomes a book ingredient: a store section and the diets
 *    it doesn't suit, confirmed.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../../../_components/button';
import { ActionsMenu } from '../../_components/actions-menu';
import { Notice } from '../../_components/notice';
import type { TypedInIngredient } from '@/lib/menu-monster/scout-recipes-store';
import type { RestrictionKey, Section } from '@/lib/menu-monster/types';
import { RESTRICTIONS, SECTIONS, SECTION_ORDER, famFactor } from '@/lib/menu-monster/units';
import { keepScoutIngredient, matchScoutIngredient } from './actions';
import lib from '../library.module.css';
import styles from './menu-monster.module.css';

export interface BookIngredient {
  id: string;
  name: string;
  unitKey: string;
  unitMany: string;
}

type Open = { id: string; mode: 'match' | 'keep' } | null;
const money = (n: number) => `$${n.toFixed(2)}`;

export function ScoutIngredients({ items, book }: { items: TypedInIngredient[]; book: BookIngredient[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState<Open>(null);
  const [line, setLine] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [to, setTo] = useState('');
  const [factor, setFactor] = useState('');
  const [section, setSection] = useState<Section>('dry');
  const [avoid, setAvoid] = useState<RestrictionKey[]>([]);

  function openMatch(t: TypedInIngredient) {
    setOpen({ id: t.id, mode: 'match' });
    setTo('');
    setFactor('');
  }
  function pickTarget(t: TypedInIngredient, id: string) {
    setTo(id);
    const target = book.find((b) => b.id === id);
    // Same unit family (oz and lb, cups and gallons): the factor is known. Count nouns differ, so the leader types it.
    const f = target && t.unit.kind !== 'count' ? famFactor(t.unit.key, target.unitKey) : null;
    setFactor(f == null ? '' : String(Math.round(f * 10000) / 10000));
  }
  function openKeep(t: TypedInIngredient) {
    setOpen({ id: t.id, mode: 'keep' });
    setSection('dry');
    setAvoid(t.avoid);
  }

  function run(action: () => Promise<{ ok: boolean; error?: string }>, okText: string) {
    setLine(null);
    start(async () => {
      const res = await action();
      if (!res.ok) {
        setLine({ kind: 'error', text: res.error ?? 'Something went wrong.' });
        return;
      }
      setOpen(null);
      setLine({ kind: 'ok', text: okText });
      router.refresh();
    });
  }

  return (
    <section className={styles.activitySection} aria-labelledby="mm-new-ingredients-title">
      <div className={styles.activityHead}>
        <h2 id="mm-new-ingredients-title" className={styles.activityTitle}>
          New ingredients
        </h2>
      </div>
      {line && (line.kind === 'error' ? <Notice>{line.text}</Notice> : <Notice variant="success">{line.text}</Notice>)}
      {items.length === 0 ? (
        <p className={styles.emptyLine}>Nothing to match.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Ingredient</th>
                <th>Their package</th>
                <th>Added by</th>
                <th>Used in</th>
                <th className={styles.actionsCell}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((t) => {
                const target = book.find((b) => b.id === to);
                return (
                  <tr key={t.id}>
                    <td>
                      {t.name}
                      {t.avoid.length > 0 && <div className={styles.muted}>Contains: {t.avoid.map((k) => RESTRICTIONS.find((r) => r.key === k)?.label).join(', ')} (unverified)</div>}
                      {open?.id === t.id && open.mode === 'match' && (
                        <form
                          className={styles.inlineForm}
                          onSubmit={(e) => {
                            e.preventDefault();
                            run(() => matchScoutIngredient(t.id, to, Number(factor)), `Matched “${t.name}” to “${target?.name ?? ''}”.`);
                          }}
                        >
                          <select className={lib.selectInput} aria-label={`Price-book ingredient for ${t.name}`} value={to} onChange={(e) => pickTarget(t, e.target.value)}>
                            <option value="">Pick an ingredient…</option>
                            {book.map((b) => (
                              <option key={b.id} value={b.id}>
                                {b.name}
                              </option>
                            ))}
                          </select>
                          {target && (
                            <label className={styles.muted}>
                              1 {t.unit.one} ={' '}
                              <input className={lib.textInput} inputMode="decimal" value={factor} aria-label={`How many ${target.unitMany} one ${t.unit.one} is`} onChange={(e) => setFactor(e.target.value)} />{' '}
                              {target.unitMany}
                            </label>
                          )}
                          <Button type="submit" size="sm" variant="primary" disabled={pending || !to || !(Number(factor) > 0)}>
                            Match
                          </Button>
                          <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(null)}>
                            Cancel
                          </Button>
                        </form>
                      )}
                      {open?.id === t.id && open.mode === 'keep' && (
                        <form
                          className={styles.inlineForm}
                          onSubmit={(e) => {
                            e.preventDefault();
                            run(() => keepScoutIngredient(t.id, section, avoid), `Kept “${t.name}” in the price book.`);
                          }}
                        >
                          <select className={lib.selectInput} aria-label={`Store section for ${t.name}`} value={section} onChange={(e) => setSection(e.target.value as Section)}>
                            {SECTION_ORDER.map((k) => (
                              <option key={k} value={k}>
                                {SECTIONS[k]}
                              </option>
                            ))}
                          </select>
                          {RESTRICTIONS.map((r) => (
                            <label key={r.key} className={styles.muted}>
                              <input
                                type="checkbox"
                                checked={avoid.includes(r.key)}
                                onChange={() => setAvoid((a) => (a.includes(r.key) ? a.filter((x) => x !== r.key) : [...a, r.key]))}
                              />{' '}
                              Not {r.label.toLowerCase()}
                            </label>
                          ))}
                          <Button type="submit" size="sm" variant="primary" disabled={pending}>
                            Keep
                          </Button>
                          <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(null)}>
                            Cancel
                          </Button>
                        </form>
                      )}
                    </td>
                    <td>{t.pkg ? [t.pkg.size != null ? `${t.pkg.size} ${t.unit.many}` : null, money(t.pkg.price), t.pkg.store].filter(Boolean).join(' · ') : '—'}</td>
                    <td>{t.addedBy}</td>
                    <td>{t.usedIn.join(', ') || '—'}</td>
                    <td className={styles.actionsCell}>
                      <ActionsMenu
                        ariaLabel={`More for ${t.name}`}
                        placeholder="⋯"
                        disabled={pending}
                        options={[
                          { value: 'match', label: 'Match to a price-book ingredient…' },
                          { value: 'keep', label: 'Keep as new' }
                        ]}
                        onAction={(v) => (v === 'match' ? openMatch(t) : openKeep(t))}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
