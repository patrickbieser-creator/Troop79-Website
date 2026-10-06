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
import { resyncPatrolsFromRoster } from './actions';
import styles from './menu-monster.module.css';

interface Tool {
  key: string;
  title: string;
  what: string;
  run: () => Promise<{ ok: boolean; error?: string; note?: string }>;
}

export function ToolsAdmin() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ key: string; kind: 'ok' | 'error'; text: string } | null>(null);
  const tools: Tool[] = [
    {
      key: 'patrols',
      title: 'Resync patrol list from roster',
      what: 'The planner’s Patrol pull-down becomes the roster’s patrols (active scouts) plus “Whole troop”. Run it after patrols change on the roster.',
      run: resyncPatrolsFromRoster
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
              {result?.key === t.key && (result.kind === 'ok' ? <Notice variant="success">{result.text}</Notice> : <Notice>{result.text}</Notice>)}
            </div>
            <Button variant="secondary" size="sm" disabled={pending} onClick={() => run(t)}>
              Run
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
