'use client';

/**
 * Scout recipes, the leader side (Plans/Menu-Monster-Scout-Workspace.md, Phase 4A; rebuilt 2026-10-05 —
 * Patrick: "show all recipes, date created, owner, last edited, permissions, and any controls available").
 *
 * Every recipe a scout wrote, shared or not: who owns it, when it was made and last changed, whether it is
 * shared, who may edit it, and the controls. A shared scout recipe is live the moment the scout shares it
 * (decision 14), so "Edited since shared" marks an author's later edit (live too, with no review). Edit opens
 * the leader editor (leaders edit a scout's recipe the way they edit a scout's menu, D-327); Copy makes a
 * troop draft from it; Rename and Change credit are inline; Retire keeps it on every menu that holds it.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../../../_components/button';
import { ActionsMenu } from '../../_components/actions-menu';
import { Badge } from '../../_components/badge';
import { Notice } from '../../_components/notice';
import { SearchField, useTableSearch } from '../../_components/search-field';
import { fmtDate } from '@/lib/format-date';
import { recipeHref, NO_FILTER } from '@/lib/menu-monster/food-list';
import type { ScoutRecipeRow } from '@/lib/menu-monster/scout-recipes-store';
import { duplicateRecipe, renameScoutRecipe, setRecipeStatus, setScoutRecipeCredit } from './actions';
import lib from '../library.module.css';
import styles from './menu-monster.module.css';

type Line = { kind: 'ok' | 'error'; text: string };
type Editing = { id: string; field: 'name' | 'credit'; value: string };

/** Who may change a scout's recipe: the scout who wrote it, and any leader. */
export const SCOUT_RECIPE_EDITORS = 'Owner and leaders';

