'use client';

/**
 * Search (Plans/Completed/Admin-Portal-Nav.md decision 8, phase 5; canvas board 3). Opens from the top bar's field, Ctrl K /
 * Cmd K, or "/" when focus isn't in a field. A Dialog: Escape closes it and focus returns to where it was.
 *
 *   Features — the registry entries this person can open, filtered on the client (search-model.ts), grouped
 *              Do · Screens · Reports · Setup, six per group.
 *   Records  — people, calendar entries and articles from GET /admin/search after 2+ characters (debounced, and an
 *              older request is aborted), five per kind, only kinds the person could open.
 *
 * Keyboard: ↑ ↓ move, Enter opens, the first result is preselected (a combobox over a listbox). With an empty box the
 * recent searches show. A feature opened from here counts toward Home's shortcuts (beaconNavOpen).
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Dialog } from './dialog';
import { useGuardedNav } from './guarded-nav';
import { beaconNavOpen } from './nav-beacon';
import { searchFeatures, type SearchEntry } from './search-model';
import type { RecordResults } from '@/lib/admin-record-search';
import styles from './search-dialog.module.css';

const RECENT_KEY = 'admin-search-recent';
const RECENT_MAX = 5;
const DEBOUNCE_MS = 250;

interface Row {
  id: string;
  group: string;
  label: string;
  meta: string | null;
  href: string;
  /** Registry key: logged as an open. Records have none. */
  featureKey?: string;
}

