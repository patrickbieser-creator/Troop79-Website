'use client';

/**
 * Menu Monster leader tools — the troop's gear list (Plans/Menu-Monster-Brands-Gear.md, release 2).
 *
 * Recipes name gear from this list, so a menu's Gear tab can add the same item up across foods and meals.
 * Gear is picked from this list, never typed in (Patrick, 2026-10-05); "+ New gear" here is the only way onto it. Leaders tidy: fix a spelling
 * (the rename rewrites every recipe that uses it), say where it lives (the Gear tab groups by that), mark the
 * one-per-person items (the troop's mess kits), and merge duplicates by renaming one onto the other. There are
 * no owned counts (Patrick, 2026-10-03). An item a recipe names can be retired, not deleted.
 */
import { Fragment, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../../../_components/button';
import { ActionsMenu } from '../../_components/actions-menu';
import { Badge } from '../../_components/badge';
import { Notice } from '../../_components/notice';
import { SearchField, useTableSearch } from '../../_components/search-field';
import { GEAR_HOMES, GEAR_HOME_LABEL, MAX_GEAR_NAME, type GearHome } from '@/lib/menu-monster/gear';
import type { GearAdminRow } from '@/lib/menu-monster/gear-store';
import { createGear, deleteGear, mergeGear, setGearRetired, updateGear } from './actions';
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
  /** The item being merged away, and the one picked to take its place (Patrick, 2026-10-05: "Charcoal and Charcoal briquettes"). */
  const [merging, setMerging] = useState<{ id: number; into: number | null } | null>(null);

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
        Recipes and menus pick their gear from this list, and “+ New gear” is the only way onto it. Renaming an item onto another item’s name merges the two.
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
              <Fragment key={g.id}>
              <tr>
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
                      { value: 'merge', label: 'Merge into…' },
                      g.retiredAt ? { value: 'restore', label: 'Restore' } : { value: 'retire', label: 'Retire' },
                      // Don't offer a button that can only fail: a recipe still names it.
                      ...(g.recipes.length === 0 ? [{ value: 'delete', label: 'Delete' }] : [])
                    ]}
                    onAction={(v) => {
                      if (v === 'edit') {
                        setDraft({ name: g.name, home: g.home, perPerson: g.perPerson });
                        setEditing(g.id);
                      } else if (v === 'merge') {
                        setEditing(null);
                        setMerging({ id: g.id, into: null });
                      } else if (v === 'retire') run(() => setGearRetired(g.id, true), `Retired “${g.name}”. Recipes that name it keep the word.`);
                      else if (v === 'restore') run(() => setGearRetired(g.id, false), `Restored “${g.name}”.`);
                      else run(() => deleteGear(g.id), `Deleted “${g.name}”.`);
                    }}
                  />
                </td>
              </tr>
              {merging?.id === g.id && (
                <tr className={styles.detailRow} aria-label={`Merge ${g.name}`}>
                  <td colSpan={4}>
                    {/* The target picker stays greyed until a target is chosen (Patrick, 2026-10-05): the select's placeholder is the gate. */}
                    <form
                      className={styles.inlineForm}
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (merging.into != null) run(() => mergeGear(g.id, merging.into as number), `Merged “${g.name}”.`);
                      }}
                    >
                      <label className={`adminLabel ${lib.fieldLabel}`} htmlFor={`mm-gear-merge-${g.id}`}>
                        Merge “{g.name}” into
                      </label>
                      <select id={`mm-gear-merge-${g.id}`} className={lib.selectInput} value={merging.into ?? ''} onChange={(e) => setMerging({ id: g.id, into: e.target.value ? Number(e.target.value) : null })}>
                        <option value="">— pick —</option>
                        {items
                          .filter((x) => x.id !== g.id)
                          .map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.name}
                              {x.retiredAt ? ' (retired)' : ''}
                            </option>
                          ))}
                      </select>
                      <Button type="submit" size="sm" variant="primary" disabled={pending || merging.into == null}>
                        Merge
                      </Button>
                      <Button type="button" size="sm" variant="secondary" onClick={() => setMerging(null)}>
                        Cancel
                      </Button>
                      <p className={styles.hint}>
                        Recipes and menus that name “{g.name}” will say the other item’s name instead, and “{g.name}” goes away.
                      </p>
                    </form>
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
