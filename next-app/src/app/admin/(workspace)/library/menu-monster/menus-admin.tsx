'use client';

/**
 * Menus, the leader side (Patrick, 2026-10-05: "add a tab to show all menus. same details"). Every saved
 * menu in the troop — whose it is, when it was made and last changed, whether it is shared, who may edit
 * it, and the controls. Leaders have full rights on anyone's menu (D-327): Open goes to the menu itself
 * (the public planner, where a leader edits it as the owner would); Duplicate leaves the owner a copy;
 * Rename is inline; Share / Stop sharing moves it on or off the troop shelf; Delete is armed by a second
 * click. Change owner hands it to another scout or a leader, and Set patrol credits a patrol (Patrick,
 * 2026-10-05: a camp menu "was entered under a scout named Todd. This was incorrect ... the menu was created
 * by a patrol, not an individual. Members of that patrol should get credit"). The public /library/menu-monster/menus list stays the per-person view (own menus, a parent's
 * scouts, the leader's filters by scout and outing); this is the troop-wide table.
 */
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../../../_components/button';
import { ActionsMenu } from '../../_components/actions-menu';
import { Badge } from '../../_components/badge';
import { Notice } from '../../_components/notice';
import { SearchField, useTableSearch } from '../../_components/search-field';
import { fmtDate } from '@/lib/format-date';
import type { MenuOwnerCandidate, MenuSummary } from '@/lib/menu-monster/menus-store';
import { MENU_CONTEXTS } from '@/lib/menu-monster/menus';
import { deleteMenu, duplicateMenu, renameMenu, setMenuOwner, setMenuPatrol, setMenuShared } from './actions';
import lib from '../library.module.css';
import styles from './menu-monster.module.css';

/** A menu row with its owner's public name ("Sam K."). */
export type MenuAdminRow = MenuSummary & { owner: string; outing: string | null };

type Line = { kind: 'ok' | 'error'; text: string };

/** Who may change a menu: the person it belongs to, and any leader (D-327). */
export const MENU_EDITORS = 'Owner and leaders';
export const menuPageHref = (id: string) => `/library/menu-monster/menus/${encodeURIComponent(id)}`;

const contextLabel = (c: MenuSummary['context']) => MENU_CONTEXTS.find((x) => x.key === c)?.label ?? c;
/** How long a first Delete click stays armed for the second. */
const ARM_MS = 4000;