function readRecent(): string[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function saveRecent(q: string) {
  try {
    const next = [q, ...readRecent().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, RECENT_MAX);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // A private window or blocked storage: recent searches are a convenience only.
  }
}

function inField(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

/** Rows in their groups, each keeping its index in the flat list the keyboard moves through. */
function groupRows(rows: Row[]): { group: string; items: { row: Row; i: number }[] }[] {
  const out: { group: string; items: { row: Row; i: number }[] }[] = [];
  rows.forEach((row, i) => {
    const last = out[out.length - 1];
    if (last && last.group === row.group) last.items.push({ row, i });
    else out.push({ group: row.group, items: [{ row, i }] });
  });
  return out;
}

export function SearchLauncher({ entries, specimen = false }: { entries: SearchEntry[]; /** Styleguide only: no global Ctrl K / "/" listener. */ specimen?: boolean }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [records, setRecords] = useState<{ q: string; results: RecordResults } | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  const { navigate, dialog } = useGuardedNav();
  const listId = useId();

  function show() {
    if (dialogRef.current?.open) return;
    returnTo.current = document.activeElement as HTMLElement | null;
    setRecent(readRecent());
    setOpen(true);
    dialogRef.current?.showModal();
    inputRef.current?.focus();
  }

  useEffect(() => {
    if (specimen) return;
    function onKey(e: globalThis.KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        show();
      } else if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !inField(e.target)) {
        e.preventDefault();
        show();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [specimen]);

  // Records: debounced, and only the latest request counts.
  const term = q.trim();
  useEffect(() => {
    if (!open || term.length < 2) return;
    const ctl = new AbortController();
    const t = window.setTimeout(() => {
      fetch(`/admin/search?q=${encodeURIComponent(term)}`, { signal: ctl.signal, credentials: 'same-origin' })
        .then((r) => (r.ok ? (r.json() as Promise<RecordResults>) : null))
        .then((results) => {
          if (results) setRecords({ q: term, results });
        })
        .catch(() => {});
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(t);
      ctl.abort();
    };
  }, [term, open]);

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    for (const g of searchFeatures(entries, term)) {
      for (const e of g.entries) out.push({ id: `f-${e.key}`, group: g.title, label: e.label, meta: e.area, href: e.href, featureKey: e.key });
    }
    const r = records && records.q === term ? records.results : null;
    if (r) {
      for (const [group, hits] of [
        ['People', r.people],
        ['Calendar', r.calendar],
        ['Articles', r.articles]
      ] as const) {
        for (const h of hits) out.push({ id: `${group}-${h.id}`, group, label: h.label, meta: h.meta, href: h.href });
      }
    }
    return out;
  }, [entries, term, records]);

  const current = rows.length ? Math.min(active, rows.length - 1) : -1;

  function onClose() {
    setOpen(false);
    setQ('');
    setActive(0);
    setRecords(null);
    returnTo.current?.focus?.();
  }

  function openRow(row: Row) {
    // Only a search that led to a screen is remembered: a typed name (a scout, a parent) never sits in the browser.
    if (term && row.featureKey) saveRecent(term);
    if (row.featureKey) beaconNavOpen(row.featureKey);
    dialogRef.current?.close();
    navigate(row.href);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (rows.length ? (Math.min(a, rows.length - 1) + 1) % rows.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (rows.length ? (Math.min(a, rows.length - 1) - 1 + rows.length) % rows.length : 0));
    } else if (e.key === 'Enter' && current >= 0) {
      e.preventDefault();
      openRow(rows[current]);
    }
  }

  return (
    <>
      <button type="button" className={styles.launcher} onClick={show} aria-keyshortcuts="Control+K Meta+K /">
        <span className={styles.launcherText}>Find a screen, report, scout or event…</span>
        <span className={styles.launcherShort}>Search</span>
        <kbd className={styles.kbd}>Ctrl K</kbd>
      </button>
      <Dialog ref={dialogRef} className={styles.dialog} onClose={onClose} aria-label="Find anything">
        <div className={styles.box}>
          <input
            ref={inputRef}
            className={styles.input}
            type="search"
            role="combobox"
            aria-label="Find a screen, report, scout or event"
            aria-expanded={rows.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={current >= 0 ? `${listId}-${rows[current].id}` : undefined}
            placeholder="Find a screen, report, scout or event…"
            autoComplete="off"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
          {!term ? (
            recent.length > 0 ? (
              <div className={styles.section}>
                <p className={styles.groupTitle}>Recent searches</p>
                <ul className={styles.recentList}>
                  {recent.map((r) => (
                    <li key={r}>
                      <button type="button" className={styles.recent} onClick={() => setQ(r)}>
                        {r}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className={styles.hint}>Type a screen, a report, a task, a scout, an adult, an event or an article.</p>
            )
          ) : rows.length === 0 ? (
            <p className={styles.hint}>
              Nothing matches &ldquo;{term}&rdquo;.{term.length < 2 ? '' : ' Try a shorter word, or Everything A–Z.'}
            </p>
          ) : null}
          <div id={listId} role="listbox" aria-label="Results" className={styles.results}>
            {groupRows(rows).map(({ group, items }) => (
              <div key={group} role="group" aria-labelledby={`${listId}-g-${group}`}>
                <p id={`${listId}-g-${group}`} className={styles.groupTitle}>
                  {group}
                </p>
                {items.map(({ row, i }) => (
                  <div
                    key={row.id}
                    id={`${listId}-${row.id}`}
                    role="option"
                    aria-selected={i === current}
                    className={styles.option}
                    onMouseMove={() => setActive(i)}
                    onClick={() => openRow(row)}
                  >
                    <span className={styles.optionLabel}>{row.label}</span>
                    {row.meta ? <span className={styles.optionMeta}>{row.meta}</span> : null}
                  </div>
                ))}
              </div>
            ))}
          </div>
          <p className={styles.srOnly} role="status" aria-live="polite">
            {term ? (rows.length > 0 ? `${rows.length} result${rows.length === 1 ? '' : 's'}` : 'No results') : ''}
          </p>
          <p className={styles.footer} aria-hidden="true">
            ↑ ↓ to move · Enter to open · Esc to close
          </p>
        </div>
      </Dialog>
      {dialog}
    </>
  );
}
