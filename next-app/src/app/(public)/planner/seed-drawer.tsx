'use client';

/**
 * Seed this meeting (Plans/Meeting-Planner-II.md Decision 10, P3; prototypes/meeting-plan-II/README.md "Seeding"):
 * the planning team puts a focus set on the board as ONE focus group (one pick, one class), or a single top-level
 * requirement. What is already seeded is listed first, each with Remove (its picks and teachers stay).
 *
 * The sets come from focusSetsAction; the single-requirement search is the server search, top-level rows only.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Drawer } from '@/app/_components/drawer';
import { fmtDate } from '@/lib/format-date';
import type { FocusChip } from '@/lib/meeting-planner-board';
import type { FocusSearchRow, FocusSetView } from '@/lib/meeting-focus';
import { plannerSeedSetAction, plannerSeedTopicAction, plannerUnseedAction } from './actions';
import { focusSearchAction, focusSetsAction } from './focus-actions';
import { usePlanner } from './planner-client';
import styles from './planner.module.css';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function SeedDrawer({ focus, onClose }: { focus: readonly FocusChip[]; onClose: () => void }) {
  const p = usePlanner()!;
  const [sets, setSets] = useState<FocusSetView[] | null>(null);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<FocusSearchRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<ReadonlySet<string>>(() => new Set(focus.map((f) => f.key)));
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const [problem, setProblem] = useState<{ key: string; text: string } | null>(null);

  useEffect(() => {
    let live = true;
    focusSetsAction()
      .then((res) => live && setSets(res.ok ? res.sets : []))
      .catch(() => live && setSets([]));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const text = q.trim();
    if (!text) return;
    let live = true;
    const t = setTimeout(() => {
      focusSearchAction({ q: text, kind: 'all', source: null, offset: 0 })
        .then((res) => live && setHits(res.ok ? res.rows.filter((r) => r.topLevel).slice(0, 12) : []))
        .catch(() => live && setHits([]));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);

  async function act(key: string, write: () => Promise<{ ok: true } | { ok: false; error: string }>, after: () => void) {
    setBusy(key);
    setProblem(null);
    const res = await p.sync.run(write);
    setBusy(null);
    if (res.ok) after();
    else setProblem({ key, text: res.error });
  }
  const seedSet = (s: FocusSetView) =>
    act(`fg:${s.id}`, () => plannerSeedSetAction({ entryId: p.entryId, setId: s.id }), () => setDone((d) => new Set(d).add(`fg:${s.id}`)));
  const seedOne = (r: FocusSearchRow) => act(r.key, () => plannerSeedTopicAction({ entryId: p.entryId, key: r.key }), () => setDone((d) => new Set(d).add(r.key)));
  const unseed = (key: string) =>
    act(key, () => plannerUnseedAction({ entryId: p.entryId, key }), () => {
      setRemoved((x) => new Set(x).add(key));
      setDone((d) => {
        const n = new Set(d);
        n.delete(key);
        return n;
      });
    });
  const rowProblem = (key: string) =>
    problem?.key === key ? (
      <p className={styles.rowProblem} role="alert">
        {problem.text}
      </p>
    ) : null;
  const onBoard = focus.filter((f) => !removed.has(f.key));

  return (
    <Drawer eyebrow="Meeting focus" title="Seed this meeting" sub="A set goes on the board as one class." onClose={onClose}>
      {onBoard.length ? (
        <>
          <h3 className={styles.drawerLabel}>On the board</h3>
          <ul className={styles.optList}>
            {onBoard.map((f) => (
              <li key={f.key}>
                <div className={styles.seedRow}>
                  <span className={styles.optText}>
                    <span className={styles.optTitle}>{f.title}</span>
                    <span className={styles.optMeta}>
                      {f.codeLabel} · {plural(f.scouts, 'scout')}
                    </span>
                  </span>
                  <button type="button" className={styles.assignBtn} disabled={busy === f.key} onClick={() => unseed(f.key)} aria-label={`Remove ${f.title} from the meeting focus`}>
                    {busy === f.key ? 'Removing…' : 'Remove'}
                  </button>
                </div>
                {rowProblem(f.key)}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <h3 className={styles.drawerLabel}>Focus sets</h3>
      {!sets ? <p className={styles.optMeta}>Loading the sets…</p> : null}
      {sets && !sets.length ? (
        <p className={styles.optMeta}>
          No sets yet. <Link href="/planner/focus-sets">Make one</Link>
        </p>
      ) : null}
      {sets?.length ? (
        <ul className={styles.optList}>
          {sets.map((s) => {
            const key = `fg:${s.id}`;
            return (
              <li key={s.id}>
                <div className={styles.seedRow}>
                  <span className={styles.optText}>
                    <span className={styles.optTitle}>{s.name}</span>
                    <span className={styles.optMeta}>
                      {plural(s.items.length, 'requirement')}
                      {s.lastUsed ? ` · used ${fmtDate(s.lastUsed, { year: false })}` : ''}
                      {s.labels.length ? ` · ${s.labels.join(', ')}` : ''}
                    </span>
                  </span>
                  {done.has(key) ? (
                    <span className={styles.assigned}>✓ On the board</span>
                  ) : (
                    <button type="button" className={styles.seedSmall} disabled={busy === key || !s.items.length} onClick={() => seedSet(s)} aria-label={`Seed ${s.name}`}>
                      {busy === key ? 'Seeding…' : 'Seed'}
                    </button>
                  )}
                </div>
                {rowProblem(key)}
              </li>
            );
          })}
        </ul>
      ) : null}

      <h3 className={styles.drawerLabel}>One requirement</h3>
      <input
        type="search"
        className={styles.enterInput}
        placeholder="Tenderfoot 4a, First Aid 9…"
        aria-label="Search one requirement to seed"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          if (!e.target.value.trim()) setHits([]);
        }}
      />
      {hits.length ? (
        <ul className={`${styles.optList} ${styles.seedHits}`}>
          {hits.map((r) => (
            <li key={r.key}>
              <div className={styles.seedRow}>
                <span className={styles.optText}>
                  <span className={styles.optTitle}>{r.label}</span>
                  <span className={styles.optMeta}>
                    {r.sourceName} {r.code}
                  </span>
                </span>
                {done.has(r.key) ? (
                  <span className={styles.assigned}>✓ On the board</span>
                ) : (
                  <button type="button" className={styles.seedSmall} disabled={busy === r.key} onClick={() => seedOne(r)} aria-label={`Seed ${r.sourceName} ${r.code}`}>
                    {busy === r.key ? 'Seeding…' : 'Seed'}
                  </button>
                )}
              </div>
              {rowProblem(r.key)}
            </li>
          ))}
        </ul>
      ) : null}
    </Drawer>
  );
}