export function MenusAdmin({ menus, owners = [], patrols = [] }: { menus: MenuAdminRow[]; owners?: MenuOwnerCandidate[]; patrols?: readonly string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [line, setLine] = useState<Line | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  /** Save pressed with the name emptied: the input is marked until a name is typed. */
  const [renameTried, setRenameTried] = useState(false);
  /** One inline edit at a time: a new owner or a patrol for one menu. */
  const [editing, setEditing] = useState<{ id: string; field: 'owner' | 'patrol'; value: string } | null>(null);
  // Delete takes two clicks (D-070: no confirm()): the first arms one row, the second deletes it.
  const [armedId, setArmedId] = useState<string | null>(null);
  useEffect(() => {
    if (!armedId) return;
    const t = setTimeout(() => setArmedId(null), ARM_MS);
    return () => clearTimeout(t);
  }, [armedId]);
  const search = useTableSearch(menus, (m) => [m.name, m.owner, m.outing, m.patrol]);

  function run(action: () => Promise<{ ok: boolean; error?: string; id?: string }>, okText: string, then?: (id?: string) => void) {
    setLine(null);
    start(async () => {
      const res = await action();
      if (!res.ok) {
        setLine({ kind: 'error', text: res.error ?? 'Something went wrong.' });
        return;
      }
      setRenaming(null);
      setEditing(null);
      setLine({ kind: 'ok', text: okText });
      then?.(res.id);
      router.refresh();
    });
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <SearchField value={search.q} onChange={search.setQ} label="Search menus" placeholder="Search by menu, owner or outing…" resultCount={search.visible.length} totalCount={menus.length} />
      </div>
      {line && (line.kind === 'error' ? <Notice>{line.text}</Notice> : <Notice variant="success">{line.text}</Notice>)}
      {menus.length === 0 ? (
        <p className={styles.emptyLine}>No one has saved a menu yet.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table} aria-label="Menus">
            <thead>
              <tr>
                <th>Menu</th>
                <th>Owner</th>
                <th>Patrol</th>
                <th>For</th>
                <th className={styles.numCell}>People</th>
                <th className={styles.numCell}>Meals</th>
                <th>Created</th>
                <th>Last edited</th>
                <th>Shared</th>
                <th>Who can edit</th>
                <th className={styles.actionsCell}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {search.visible.map((m) => (
                <tr key={m.id}>
                  <td>
                    {renaming?.id === m.id ? (
                      <form
                        className={styles.inlineForm}
                        onSubmit={(e) => {
                          e.preventDefault();
                          const v = renaming.value.trim();
                          if (!v) {
                            setRenameTried(true);
                            (e.currentTarget.querySelector('input') as HTMLElement | null)?.focus();
                            return;
                          }
                          run(() => renameMenu(m.id, v), `Renamed “${m.name}” to “${v}”.`);
                        }}
                      >
                        <input className={renameTried && !renaming.value.trim() ? `${lib.textInput} ${styles.bad}` : lib.textInput} aria-invalid={(renameTried && !renaming.value.trim()) || undefined} value={renaming.value} maxLength={120} aria-label={`New name for ${m.name}`} autoFocus onChange={(e) => setRenaming({ id: m.id, value: e.target.value })} />
                        {renameTried && !renaming.value.trim() && <p className={styles.badNote}>It needs a name.</p>}
                        <Button type="submit" size="sm" variant="primary" disabled={pending || renaming.value.trim() === m.name}>
                          Save
                        </Button>
                        <Button type="button" size="sm" variant="secondary" onClick={() => setRenaming(null)}>
                          Cancel
                        </Button>
                      </form>
                    ) : (
                      <strong>{m.name}</strong>
                    )}
                  </td>
                  <td>
                    {editing?.id === m.id && editing.field === 'owner' ? (
                      <form
                        className={styles.inlineForm}
                        onSubmit={(e) => {
                          e.preventDefault();
                          const who = owners.find((o) => String(o.personId) === editing.value);
                          if (who) run(() => setMenuOwner(m.id, who.personId), `“${m.name}” now belongs to ${who.name}.`);
                        }}
                      >
                        {/* Greyed until an owner is picked: the select's placeholder is the gate. */}
                        <select className={lib.selectInput} aria-label={`New owner for ${m.name}`} value={editing.value} autoFocus onChange={(e) => setEditing({ ...editing, value: e.target.value })}>
                          <option value="">— pick —</option>
                          {owners.map((o) => (
                            <option key={o.personId} value={o.personId}>
                              {o.name}
                              {o.kind === 'leader' ? ' (leader)' : ''}
                            </option>
                          ))}
                        </select>
                        <Button type="submit" size="sm" variant="primary" disabled={pending || !editing.value || editing.value === String(m.ownerPersonId)}>
                          Save
                        </Button>
                        <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(null)}>
                          Cancel
                        </Button>
                      </form>
                    ) : (
                      m.owner
                    )}
                  </td>
                  <td>
                    {editing?.id === m.id && editing.field === 'patrol' ? (
                      <form
                        className={styles.inlineForm}
                        onSubmit={(e) => {
                          e.preventDefault();
                          const v = editing.value.trim();
                          run(() => setMenuPatrol(m.id, v), v ? `“${m.name}” is credited to the ${v} patrol.` : `“${m.name}” no longer names a patrol.`);
                        }}
                      >
                        <input className={lib.textInput} list={`mm-patrols-${m.id}`} value={editing.value} maxLength={40} aria-label={`Patrol for ${m.name}`} autoFocus onChange={(e) => setEditing({ ...editing, value: e.target.value })} />
                        <datalist id={`mm-patrols-${m.id}`}>
                          {patrols.map((p) => (
                            <option key={p} value={p} />
                          ))}
                        </datalist>
                        <Button type="submit" size="sm" variant="primary" disabled={pending || editing.value.trim() === (m.patrol ?? '')}>
                          Save
                        </Button>
                        <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(null)}>
                          Cancel
                        </Button>
                      </form>
                    ) : (
                      m.patrol ?? <span className={styles.muted}>—</span>
                    )}
                  </td>
                  <td>{m.outing ?? contextLabel(m.context)}</td>
                  <td className={styles.numCell}>{m.headcount}</td>
                  <td className={styles.numCell}>{m.mealCount}</td>
                  <td>{fmtDate(m.createdAt)}</td>
                  <td>{fmtDate(m.updatedAt)}</td>
                  <td>{m.sharedAt ? <Badge variant="success">{fmtDate(m.sharedAt)}</Badge> : <span className={styles.muted}>Not shared</span>}</td>
                  <td>{MENU_EDITORS}</td>
                  <td className={styles.actionsCell}>
                    <span className={styles.flags}>
                      <Button variant="secondary" size="sm" href={menuPageHref(m.id)}>
                        Open
                      </Button>
                      <ActionsMenu
                        ariaLabel={`More for ${m.name}`}
                        placeholder="⋯"
                        disabled={pending}
                        options={[
                          { value: 'duplicate', label: 'Duplicate' },
                          { value: 'rename', label: 'Rename' },
                          { value: 'owner', label: 'Change owner…' },
                          { value: 'patrol', label: m.patrol ? 'Change patrol…' : 'Set patrol…' },
                          m.sharedAt ? { value: 'unshare', label: 'Stop sharing' } : { value: 'share', label: 'Share with the troop' },
                          { value: 'delete', label: armedId === m.id ? 'Click again to delete' : 'Delete' }
                        ]}
                        onAction={(v) => {
                          if (v === 'rename') setRenaming({ id: m.id, value: m.name });
                          else if (v === 'owner') setEditing({ id: m.id, field: 'owner', value: '' });
                          else if (v === 'patrol') setEditing({ id: m.id, field: 'patrol', value: m.patrol ?? '' });
                          else if (v === 'duplicate') run(() => duplicateMenu(m.id), `Duplicated “${m.name}” for ${m.owner}.`);
                          else if (v === 'share') run(() => setMenuShared(m.id, true), `Shared “${m.name}” with the troop.`);
                          else if (v === 'unshare') run(() => setMenuShared(m.id, false), `“${m.name}” is no longer shared.`);
                          else if (v === 'delete') {
                            if (armedId === m.id) {
                              setArmedId(null);
                              run(() => deleteMenu(m.id), `Deleted “${m.name}”.`);
                            } else setArmedId(m.id);
                          }
                        }}
                      />
                    </span>
                  </td>
                </tr>
              ))}
              {search.visible.length === 0 && (
                <tr>
                  <td colSpan={11} className={styles.muted}>
                    No menu matches.
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
