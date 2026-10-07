'use client';

/**
 * Menu Monster › Tools & utilities (Patrick, 2026-10-06: "Add a Tools & Utilities to the Menu Monster Admin screen
 * that adds our first tool, which is Resync Patrol List from Roster. There will be more tools coming. Simple
 * links are fine."). One row per tool: what it does, a Run link, and the result under it.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../../../_components/button';
import { Notice } from '../../_components/notice';
import { movePatrolMenus, resyncPatrolsFromRoster } from './actions';
import lib from '../library.module.css';
import styles from './menu-monster.module.css';

interface Tool {
  key: string;
  title: string;
  what: string;
  run: () => Promise<{ ok: boolean; error?: string; note?: string }>;
}

/** Patrol names saved menus still carry that the list no longer has, with how many menus say each. */
export interface MissingPatrol {
  name: string;
  count: number;
}

export function ToolsAdmin({ missing = [], patrols = [] }: { missing?: MissingPatrol[]; patrols?: readonly string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ key: string; kind: 'ok' | 'error'; text: string } | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const tools: Tool[] = [
    {
      key: 'patrols',
      title: 'Resync patrol list from roster',
      what: 'The planner’s Patrol pull-down becomes the roster’s patrols (active scouts) plus “Whole troop”. Run it after patrols change on the roster.',
      run: resyncPatrolsFromRoster
    },
    {
      key: 'move-patrol',
      title: 'Move menus to a renamed patrol',
      what: 'Saved menus that still name a patrol the list no longer has take the new name.',
      run: async () => {
        const res = await movePatrolMenus(from, to);
        if (res.ok) {
          setFrom('');
          setTo('');
        }
        return res;
      }
    }
  ];

  function run(t: Tool) {
    setResult(null);
    start(async () => {
      const res = await t.run();
      setResult({ key: t.key, kind: res.ok ? 'ok' : 'error', text: res.ok ? (res.note ?? 'Done.') : (res.error ?? 'Something went wrong.') });
      router.refresh();
    });
  }

  return (
    <div className={styles.wrap}>
      <ul className={styles.list} aria-label="Tools">
        {tools.map((t) => (
          <li key={t.key} className={styles.toolRow}>
            <div className={styles.grow}>
              <strong>{t.title}</strong>
              <p className={styles.hint}>{t.what}</p>
              {t.key === 'move-patrol' &&
                (missing.length === 0 ? (
                  <p className={styles.hint}>Nothing to move.</p>
                ) : (
                  <div className={styles.inlineForm}>
                    <select className={lib.selectInput} aria-label="From patrol" value={from} onChange={(e) => setFrom(e.target.value)}>
                      <option value="">From…</option>
                      {missing.map((m) => (
                        <option key={m.name} value={m.name}>
                          {m.name} ({m.count} {m.count === 1 ? 'menu' : 'menus'})
                        </option>
                      ))}
                    </select>
                    <select className={lib.selectInput} aria-label="To patrol" value={to} onChange={(e) => setTo(e.target.value)}>
                      <option value="">To…</option>
                      {patrols.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              {result?.key === t.key && (result.kind === 'ok' ? <Notice variant="success">{result.text}</Notice> : <Notice>{result.text}</Notice>)}
            </div>
            <Button variant="secondary" size="sm" disabled={pending || (t.key === 'move-patrol' && (!from || !to))} onClick={() => run(t)}>
              Run
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
