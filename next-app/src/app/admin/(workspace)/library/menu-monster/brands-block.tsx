'use client';

/**
 * Menu Monster leader tools — one brand's heading in the Price book (Plans/Menu-Monster-Brands-Gear.md,
 * release 3; regrouped 2026-10-05).
 *
 * Ingredient → brands → packages. A brand is a brand or a varietal (Chips Ahoy, Fuji, Whole); a package is a
 * size of it at a store. The Price book now shows that shape directly: each brand is a heading with its
 * packages listed under it (price-book.tsx), instead of a brands table, a second "which brand each package
 * is" list and a wall of package cards that each said part of it (Patrick, 2026-10-05: "I'm not sure what I'm
 * looking at here").
 *
 * This is the heading: the brand's name, whether anything is priced under it, its own diet flags, and the ⋯
 * menu where a leader tidies — rename, merge a duplicate (menus that chose it follow), move one typed under
 * the wrong ingredient, set diets (Rice Chex is gluten-free; cereal is not), or remove it (menus that chose
 * it go back to any brand). Anyone signed in can type a new brand on a menu and it shows up here at once.
 */
import { useState, useTransition } from 'react';
import { Button } from '../../../_components/button';
import { ActionsMenu } from '../../_components/actions-menu';
import { Badge } from '../../_components/badge';
import { Notice } from '../../_components/notice';
import { RESTRICTIONS, RESTRICTION_BY_KEY } from '@/lib/menu-monster/units';
import type { Brand, Catalog, Ingredient, RestrictionKey } from '@/lib/menu-monster/types';
import { mergeBrand, moveBrand, removeBrand, renameBrand, setBrandDiets } from './actions';
import lib from '../library.module.css';
import styles from './menu-monster.module.css';

type Mode = 'rename' | 'diets' | 'merge' | 'move';

/** An ingredient's brands, live ones A–Z first, then removed ones. */
export function brandsOf(catalog: Catalog, ingredientId: string): Brand[] {
  return (catalog.brands ?? [])
    .filter((b) => b.ingredientId === ingredientId)
    .sort((a, b) => Number(a.retiredAt != null) - Number(b.retiredAt != null) || a.name.localeCompare(b.name));
}

