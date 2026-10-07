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
import { DangerConfirm } from './danger-confirm';
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
  onChanged,
  suggested = false,
  onSuggest
}: {
  brand: Brand;
  ing: Ingredient;
  catalog: Catalog;
  /** How many live packages sit under this brand. */
  priced: number;
  headingId: string;
  onChanged: () => void;
  /** A single food's one suggested brand (Patrick, 2026-10-06): a star after its name, and the menu promotes or clears it. */
  suggested?: boolean;
  onSuggest?: (brandId: string | null) => void;
}) {
  const [pending, start] = useTransition();
  const [line, setLine] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [text, setText] = useState('');
  /** Save pressed with the name emptied: the input is marked until a name is typed. */
  const [tried, setTried] = useState(false);
  const [target, setTarget] = useState('');
  const [diets, setDiets] = useState<RestrictionKey[] | null>(null);
  const [removing, setRemoving] = useState(false);

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
    setTried(false);
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
          {suggested && (
            <span className={styles.star} title="The suggested brand — a menu that adds this food starts with it">
              {' '}★<span className={styles.srOnly}> (suggested)</span>
            </span>
          )}
        </h3>
        {priced === 0 && <Badge variant="warning">No price yet</Badge>}
        {dietText && (
          <span className={styles.cardMeta}>
            {dietText}{' '}
            {/* A brand's own diet answer replaces the food's; this puts it back. */}
            <button type="button" className={styles.rowBtn} disabled={pending} onClick={() => run(() => setBrandDiets(b.id, null), `${b.name} uses ${ing.name.toLowerCase()}’s diets again.`)}>
              Same as {ing.name.toLowerCase()}
            </button>
          </span>
        )}
        <span className={styles.spacer} />
        <ActionsMenu
          ariaLabel={`More for ${b.name}`}
          placeholder="Brand options"
          disabled={pending}
          options={[
            ...(onSuggest ? [suggested ? { value: 'unsuggest', label: 'Stop suggesting this brand' } : { value: 'suggest', label: 'Suggest this brand' }] : []),
            { value: 'rename', label: 'Rename…' },
            { value: 'diets', label: 'Diets different from the food…' },
            ...(mergeTargets.length > 0 ? [{ value: 'merge', label: 'Merge into…' }] : []),
            // A package's size is in this ingredient's unit, so a priced brand cannot follow.
            ...(priced === 0 ? [{ value: 'move', label: 'Move to another ingredient…' }] : []),
            { value: 'remove', label: 'Remove' }
          ]}
          onAction={(v) => {
            if (v === 'remove') setRemoving(true);
            else if (v === 'suggest') onSuggest?.(b.id);
            else if (v === 'unsuggest') onSuggest?.(null);
            else open(v as Mode);
          }}
        />
      </div>
      {removing && (
        <DangerConfirm
          title={`Remove ${b.name}?`}
          sub="Menus that chose it go back to any brand; its prices are kept in the price history."
          confirmLabel="Remove brand"
          onCancel={() => setRemoving(false)}
          onConfirm={() => {
            setRemoving(false);
            run(() => removeBrand(b.id), `Removed “${b.name}”. Menus that chose it go back to any brand.`);
          }}
        />
      )}
      {line && (line.kind === 'error' ? <Notice>{line.text}</Notice> : <Notice variant="success">{line.text}</Notice>)}

      {mode === 'rename' && (
        <form className={styles.inlineForm} onSubmit={(e) => { e.preventDefault(); if (!text.trim()) { setTried(true); (e.currentTarget.querySelector('input') as HTMLElement | null)?.focus(); return; } run(() => renameBrand(b.id, text), `Renamed to “${text.trim()}”.`); }}>
          <input className={tried && !text.trim() ? `${lib.textInput} ${styles.bad}` : lib.textInput} aria-invalid={(tried && !text.trim()) || undefined} aria-label={`New name for ${b.name}`} value={text} maxLength={60} autoFocus onChange={(e) => setText(e.target.value)} />
          {tried && !text.trim() && <p className={styles.badNote}>It needs a name.</p>}
          <Button type="submit" size="sm" variant="primary" disabled={pending || text.trim() === b.name} title={text.trim() === b.name ? 'No changes to save yet' : undefined}>
            Save changes
          </Button>
          {cancel}
        </form>
      )}
      {mode === 'diets' && (
        <form className={styles.inlineForm} onSubmit={(e) => { e.preventDefault(); run(() => setBrandDiets(b.id, diets), diets == null ? `${b.name} uses ${ing.name.toLowerCase()}’s diets.` : `Saved ${b.name}’s own diets.`); }}>
          <span className={styles.muted}>Only for a brand that differs from the food: Rice Chex is gluten-free though cereal is not.</span>
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
