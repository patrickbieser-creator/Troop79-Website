'use client';

/**
 * "+ Add a focus set" on This week (Plans/Meeting-Planner-III.md; Design II's Focus sets screen, inline): name,
 * labels, an optional paired merit badge, "Find requirements" (rank AND merit badge requirements, by code or words,
 * with rank pills) and "In this set", grouped. Save follows the house rule (D-331): a blocked Save stays enabled, marks
 * the bad field and says "Can't save yet: … (+N more)". A saved set joins tonight's focus. Cancel discards.
 */
import { useEffect, useId, useState } from 'react';
import { Button } from '@/app/_components/button';
import { groupItems, LABEL_MAX, normalizeLabel, SET_NAME_MAX, type FocusSearchRow, type FocusSetItem } from '@/lib/meeting-focus';
import { focusSaveSetAction, focusSearchAction } from './focus-actions';
import { twAddFocusSetAction } from './this-week-actions';
import { useWrite } from './this-week-parts';
import s from './this-week.module.css';

const RANK_PILLS: { id: string | null; label: string; kind: 'all' | 'rank' | 'mb' }[] = [
  { id: null, label: 'All', kind: 'all' },
  { id: 'scout', label: 'Scout', kind: 'rank' },
  { id: 'tenderfoot', label: 'Tenderfoot', kind: 'rank' },
  { id: 'second-class', label: 'Second Class', kind: 'rank' },
  { id: 'first-class', label: 'First Class', kind: 'rank' },
  { id: null, label: 'Merit badges', kind: 'mb' }
];

