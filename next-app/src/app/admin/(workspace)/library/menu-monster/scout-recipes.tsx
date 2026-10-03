'use client';

/**
 * Scout recipes, the leader side (Plans/Menu-Monster-Scout-Workspace.md, Phase
 * 4A; approved design: concept-e admin.html › New recipes). A shared scout
 * recipe is live the moment the scout shares it (decision 14), so this list is
 * how a leader finds them: newest share first, the frozen credit, and an
 * "Edited since shared" tag (the author's later edits are live too, with no
 * review). Per row: open it in the Recipes tab, change the credit, Retire /
 * Restore. Retiring keeps it on every menu that holds it; it just leaves the
 * library and the pickers.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '../../../_components/button';
import { ActionsMenu } from '../../_components/actions-menu';
import { Badge } from '../../_components/badge';
import { Notice } from '../../_components/notice';
import { fmtDate } from '@/lib/format-date';
import type { SharedScoutRecipe } from '@/lib/menu-monster/scout-recipes-store';
import { setRecipeStatus, setScoutRecipeCredit } from './actions';
import lib from '../library.module.css';
import styles from './menu-monster.module.css';

type Line = { kind: 'ok' | 'error'; text: string };

export function ScoutRecipes({ recipes }: { recipes: SharedScoutRecipe[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [line, setLine] = useState<Line | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [credit, setCredit] = useState('');

  function run(action: () => Promise<{ ok: boolean; error?: string }>, okText: string) {
    setLine(null);
    start(async () => {
      const res = await action();
      if (!res.ok) {
        setLine({ kind: 'error', text: res.error ?? 'Something went wrong.' });
        return;
      }
      setEditing(null);
      setLine({ kind: 'ok', text: okText });
      router.refresh();
    });
  }

  return (
    <div className={styles.activity}>
      {line && (line.kind === 'error' ? <Notice>{line.text}</Notice> : <Notice variant="success">{line.text}</Notice>)}
      <section className={styles.activitySection} aria-labelledby="mm-scout-recipes-title">
        <div className={styles.activityHead}>
          <h2 id="mm-scout-recipes-title" className={styles.activityTitle}>
            Shared by scouts
          </h2>
        </div>
        {recipes.length === 0 ? (
          <p className={styles.emptyLine}>No scout has shared a recipe yet.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Recipe</th>
                  <th>Credit</th>
                  <th>Shared</th>
                  <th>Status</th>
                  <th className={styles.actionsCell}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {recipes.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/admin/library/menu-monster?tab=recipes&recipe=${encodeURIComponent(r.id)}`}>{r.name}</Link>
                    </td>
                    <td>
                      {editing === r.id ? (
                        <form
                          className={styles.inlineForm}
                          onSubmit={(e) => {
                            e.preventDefault();
                            run(() => setScoutRecipeCredit(r.id, credit), `The credit on “${r.name}” now reads “Recipe by ${credit.trim()}”.`);
                          }}
                        >
                          <input className={lib.textInput} value={credit} maxLength={40} aria-label={`Credit for ${r.name}`} autoFocus onChange={(e) => setCredit(e.target.value)} />
                          <Button type="submit" size="sm" variant="primary" disabled={pending || !credit.trim() || credit.trim() === r.credit}>
                            Save
                          </Button>
                          <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(null)}>
                            Cancel
                          </Button>
                        </form>
                      ) : (
                        r.credit
                      )}
                    </td>
                    <td>{fmtDate(r.sharedAt)}</td>
                    <td>
                      {r.status === 'retired' ? <Badge variant="muted">Retired</Badge> : <Badge variant="success">Live</Badge>}
                      {r.editedSinceShared && r.status !== 'retired' && (
                        <>
                          {' '}
                          <Badge variant="warning">Edited since shared</Badge>
                        </>
                      )}
                    </td>
                    <td className={styles.actionsCell}>
                      <ActionsMenu
                        ariaLabel={`More for ${r.name}`}
                        placeholder="⋯"
                        disabled={pending}
                        options={[
                          { value: 'credit', label: 'Change credit' },
                          r.status === 'retired' ? { value: 'restore', label: 'Restore' } : { value: 'retire', label: 'Retire' }
                        ]}
                        onAction={(v) => {
                          if (v === 'credit') {
                            setCredit(r.credit ?? '');
                            setEditing(r.id);
                          } else if (v === 'retire') {
                            run(() => setRecipeStatus(r.id, 'retired'), `Retired “${r.name}”. Menus that use it keep it.`);
                          } else {
                            run(() => setRecipeStatus(r.id, 'published'), `Restored “${r.name}” to the library.`);
                          }
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