export function ScoutRecipes({ recipes }: { recipes: ScoutRecipeRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [line, setLine] = useState<Line | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  /** Save pressed with the field emptied: the input is marked until something is typed. */
  const [tried, setTried] = useState(false);
  const search = useTableSearch(recipes, (r) => [r.name, r.owner, r.credit]);

  function run(action: () => Promise<{ ok: boolean; error?: string; id?: string }>, okText: string, then?: (id?: string) => void) {
    setLine(null);
    start(async () => {
      const res = await action();
      if (!res.ok) {
        setLine({ kind: 'error', text: res.error ?? 'Something went wrong.' });
        return;
      }
      setEditing(null);
      setTried(false);
      setLine({ kind: 'ok', text: okText });
      then?.(res.id);
      router.refresh();
    });
  }

  const inlineForm = (r: ScoutRecipeRow, e: Editing) => {
    const bad = tried && !e.value.trim();
    const need = e.field === 'name' ? 'It needs a name.' : 'It needs a credit.';
    return (
    <form
      className={styles.inlineForm}
      onSubmit={(ev) => {
        ev.preventDefault();
        const v = e.value.trim();
        if (!v) {
          setTried(true);
          (ev.currentTarget.querySelector('input') as HTMLElement | null)?.focus();
          return;
        }
        if (e.field === 'name') run(() => renameScoutRecipe(r.id, v), `Renamed “${r.name}” to “${v}”.`);
        else run(() => setScoutRecipeCredit(r.id, v), `The credit on “${r.name}” now reads “Recipe by ${v}”.`);
      }}
    >
      <input
        className={bad ? `${lib.textInput} ${styles.bad}` : lib.textInput}
        aria-invalid={bad || undefined}
        value={e.value}
        maxLength={e.field === 'name' ? 80 : 40}
        aria-label={e.field === 'name' ? `New name for ${r.name}` : `Credit for ${r.name}`}
        autoFocus
        onChange={(ev) => setEditing({ ...e, value: ev.target.value })}
      />
      {bad && <p className={styles.badNote}>{need}</p>}
      <Button type="submit" size="sm" variant="primary" disabled={pending || e.value.trim() === (e.field === 'name' ? r.name : r.credit)}>
        Save
      </Button>
      <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(null)}>
        Cancel
      </Button>
    </form>
    );
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <SearchField value={search.q} onChange={search.setQ} label="Search scout recipes" resultCount={search.visible.length} totalCount={recipes.length} />
      </div>
      {line && (line.kind === 'error' ? <Notice>{line.text}</Notice> : <Notice variant="success">{line.text}</Notice>)}
      {recipes.length === 0 ? (
        <p className={styles.emptyLine}>No scout has written a recipe yet.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table} aria-label="Scout recipes">
            <thead>
              <tr>
                <th>Recipe</th>
                <th>Owner</th>
                <th>Created</th>
                <th>Last edited</th>
                <th>Shared</th>
                <th>Who can edit</th>
                <th>Status</th>
                <th className={styles.actionsCell}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {search.visible.map((r) => {
                const e = editing?.id === r.id ? editing : null;
                return (
                  <tr key={r.id}>
                    <td>
                      {e?.field === 'name' ? (
                        inlineForm(r, e)
                      ) : (
                        <>
                          <strong>{r.name}</strong>
                          {r.credit && r.credit !== r.owner && <div className={styles.muted}>Recipe by {r.credit}</div>}
                        </>
                      )}
                      {e?.field === 'credit' && inlineForm(r, e)}
                    </td>
                    <td>{r.owner}</td>
                    <td>{fmtDate(r.createdAt)}</td>
                    <td>{fmtDate(r.updatedAt)}</td>
                    <td>{r.sharedAt ? fmtDate(r.sharedAt) : <span className={styles.muted}>Not shared</span>}</td>
                    <td>{SCOUT_RECIPE_EDITORS}</td>
                    <td>
                      {r.status === 'retired' ? <Badge variant="muted">Retired</Badge> : r.sharedAt ? <Badge variant="success">Live</Badge> : <Badge variant="warning">Draft</Badge>}
                      {r.editedSinceShared && r.status !== 'retired' && (
                        <>
                          {' '}
                          <Badge variant="warning">Edited since shared</Badge>
                        </>
                      )}
                    </td>
                    <td className={styles.actionsCell}>
                      <span className={styles.flags}>
                        <Button variant="secondary" size="sm" href={recipeHref(r.id, NO_FILTER)}>
                          Edit
                        </Button>
                        <ActionsMenu
                          ariaLabel={`More for ${r.name}`}
                          placeholder="⋯"
                          disabled={pending}
                          options={[
                            { value: 'copy', label: 'Copy to the troop’s recipes' },
                            { value: 'rename', label: 'Rename' },
                            ...(r.sharedAt ? [{ value: 'credit', label: 'Change credit' }] : []),
                            r.status === 'retired' ? { value: 'restore', label: 'Restore' } : { value: 'retire', label: 'Retire' }
                          ]}
                          onAction={(v) => {
                            if (v === 'rename') setEditing({ id: r.id, field: 'name', value: r.name });
                            else if (v === 'credit') setEditing({ id: r.id, field: 'credit', value: r.credit ?? '' });
                            else if (v === 'copy') run(() => duplicateRecipe(r.id), `Copied “${r.name}” as a troop draft.`, (id) => id && router.push(recipeHref(id, NO_FILTER)));
                            else if (v === 'retire') run(() => setRecipeStatus(r.id, 'retired'), `Retired “${r.name}”. Menus that use it keep it.`);
                            // Restore puts it back where it was: live if the scout had shared it, otherwise their draft.
                            else run(() => setRecipeStatus(r.id, r.sharedAt ? 'published' : 'draft'), r.sharedAt ? `Restored “${r.name}” to the library.` : `Restored “${r.name}” as ${r.owner}’s draft.`);
                          }}
                        />
                      </span>
                    </td>
                  </tr>
                );
              })}
              {search.visible.length === 0 && (
                <tr>
                  <td colSpan={8} className={styles.muted}>
                    No scout recipe matches.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