export function FocusBuilder({ entryId, badges, onDone }: { entryId: number; badges: readonly { id: string; name: string }[]; onDone: () => void }) {
  const uid = useId();
  const w = useWrite();
  const [name, setName] = useState('');
  const [labels, setLabels] = useState<string[]>([]);
  const [newLabel, setNewLabel] = useState('');
  const [mbId, setMbId] = useState('');
  const [items, setItems] = useState<FocusSetItem[]>([]);
  const [q, setQ] = useState('');
  const [pill, setPill] = useState(0);
  const [results, setResults] = useState<FocusSearchRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [tried, setTried] = useState(false);

  // The server search, debounced; an empty box with a rank pill browses that rank.
  useEffect(() => {
    const p = RANK_PILLS[pill];
    const text = q.trim();
    if (!text && p.kind === 'all') return;
    let live = true;
    const t = setTimeout(async () => {
      setSearching(true);
      const res = await focusSearchAction({ q: text, kind: p.kind, source: p.id, offset: 0 }).catch(() => null);
      if (!live) return;
      setSearching(false);
      setResults(res?.ok ? res.rows : []);
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, pill]);

  const browsing = !!q.trim() || RANK_PILLS[pill].kind !== 'all';
  const shown = browsing ? results : [];
  const problems: { at: 'name' | 'items'; text: string }[] = [];
  if (!name.trim()) problems.push({ at: 'name', text: 'Name the focus set' });
  else if (name.trim().length > SET_NAME_MAX) problems.push({ at: 'name', text: `Keep the name to ${SET_NAME_MAX} characters` });
  if (!items.length) problems.push({ at: 'items', text: 'Add at least one requirement' });
  const bad = (at: 'name' | 'items') => tried && problems.some((p) => p.at === at);
  const has = new Set(items.map((i) => i.key));

  const addLabel = () => {
    const l = normalizeLabel(newLabel);
    if (l && l.length <= LABEL_MAX && !labels.includes(l)) setLabels([...labels, l]);
    setNewLabel('');
  };
  const save = async () => {
    setTried(true);
    if (problems.length) {
      document.getElementById(problems[0].at === 'name' ? `${uid}-name` : `${uid}-q`)?.focus();
      return;
    }
    const res = await focusSaveSetAction({ id: null, name: name.trim(), labels, items: items.map((i) => i.key), mbId: mbId || null }).catch(() => null);
    if (!res?.ok) {
      w.setError(res?.error ?? 'Couldn’t save that. Try again.');
      return;
    }
    if (await w.run(() => twAddFocusSetAction({ entryId, setId: res.id }))) onDone();
  };

  return (
    <div className={s.builder} role="group" aria-label="Add a focus set">
      <div className={s.builderFull}>
        <h3 className={s.popName}>Add a focus set</h3>
      </div>
      <label className={s.fieldLabel} htmlFor={`${uid}-name`}>
        Name
        <input
          id={`${uid}-name`}
          className={`${s.search} ${bad('name') ? s.bad : ''}`}
          value={name}
          maxLength={SET_NAME_MAX + 20}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={bad('name') || undefined}
          placeholder="Knots for new scouts"
        />
        {bad('name') ? <span className={s.badNote}>{problems.find((p) => p.at === 'name')!.text}.</span> : null}
      </label>
      <div className={s.fieldLabel}>
        Labels
        <div className={s.row}>
          {labels.map((l) => (
            <span key={l} className={s.pick}>
              {l}
              <button type="button" className={s.x} aria-label={`Remove label ${l}`} onClick={() => setLabels(labels.filter((x) => x !== l))}>
                ×
              </button>
            </span>
          ))}
          <input
            className={s.search}
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addLabel();
              }
            }}
            placeholder="Fall, Outdoor skills…"
            aria-label="New label"
          />
          <button type="button" className={s.quiet} onClick={addLabel}>
            Add label
          </button>
        </div>
      </div>
      <label className={s.fieldLabel}>
        Merit badge that goes with it (optional)
        <select className={s.search} value={mbId} onChange={(e) => setMbId(e.target.value)}>
          <option value="">None</option>
          {badges.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>

      <div className={s.fieldLabel}>
        <label htmlFor={`${uid}-q`}>Find requirements</label>
        <input id={`${uid}-q`} className={s.search} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Code or words: 4a, bandage, First Aid 3…" />
        <div className={s.pills} role="group" aria-label="Where to look">
          {RANK_PILLS.map((p, i) => (
            <button key={p.label} type="button" className={s.pill} aria-pressed={pill === i} onClick={() => setPill(i)}>
              {p.label}
            </button>
          ))}
        </div>
        <ul className={s.results} aria-busy={searching}>
          {!shown.length ? <li className={s.popEmpty}>{browsing ? (searching ? 'Searching…' : 'Nothing matches.') : 'Type a code or words, or pick a rank.'}</li> : null}
          {shown.map((r) => {
            const on = has.has(r.key);
            return (
              <li key={r.key} className={s.popItem}>
                <div className={s.popMain}>
                  <div className={s.popName}>
                    {r.sourceName} {r.code}
                  </div>
                  <div className={s.popMeta}>{r.label}</div>
                </div>
                <button type="button" className={s.toggle} aria-pressed={on} onClick={() => setItems(on ? items.filter((i) => i.key !== r.key) : [...items, r])}>
                  {on ? '✓ Added' : 'Add'}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <div className={`${s.fieldLabel} ${bad('items') ? s.bad : ''}`}>
        In this set · {items.length} requirement{items.length === 1 ? '' : 's'}
        {items.length ? null : <span className={s.muted}>Nothing yet. Add requirements from the search.</span>}
        <ul className={s.inSet}>
          {groupItems(items).map((g) => (
            <li key={g.sourceId} className={s.inSetGroup}>
              <span className={s.popName}>{g.sourceName}</span>
              <div className={s.row}>
                {g.items.map((i) => (
                  <span key={i.key} className={s.pick} title={i.label}>
                    {i.code}
                    <button type="button" className={s.x} aria-label={`Remove ${i.sourceName} ${i.code}`} onClick={() => setItems(items.filter((x) => x.key !== i.key))}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
        {bad('items') ? <span className={s.badNote}>{problems.find((p) => p.at === 'items')!.text}.</span> : null}
      </div>
      <div className={`${s.saveBar} ${s.builderFull}`}>
        <Button variant="primary" onClick={save} disabled={w.busy}>
          {w.busy ? 'Saving…' : 'Save and add to tonight'}
        </Button>
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        {tried && problems.length ? (
          <span className={s.problem} role="alert">
            Can’t save yet: {problems[0].text}
            {problems.length > 1 ? ` (+${problems.length - 1} more)` : ''}
          </span>
        ) : null}
        {w.error ? (
          <span className={s.problem} role="alert">
            {w.error}
          </span>
        ) : null}
      </div>
    </div>
  );
}
