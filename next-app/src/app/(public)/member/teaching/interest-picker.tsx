'use client';

/**
 * Build a Plan B10c/B10d: "What else would you enjoy teaching, now or in the future?" One picker for both places it
 * appears: the teacher's answer page (/i/teach/<token>, token-scoped search and save, with "Also this Sunday") and
 * /member/teaching (signed in). Search the whole catalog, add requirements or whole merit badges, give each an optional
 * short note, then "Save interests". It saves on its own, apart from any other form on the page. Notes are plain
 * text: React escapes them and nothing ever turns them into links.
 *
 * Accessibly (qa-lead B10c #2–#5): a persistent status announces each search ("3 results" / "Nothing matches"); an
 * added result keeps its label in its name ("…, added"); removing a pick moves focus to the next pick's Remove, or to
 * the "Your picks" heading when none is left; Save stays enabled and, pressed with nothing picked, says why in place.
 */
import { useEffect, useId, useRef, useState, useTransition } from 'react';
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

const NOTHING_PICKED = 'Add something first: search above, then press + Add.';

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
  const listRef = useRef<HTMLUListElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  /** After a Remove: the index whose Remove takes focus once the list re-renders. */
  const focusAt = useRef<number | null>(null);
  const nowCount = picked.filter((p) => p.now).length;
  const full = picked.length >= INTEREST_SUBMIT_CAP;
  const blocked = problem === NOTHING_PICKED;

  useEffect(() => {
    const at = focusAt.current;
    if (at == null) return;
    focusAt.current = null;
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('button[data-remove]');
    if (buttons?.length) buttons[Math.min(at, buttons.length - 1)].focus();
    else headingRef.current?.focus();
  }, [picked]);

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
    setProblem(null);
    setPicked((p) => (p.some((x) => x.hit.key === hit.key) || p.length >= INTEREST_SUBMIT_CAP ? p : [...p, { hit, note: '', now: false }]));
  }

  function remove(key: string) {
    const at = picked.findIndex((x) => x.hit.key === key);
    focusAt.current = Math.max(at, 0);
    setPicked((p) => p.filter((x) => x.hit.key !== key));
  }

  function patch(key: string, change: Partial<Picked>) {
    setPicked((p) => p.map((x) => (x.hit.key === key ? { ...x, ...change } : x)));
  }

  function submit() {
    if (saving) return;
    setMessage(null);
    if (!picked.length) {
      setProblem(NOTHING_PICKED);
      return;
    }
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
  const resultsSaid = rows == null ? '' : rows.length ? `${rows.length} ${rows.length === 1 ? 'result' : 'results'}` : 'Nothing matches';
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
      <p role="status" aria-label="Search results" className={styles.meta}>
        {resultsSaid}
      </p>
      {rows && rows.length > 0 && (
        <ul className={styles.results} aria-label="Search results list">
          {rows.map((r) => {
            const label = interestShort(r);
            const added = pickedKeys.has(r.key);
            return (
              <li key={r.key} className={styles.result}>
                <span>{label}</span>
                <Button variant="ghost" onClick={() => add(r)} disabled={added || full} aria-label={added ? `${label}, added` : `Add ${label}`}>
                  {added ? 'Added' : '+ Add'}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {full && <p className={styles.meta}>That’s {INTEREST_SUBMIT_CAP}, the most for one save. Save these, then add more.</p>}
      <section className={blocked ? `${styles.picks} ${styles.bad}` : styles.picks} aria-labelledby={`${id}-picks`}>
        <h3 id={`${id}-picks`} ref={headingRef} tabIndex={-1} className={styles.picksHead}>
          Your picks
        </h3>
        {picked.length === 0 ? (
          <p className={styles.meta}>Nothing picked yet.</p>
        ) : (
          <ul className={styles.picked} ref={listRef}>
            {picked.map((p) => {
              const label = interestShort(p.hit);
              const nowOff = !p.now && nowCount >= INTEREST_NOW_CAP;
              return (
                <li key={p.hit.key} className={styles.pick}>
                  <div className={styles.pickHead}>
                    <strong>{label}</strong>
                    <Button variant="ghost" data-remove="" onClick={() => remove(p.hit.key)} aria-label={`Remove ${label}`}>
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
      </section>
      <div className={styles.foot}>
        <Button variant="primary" onClick={submit} aria-disabled={saving || undefined}>
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