export function BrandHead({
  brand: b,
  ing,
  catalog,
  priced,
  headingId,
  onChanged
}: {
  brand: Brand;
  ing: Ingredient;
  catalog: Catalog;
  /** How many live packages sit under this brand. */
  priced: number;
  headingId: string;
  onChanged: () => void;
}) {
  const [pending, start] = useTransition();
  const [line, setLine] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [text, setText] = useState('');
  const [target, setTarget] = useState('');
  const [diets, setDiets] = useState<RestrictionKey[] | null>(null);

  const mergeTargets = brandsOf(catalog, ing.id).filter((x) => !x.retiredAt && x.id !== b.id);
  const others = catalog.ingredients.filter((i) => i.id !== ing.id && !i.retiredAt && !i.needsMatch).sort((x, y) => x.name.localeCompare(y.name));
  const dietText = b.avoid == null ? null : b.avoid.length === 0 ? 'Suits every diet' : b.avoid.map((k) => `Not ${RESTRICTION_BY_KEY[k].label.toLowerCase()}`).join(', ');

  function run(action: () => Promise<{ ok: boolean; error?: string; note?: string }>, okText: string) {
    setLine(null);
    start(async () => {
      const res = await action();
      if (!res.ok) {
        setLine({ kind: 'error', text: res.error ?? 'Something went wrong.' });
        return;
      }
      setMode(null);
      setLine({ kind: 'ok', text: res.note ?? okText });
      onChanged();
    });
  }

  function open(next: Mode) {
    setMode(next);
    setText(b.name);
    setTarget('');
    setDiets(b.avoid);
  }

  const cancel = (
    <Button type="button" size="sm" variant="secondary" onClick={() => setMode(null)}>
      Cancel
    </Button>
  );

  return (
    <>
      <div className={styles.groupHead}>
        <h3 id={headingId} className={styles.cardName}>
          {b.name}
        </h3>
        {priced === 0 && <Badge variant="warning">No price yet</Badge>}
        {dietText && <span className={styles.cardMeta}>{dietText}</span>}
        <span className={styles.spacer} />
        <ActionsMenu
          ariaLabel={`More for ${b.name}`}
          placeholder="Brand options"
          disabled={pending}
          options={[
            { value: 'rename', label: 'Rename…' },
            { value: 'diets', label: 'Diets…' },
            ...(mergeTargets.length > 0 ? [{ value: 'merge', label: 'Merge into…' }] : []),
            // A package's size is in this ingredient's unit, so a priced brand cannot follow.
            ...(priced === 0 ? [{ value: 'move', label: 'Move to another ingredient…' }] : []),
            { value: 'remove', label: 'Remove' }
          ]}
          onAction={(v) => {
            if (v === 'remove') run(() => removeBrand(b.id), `Removed “${b.name}”. Menus that chose it go back to any brand.`);
            else open(v as Mode);
          }}
        />
      </div>
      {line && (line.kind === 'error' ? <Notice>{line.text}</Notice> : <Notice variant="success">{line.text}</Notice>)}

      {mode === 'rename' && (
        <form className={styles.inlineForm} onSubmit={(e) => { e.preventDefault(); run(() => renameBrand(b.id, text), `Renamed to “${text.trim()}”.`); }}>
          <input className={lib.textInput} aria-label={`New name for ${b.name}`} value={text} maxLength={60} autoFocus onChange={(e) => setText(e.target.value)} />
          <Button type="submit" size="sm" variant="primary" disabled={pending || !text.trim() || text.trim() === b.name} title={text.trim() === b.name ? 'No changes to save yet' : undefined}>
            Save changes
          </Button>
          {cancel}
        </form>
      )}
      {mode === 'diets' && (
        <form className={styles.inlineForm} onSubmit={(e) => { e.preventDefault(); run(() => setBrandDiets(b.id, diets), `Saved ${b.name}’s diets.`); }}>
          <label className={styles.listRow}>
            <input type="checkbox" checked={diets == null} onChange={(e) => setDiets(e.target.checked ? null : [...ing.avoid])} /> Same as {ing.name.toLowerCase()}
          </label>
          {diets != null &&
            RESTRICTIONS.map((r) => (
              <label key={r.key} className={styles.listRow}>
                <input
                  type="checkbox"
                  checked={diets.includes(r.key)}
                  onChange={(e) => setDiets((cur) => (e.target.checked ? [...(cur ?? []), r.key] : (cur ?? []).filter((k) => k !== r.key)))}
                />{' '}
                Not {r.label.toLowerCase()}
              </label>
            ))}
          <Button type="submit" size="sm" variant="primary" disabled={pending}>
            Save changes
          </Button>
          {cancel}
        </form>
      )}
      {mode === 'merge' && (
        <form className={styles.inlineForm} onSubmit={(e) => { e.preventDefault(); run(() => mergeBrand(b.id, target), `Merged “${b.name}” into “${mergeTargets.find((x) => x.id === target)?.name ?? ''}”.`); }}>
          <select className={lib.selectInput} aria-label={`Merge ${b.name} into`} value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">Merge into…</option>
            {mergeTargets.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
          {target && (
            <span className={styles.muted}>
              Everything priced under {b.name} moves to {mergeTargets.find((x) => x.id === target)?.name}, and menus that chose {b.name} will show it instead. This can’t be undone.
            </span>
          )}
          <Button type="submit" size="sm" variant="primary" disabled={pending || !target}>
            Merge
          </Button>
          {cancel}
        </form>
      )}
      {mode === 'move' && (
        <form className={styles.inlineForm} onSubmit={(e) => { e.preventDefault(); run(() => moveBrand(b.id, target), `Moved “${b.name}” to ${others.find((x) => x.id === target)?.name ?? ''}.`); }}>
          <select className={lib.selectInput} aria-label={`Move ${b.name} to`} value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">Move to…</option>
            {others.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
          {target && <span className={styles.muted}>Menus that chose it under {ing.name} go back to any brand.</span>}
          <Button type="submit" size="sm" variant="primary" disabled={pending || !target}>
            Move
          </Button>
          {cancel}
        </form>
      )}
    </>
  );
}
