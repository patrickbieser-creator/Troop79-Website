'use client';

/**
 * Menu Monster leader tools — the troop's gear list (Plans/Menu-Monster-Brands-Gear.md, release 2).
 *
 * Recipes name gear from this list, so a menu's Gear tab can add the same item up across foods and meals.
 * Scouts add to it just by naming something new on a recipe or a menu; leaders tidy here: fix a spelling
 * (the rename rewrites every recipe that uses it), say where it lives (the Gear tab groups by that), mark the
 * one-per-person items (the troop's mess kits), and merge duplicates by renaming one onto the other. There are
 * no owned counts (Patrick, 2026-10-03). An item a recipe names can be retired, not deleted.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../../../_components/button';
import { ActionsMenu } from '../../_components/actions-menu';
import { Badge } from '../../_components/badge';
import { Notice } from '../../_components/notice';
import { SearchField, useTableSearch } from '../../_components/search-field';
import { GEAR_HOMES, GEAR_HOME_LABEL, MAX_GEAR_NAME, type GearHome } from '@/lib/menu-monster/gear';
import type { GearAdminRow } from '@/lib/menu-monster/gear-store';
import { createGear, deleteGear, setGearRetired, updateGear } from './actions';
import lib from '../library.module.css';
import styles from './menu-monster.module.css';

type Draft = { name: string; home: GearHome; perPerson: boolean };
const BLANK: Draft = { name: '', home: 'trailer', perPerson: false };

export function GearAdmin({ items }: { items: GearAdminRow[] }) {
  const router = useRouter();
  const search = useTableSearch(items, (g) => [g.name, GEAR_HOME_LABEL[g.home], ...g.recipes]);
  const [pending, start] = useTransition();
  const [line, setLine] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  /** 'new', an item's id, or null. */
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(BLANK);

  function run(action: () => Promise<{ ok: boolean; error?: string; note?: string }>, okText: string) {
    setLine(null);
    start(async () => {
      const res = await action();
      if (!res.ok) {
        setLine({ kind: 'error', text: res.error ?? 'Something went wrong.' });
        return;
      }
      setEditing(null);
      setLine({ kind: 'ok', text: res.note ?? okText });
      router.refresh();
    });
  }

  const form = (onSubmit: () => void, submitLabel: string, saved: Draft | null) => {
    const dirty = saved == null ? draft.name.trim() !== '' : draft.name !== saved.name || draft.home !== saved.home || draft.perPerson !== saved.perPerson;
    return (
      <form
        className={styles.inlineForm}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <div>
          <label className={`adminLabel ${lib.fieldLabel}`} htmlFor="mm-gear-name">
            Name
          </label>
          <input id="mm-gear-name" className={lib.textInput} value={draft.name} maxLength={MAX_GEAR_NAME} autoFocus onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
        </div>
        <div>
          <label className={`adminLabel ${lib.fieldLabel}`} htmlFor="mm-gear-home">
            Where it lives
          </label>
          <select id="mm-gear-home" className={lib.selectInput} value={draft.home} onChange={(e) => setDraft((d) => ({ ...d, home: e.target.value as GearHome }))}>
            {GEAR_HOMES.map((h) => (
              <option key={h.key} value={h.key}>
                {h.label}
              </option>
            ))}
          </select>
        </div>
        <label className={styles.listRow}>
          <input type="checkbox" checked={draft.perPerson} onChange={(e) => setDraft((d) => ({ ...d, perPerson: e.target.checked }))} /> One per person
        </label>
        <Button type="submit" size="sm" variant="primary" disabled={pending || !dirty || !draft.name.trim()} title={dirty ? undefined : 'No changes to save yet'}>
          {submitLabel}
        </Button>
        <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => setEditing(null)}>
          Cancel
        </Button>
      </form>
    );
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <SearchField value={search.q} onChange={search.setQ} label="Search gear" placeholder="Search by name…" resultCount={search.visible.length} totalCount={items.length} />
        <span className={styles.spacer} />
        <Button
          variant="secondary"
          onClick={() => {
            setDraft(BLANK);
            setEditing(editing === 'new' ? null : 'new');
          }}
        >
          + New gear
        </Button>
      </div>
      <p className={styles.hint}>
        Scouts add to this list by naming gear on a recipe or a menu. Renaming an item onto another item’s name merges the two.
      </p>
      {line && (line.kind === 'error' ? <Notice>{line.text}</Notice> : <Notice variant="success">{line.text}</Notice>)}
      {editing === 'new' && form(() => run(() => createGear(draft), `Added “${draft.name.trim()}”.`), 'Add gear', null)}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Item</th>
              <th>Where it lives</th>
              <th>Used in</th>
              <th className={styles.actionsCell}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {search.visible.length === 0 && (
              <tr>
                <td colSpan={4} className={styles.muted}>
                  {items.length === 0 ? 'No gear yet.' : 'No gear matches.'}
                </td>
              </tr>
            )}
            {search.visible.map((g) => (
              <tr key={g.id}>
                <td>
                  {g.name} {g.perPerson && <Badge variant="info">One per person</Badge>} {g.retiredAt && <Badge variant="muted">Retired</Badge>}
                  {editing === g.id &&
                    form(
                      () => run(() => updateGear(g.id, draft), `Saved “${draft.name.trim()}”.`),
                      'Save changes',
                      { name: g.name, home: g.home, perPerson: g.perPerson }
                    )}
                </td>
                <td>{GEAR_HOME_LABEL[g.home]}</td>
                <td>{g.recipes.length === 0 ? <span className={styles.muted}>—</span> : g.recipes.join(', ')}</td>
                <td className={styles.actionsCell}>
                  <ActionsMenu
                    ariaLabel={`More for ${g.name}`}
                    placeholder="⋯"
                    disabled={pending}
                    options={[
                      { value: 'edit', label: 'Edit…' },
                      g.retiredAt ? { value: 'restore', label: 'Restore' } : { value: 'retire', label: 'Retire' },
                      // Don't offer a button that can only fail: a recipe still names it.
                      ...(g.recipes.length === 0 ? [{ value: 'delete', label: 'Delete' }] : [])
                    ]}
                    onAction={(v) => {
                      if (v === 'edit') {
                        setDraft({ name: g.name, home: g.home, perPerson: g.perPerson });
                        setEditing(g.id);
                      } else if (v === 'retire') run(() => setGearRetired(g.id, true), `Retired “${g.name}”. Recipes that name it keep the word.`);
                      else if (v === 'restore') run(() => setGearRetired(g.id, false), `Restored “${g.name}”.`);
                      else run(() => deleteGear(g.id), `Deleted “${g.name}”.`);
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
