'use client';

/**
 * Build a Plan B10c/B10d: "What else would you enjoy teaching, now or in the future?" One picker for both places it
 * appears: the teacher's answer page (/i/teach/<token>, token-scoped search and save, with "Also this Sunday") and
 * /member/teaching (signed in). Search the whole catalog, add requirements or whole merit badges, give each an optional
 * short note, then "Save interests". It saves on its own, apart from any other form on the page. Notes are plain
 * text: React escapes them and nothing ever turns them into links.
 */
import { useId, useState, useTransition } from 'react';
import { Button } from '@/app/_components/button';
import { Notice } from '@/app/_components/notice';
import { SaveProblem, TextInput } from '@/app/_components/form';
import { canTeachNow, interestShort, INTEREST_NOTE_MAX, INTEREST_NOW_CAP, INTEREST_SEARCH_MAX, INTEREST_SUBMIT_CAP, type InterestHit, type InterestPick } from '@/lib/teaching-interests-shared';
import styles from './interest-picker.module.css';

type SearchFn = (q: string) => Promise<{ ok: true; rows: InterestHit[] } | { ok: false; error: string }>;
type SaveFn = (picks: InterestPick[], nowKeys: string[]) => Promise<{ ok: true; message: string } | { ok: false; error: string }>;

interface Picked {
  hit: InterestHit;
  note: string;
  now: boolean;
}

export function InterestPicker({ search, save, allowNow, onSaved }: { search: SearchFn; save: SaveFn; allowNow: boolean; onSaved?: () => void }) {
  const id = useId();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<InterestHit[] | null>(null);
  const [searchProblem, setSearchProblem] = useState<string | null>(null);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();
  const [saving, startSave] = useTransition();
  const nowCount = picked.filter((p) => p.now).length;
  const full = picked.length >= INTEREST_SUBMIT_CAP;

  function runSearch(e: React.FormEvent) {
    e.preventDefault();
    const text = q.trim();
    if (!text) return;
    setSearchProblem(null);
    startSearch(async () => {
      const res = await search(text);
      if (res.ok) setRows(res.rows);
      else {
        setRows(null);
        setSearchProblem(res.error);
      }
    });
  }

  function add(hit: InterestHit) {
    setMessage(null);
    setPicked((p) => (p.some((x) => x.hit.key === hit.key) || p.length >= INTEREST_SUBMIT_CAP ? p : [...p, { hit, note: '', now: false }]));
  }

  function patch(key: string, change: Partial<Picked>) {
    setPicked((p) => p.map((x) => (x.hit.key === key ? { ...x, ...change } : x)));
  }

  function submit() {
    if (!picked.length) return;
    setProblem(null);
    startSave(async () => {
      const res = await save(
        picked.map((p) => ({ key: p.hit.key, note: p.note.trim() || null })),
        allowNow ? picked.filter((p) => p.now).map((p) => p.hit.key) : []
      );
      if (!res.ok) {
        setProblem(res.error);
        return;
      }
      setPicked([]);
      setMessage(res.message);
      onSaved?.();
    });
  }

  const pickedKeys = new Set(picked.map((p) => p.hit.key));
  return (
    <div className={styles.picker}>
      <form role="search" onSubmit={runSearch} className={styles.searchRow}>
        <label htmlFor={`${id}-q`} className={styles.label}>
          Search requirements and merit badges
        </label>
        <div className={styles.searchLine}>
          <TextInput
            id={`${id}-q`}
            type="search"
            className={styles.input}
            value={q}
            maxLength={INTEREST_SEARCH_MAX}
            placeholder="Knots, first aid, Chess…"
            onChange={(e) => setQ(e.target.value)}
          />
          <Button variant="secondary" type="submit" disabled={searching || !q.trim()}>
            {searching ? 'Searching…' : 'Search'}
          </Button>
        </div>
      </form>
      {searchProblem && <Notice tone="error">{searchProblem}</Notice>}
      {rows && (
        <ul className={styles.results} aria-label="Search results">
          {rows.length === 0 && <li className={styles.meta}>Nothing matches. Try other words.</li>}
          {rows.map((r) => (
            <li key={r.key} className={styles.result}>
              <span>{interestShort(r)}</span>
              <Button variant="ghost" onClick={() => add(r)} disabled={pickedKeys.has(r.key) || full} aria-label={`Add ${interestShort(r)}`}>
                {pickedKeys.has(r.key) ? 'Added' : '+ Add'}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {full && <p className={styles.meta}>That’s {INTEREST_SUBMIT_CAP}, the most for one save. Save these, then add more.</p>}
      {picked.length > 0 && (
        <ul className={styles.picked} aria-label="Your picks">
          {picked.map((p) => {
            const label = interestShort(p.hit);
            const nowOff = !p.now && nowCount >= INTEREST_NOW_CAP;
            return (
              <li key={p.hit.key} className={styles.pick}>
                <div className={styles.pickHead}>
                  <strong>{label}</strong>
                  <Button variant="ghost" onClick={() => setPicked((x) => x.filter((y) => y.hit.key !== p.hit.key))} aria-label={`Remove ${label}`}>
                    Remove
                  </Button>
                </div>
                <label className={styles.noteLabel}>
                  <span>Note (optional)</span>
                  <TextInput
                    type="text"
                    className={styles.input}
                    value={p.note}
                    maxLength={INTEREST_NOTE_MAX}
                    placeholder="e.g. I teach this at work"
                    onChange={(e) => patch(p.hit.key, { note: e.target.value })}
                  />
                </label>
                {allowNow && canTeachNow(p.hit.key) && (
                  <label className={styles.now}>
                    <input type="checkbox" checked={p.now} disabled={nowOff} onChange={(e) => patch(p.hit.key, { now: e.target.checked })} />
                    <span>Also this Sunday{nowOff ? ` (up to ${INTEREST_NOW_CAP})` : ''}</span>
                  </label>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className={styles.foot}>
        <Button variant="primary" onClick={submit} disabled={!picked.length || saving} title={picked.length ? undefined : 'Add something first'}>
          {saving ? 'Saving…' : 'Save interests'}
        </Button>
        <span role="status" aria-live="polite" className={styles.meta}>
          {problem ? null : message}
        </span>
        {problem && <SaveProblem reason={problem} />}
      </div>
    </div>
  );
}
