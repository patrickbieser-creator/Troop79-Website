'use client';

/**
 * Focus sets, the client side (Plans/Meeting-Planner-II.md P3; prototypes/meeting-plan-II/README.md "Screen 4"). Three
 * columns on a wide screen (sets · find requirements · the active set), one column on a phone in that order.
 *
 *   - Sets: label filter pills, one row per set (name, "N requirements · used Oct 11", labels).
 *   - Find requirements: the server search (every typed word against rank or badge, code, label and the requirement
 *     it sits under), 50 rows a page grouped by rank or badge. Pills (Patrick, 2026-10-29): All · Scout · Tenderfoot ·
 *     Second Class · First Class · Merit badge. A rank pill shows that rank's requirements; Merit badge lists the badges,
 *     and picking one adds a removable "First Aid ✕" pill (picking another replaces it). A tick adds a row to the
 *     active set's draft.
 *   - The active set: "+ New set" at the top right (seed right only), then name, labels, what's in it, then Save
 *     changes / Discard changes (the save-button standard: greyed only when nothing changed; pressed while incomplete
 *     it marks the field and says why), Add to a meeting's plan, and Delete.
 * Build a Plan B4 (one add path): adding a set to a meeting is Build's own plannerAddFocusSetAction, on the next 4
 * meetings Build's switcher offers.
 *
 * Read-only for anyone without meeting_planner.seed: no ticks, no editing, no seeding.
 */
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/app/_components/button';
import { Field, SaveProblem, SelectInput, TextInput } from '@/app/_components/form';
import { fmtDate } from '@/lib/format-date';
import { draftKey, draftProblem, groupItems, LABEL_MAX, normalizeLabel, type FocusSearchRow, type FocusSetItem, type FocusSetView, type FocusSource, type SetDraft } from '@/lib/meeting-focus';
import { focusCountsAction, focusDeleteSetAction, focusSaveSetAction, focusSearchAction } from '../focus-actions';
import { twAddFocusSetAction } from '../this-week-actions';
import styles from '../planner.module.css';

type Kind = 'all' | 'rank' | 'mb';
/** The ranks a focus works on (the planner's groups): Star, Life and Eagle aren't offered here (Patrick, 2026-10-29). */
const GROUP_RANKS = ['scout', 'tenderfoot', 'second-class', 'first-class'];
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const EMPTY: SetDraft = { name: '', labels: [], items: [] };
const toDraft = (s: FocusSetView | null): SetDraft => (s ? { name: s.name, labels: [...s.labels], items: [...s.items] } : EMPTY);

export function FocusSetsClient({
  canSeed,
  sets,
  sources,
  meetings
}: {
  canSeed: boolean;
  sets: readonly FocusSetView[];
  /** Every rank and badge with its requirement count, for browsing. */
  sources: readonly FocusSource[];
  meetings: readonly { entryId: number; label: string }[];
}) {
  const router = useRouter();
  // Which set is open: an id, 'new' for one not saved yet, or null.
  const [activeId, setActiveId] = useState<number | 'new' | null>(sets[0]?.id ?? null);
  const active = typeof activeId === 'number' ? (sets.find((s) => s.id === activeId) ?? null) : null;
  const [saved, setSaved] = useState<SetDraft>(() => toDraft(active));
  const [draft, setDraft] = useState<SetDraft>(() => toDraft(active));
  const [labelFilter, setLabelFilter] = useState<string | null>(null);
  const dirty = draftKey(draft) !== draftKey(saved);

  function open(id: number | 'new') {
    if (id === activeId) return;
    if (dirty && !window.confirm('Discard the changes to this set?')) return;
    const next = typeof id === 'number' ? (sets.find((s) => s.id === id) ?? null) : null;
    setActiveId(id);
    setSaved(toDraft(next));
    setDraft(toDraft(next));
  }

  const allLabels = useMemo(() => [...new Set(sets.flatMap((s) => s.labels))].sort(), [sets]);
  const shown = labelFilter ? sets.filter((s) => s.labels.includes(labelFilter)) : sets;
  const inDraft = new Set(draft.items.map((i) => i.key));
  const editing = canSeed && activeId != null;
  const toggleItem = (row: FocusSetItem) =>
    setDraft((d) => (d.items.some((i) => i.key === row.key) ? { ...d, items: d.items.filter((i) => i.key !== row.key) } : { ...d, items: [...d.items, pickItem(row)] }));
  const addAll = (rows: readonly FocusSetItem[]) => setDraft((d) => ({ ...d, items: [...d.items, ...rows.filter((r) => !d.items.some((i) => i.key === r.key)).map(pickItem)] }));

  return (
    <div className={styles.fsGrid}>
      <section className={styles.fsCol} aria-labelledby="fs-sets">
        <div className={styles.fsColHead}>
          <h2 id="fs-sets" className={styles.fsColTitle}>
            Sets · {sets.length}
          </h2>
        </div>
        {allLabels.length ? (
          <div className={styles.fsPills} role="group" aria-label="Show sets labelled">
            <button type="button" className={labelFilter == null ? styles.fsPillOn : styles.fsPill} aria-pressed={labelFilter == null} onClick={() => setLabelFilter(null)}>
              All sets
            </button>
            {allLabels.map((l) => (
              <button key={l} type="button" className={labelFilter === l ? styles.fsPillOn : styles.fsPill} aria-pressed={labelFilter === l} onClick={() => setLabelFilter(labelFilter === l ? null : l)}>
                {l}
              </button>
            ))}
          </div>
        ) : null}
        {shown.length ? (
          <ul className={styles.fsSetList}>
            {shown.map((s) => (
              <li key={s.id}>
                <button type="button" className={s.id === activeId ? styles.fsSetOn : styles.fsSet} aria-current={s.id === activeId || undefined} onClick={() => open(s.id)}>
                  <span className={styles.optTitle}>{s.name}</span>
                  <span className={styles.optMeta}>
                    {plural(s.items.length, 'requirement')}
                    {s.lastUsed ? ` · used ${fmtDate(s.lastUsed, { year: false })}` : ''}
                  </span>
                  {s.labels.length ? (
                    <span className={styles.fsLabels}>
                      {s.labels.map((l) => (
                        <span key={l} className={styles.fsLabel}>
                          {l}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.empty}>{sets.length ? 'No set has that label.' : 'No sets yet.'}</p>
        )}
      </section>

      <Finder sources={sources} editing={editing} inDraft={inDraft} onToggle={toggleItem} onAddAll={addAll} />

      <section className={styles.fsCol} aria-label="The set">
        {canSeed ? (
          <div className={`${styles.fsColHead} ${styles.fsColHeadEnd}`}>
            <Button size="sm" variant="secondary" onClick={() => open('new')}>
              + New set
            </Button>
          </div>
        ) : null}
        {activeId == null ? (
          <p className={styles.empty}>{canSeed ? 'Choose a set, or make a new one.' : 'Choose a set to see what’s in it.'}</p>
        ) : canSeed ? (
          <SetEditor
            key={activeId}
            id={typeof activeId === 'number' ? activeId : null}
            draft={draft}
            saved={saved}
            dirty={dirty}
            setDraft={setDraft}
            suggestions={allLabels.filter((l) => !draft.labels.includes(l))}
            meetings={meetings}
            lastUsed={active?.lastUsed ?? null}
            onSaved={(id) => {
              setSaved(draft);
              setActiveId(id);
              router.refresh();
            }}
            onDeleted={() => {
              setActiveId(null);
              setSaved(EMPTY);
              setDraft(EMPTY);
              router.refresh();
            }}
          />
        ) : (
          <>
            <h2 className={styles.fsColTitle}>{saved.name}</h2>
            {saved.labels.length ? (
              <span className={styles.fsLabels}>
                {saved.labels.map((l) => (
                  <span key={l} className={styles.fsLabel}>
                    {l}
                  </span>
                ))}
              </span>
            ) : null}
            <ItemList items={saved.items} />
          </>
        )}
      </section>
    </div>
  );
}

const pickItem = (r: FocusSetItem): FocusSetItem => ({ key: r.key, kind: r.kind, sourceId: r.sourceId, sourceName: r.sourceName, code: r.code, label: r.label });

/** What's in the set, grouped by rank or badge; a ✕ per row when editing. */
function ItemList({ items, onRemove }: { items: readonly FocusSetItem[]; onRemove?: (key: string) => void }) {
  if (!items.length) return <p className={styles.empty}>Nothing in this set yet.</p>;
  return (
    <div className={styles.fsItems}>
      {groupItems(items).map((g) => (
        <div key={g.sourceId || 'gone'}>
          <h4 className={styles.fsGroupHead}>
            {g.sourceName || 'No longer in the catalog'} · {g.items.length}
          </h4>
          <ul className={styles.fsRows}>
            {g.items.map((i) => (
              <li key={i.key} className={styles.fsItem}>
                <span className={styles.code}>{i.code}</span>
                <span className={styles.fsItemLabel}>{i.label}</span>
                {onRemove ? (
                  <button type="button" className={styles.fsRemove} onClick={() => onRemove(i.key)} aria-label={`Take ${i.sourceName} ${i.code} out of the set`}>
                    ✕
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** The middle column: the server search, a rank's requirements, or the badges to browse. */
function Finder({
  sources,
  editing,
  inDraft,
  onToggle,
  onAddAll
}: {
  sources: readonly FocusSource[];
  editing: boolean;
  inDraft: ReadonlySet<string>;
  onToggle: (row: FocusSetItem) => void;
  onAddAll: (rows: readonly FocusSetItem[]) => void;
}) {
  const [q, setQ] = useState('');
  // The pill: All, one of the group ranks (by id), or Merit badge; with Merit badge, the badge picked from the list.
  const [pill, setPill] = useState<string>('all');
  const [badge, setBadge] = useState<FocusSource | null>(null);
  const ranks = GROUP_RANKS.flatMap((id) => sources.filter((x) => x.kind === 'rank' && x.id === id));
  const rank = ranks.find((r) => r.id === pill) ?? null;
  const kind: Kind = pill === 'all' ? 'all' : pill === 'mb' ? 'mb' : 'rank';
  const source = rank ?? (pill === 'mb' ? badge : null);
  const choose = (next: string) => {
    setPill(next);
    setBadge(null);
  };
  const [rows, setRows] = useState<FocusSearchRow[]>([]);
  const [counts, setCounts] = useState<ReadonlyMap<string, number>>(new Map());
  const [hasMore, setHasMore] = useState(false);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const text = q.trim();
  const searching = !!text || !!source;

  useEffect(() => {
    if (!searching) return;
    let live = true;
    const t = setTimeout(() => {
      setState('loading');
      Promise.all([focusSearchAction({ q: text, kind, source: source?.id ?? null, offset: 0 }), text ? focusCountsAction({ q: text, kind }) : Promise.resolve(null)])
        .then(([res, c]) => {
          if (!live) return;
          if (!res.ok) return setState('error');
          setRows(res.rows);
          setHasMore(res.hasMore);
          setCounts(new Map(c?.ok ? c.sources.map((x) => [x.id, x.n]) : source ? [[source.id, source.n]] : []));
          setState('idle');
        })
        .catch(() => live && setState('error'));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [text, kind, source, searching]);

  async function more() {
    setState('loading');
    const res = await focusSearchAction({ q: text, kind, source: source?.id ?? null, offset: rows.length }).catch(() => null);
    if (!res?.ok) return setState('error');
    setRows((r) => [...r, ...res.rows]);
    setHasMore(res.hasMore);
    setState('idle');
  }

  const badges = sources.filter((x) => x.kind === 'mb');
  return (
    <section className={styles.fsCol} aria-labelledby="fs-find">
      <h2 id="fs-find" className={styles.fsColTitle}>
        Find requirements
      </h2>
      <input
        type="search"
        className={styles.enterInput}
        placeholder="Knots, Tenderfoot 4a, First Aid 9…"
        aria-label="Search requirements"
        maxLength={80}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className={styles.fsPills} role="group" aria-label="Show">
        {[{ id: 'all', name: 'All' }, ...ranks, { id: 'mb', name: 'Merit badge' }].map((p) => (
          <button key={p.id} type="button" className={pill === p.id ? styles.fsPillOn : styles.fsPill} aria-pressed={pill === p.id} onClick={() => choose(p.id)}>
            {p.name}
          </button>
        ))}
        {pill === 'mb' && badge ? (
          <button type="button" className={styles.fsPillOn} onClick={() => setBadge(null)} aria-label={`Show every merit badge, not just ${badge.name}`}>
            {badge.name} ✕
          </button>
        ) : null}
      </div>

      {!searching ? null : state === 'error' ? (
        <p className={styles.rowProblem} role="alert">
          The search didn’t work. Try again.
        </p>
      ) : !rows.length ? (
        <p className={styles.empty}>{state === 'loading' ? 'Searching…' : 'Nothing matches.'}</p>
      ) : (
        <>
          {groupItems(rows).map((g) => (
            <div key={g.sourceId} className={styles.fsResultGroup}>
              <div className={styles.fsGroupBar}>
                <h3 className={styles.fsGroupHead}>
                  {g.sourceName} <span className={styles.optMeta}>{plural(counts.get(g.sourceId) ?? g.items.length, 'match', 'matches')}</span>
                </h3>
                {editing && g.items.some((i) => !inDraft.has(i.key)) ? (
                  <button type="button" className={styles.assignBtn} onClick={() => onAddAll(g.items)}>
                    Add all {g.items.length}
                  </button>
                ) : null}
              </div>
              <ul className={styles.fsRows}>
                {g.items.map((r) => (
                  <li key={r.key}>
                    {editing ? (
                      <button type="button" className={styles.fsResult} aria-pressed={inDraft.has(r.key)} onClick={() => onToggle(r)}>
                        <span className={styles.check} aria-hidden="true">
                          {inDraft.has(r.key) ? '✓' : ''}
                        </span>
                        <ResultText r={r} />
                      </button>
                    ) : (
                      <div className={styles.fsResult}>
                        <ResultText r={r} />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {hasMore ? (
            <button type="button" className={styles.quietAdd} onClick={more} disabled={state === 'loading'}>
              {state === 'loading' ? 'Loading…' : 'Show 50 more'}
            </button>
          ) : null}
        </>
      )}

      {/* The badges to pick from: under Merit badge (and All, with nothing typed). Picking one shows its requirements and
          a removable pill; picking another replaces it. */}
      {(pill === 'mb' || (pill === 'all' && !searching)) && badges.length ? (
        <div>
          <h3 className={styles.listLabel}>Merit badges · {badges.length}</h3>
          <ul className={styles.fsTiles}>
            {badges.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  className={styles.fsTile}
                  aria-pressed={badge?.id === b.id}
                  onClick={() => {
                    setPill('mb');
                    setBadge(b);
                  }}
                >
                  <span>{b.name}</span>
                  <span className={styles.optMeta}>{b.n}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function ResultText({ r }: { r: FocusSearchRow }) {
  return (
    <>
      <span className={styles.code}>{r.code}</span>
      <span className={styles.optText}>
        <span className={styles.fsItemLabel}>{r.label}</span>
        {r.parent ? <span className={styles.optMeta}>{r.parent}</span> : null}
      </span>
    </>
  );
}

/** The active set's editor: name, labels, items, Save / Discard, Seed a meeting, Delete. */
function SetEditor({
  id,
  draft,
  saved,
  dirty,
  setDraft,
  suggestions,
  meetings,
  lastUsed,
  onSaved,
  onDeleted
}: {
  id: number | null;
  draft: SetDraft;
  saved: SetDraft;
  dirty: boolean;
  setDraft: (fn: (d: SetDraft) => SetDraft) => void;
  suggestions: readonly string[];
  meetings: readonly { entryId: number; label: string }[];
  lastUsed: string | null;
  onSaved: (id: number) => void;
  onDeleted: () => void;
}) {
  const [label, setLabel] = useState('');
  const [phase, setPhase] = useState<'idle' | 'saving' | 'done'>('idle');
  const [tried, setTried] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [labelProblem, setLabelProblem] = useState<string | null>(null);
  const [meeting, setMeeting] = useState<number | null>(meetings[0]?.entryId ?? null);
  const [seed, setSeed] = useState<{ state: 'idle' | 'seeding' } | { state: 'done'; text: string; entryId: number } | { state: 'bad'; text: string }>({ state: 'idle' });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const blocked = draftProblem(draft);
  const isNew = id == null;

  function addLabel(raw: string) {
    const l = normalizeLabel(raw);
    if (!l) return;
    if (l.length > LABEL_MAX) return setLabelProblem(`Keep labels to ${LABEL_MAX} characters.`);
    setLabelProblem(null);
    setDraft((d) => (d.labels.includes(l) ? d : { ...d, labels: [...d.labels, l] }));
    setLabel('');
  }

  async function save() {
    setTried(true);
    if (blocked) return;
    setPhase('saving');
    setProblem(null);
    const res = await focusSaveSetAction({ id, name: draft.name, labels: draft.labels, items: draft.items.map((i) => i.key) }).catch(() => ({ ok: false as const, error: 'That didn’t save. Check your connection and try again.' }));
    if (!res.ok) {
      setPhase('idle');
      setProblem(res.error);
      return;
    }
    setPhase('done');
    setTried(false);
    onSaved(res.id);
  }

  async function seedIt() {
    if (id == null || dirty) return setSeed({ state: 'bad', text: 'Save the set first.' });
    if (meeting == null) return;
    setSeed({ state: 'seeding' });
    const res = await twAddFocusSetAction({ entryId: meeting, setId: id }).catch(() => ({ ok: false as const, error: 'That didn’t save. Check your connection and try again.' }));
    const when = meetings.find((m) => m.entryId === meeting)?.label ?? '';
    setSeed(res.ok ? { state: 'done', text: `✓ In the focus for ${when}`, entryId: meeting } : { state: 'bad', text: res.error });
  }

  async function remove() {
    if (id == null) return;
    const res = await focusDeleteSetAction({ id }).catch(() => ({ ok: false as const, error: 'That didn’t delete. Try again.' }));
    if (res.ok) onDeleted();
    else setProblem(res.error);
  }

  return (
    <>
      <Field label="Set name" problem={tried && blocked?.at === 'name' ? blocked.text : undefined}>
        <TextInput value={draft.name} maxLength={80} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} autoFocus={isNew} />
      </Field>

      <h3 className={styles.listLabel}>Labels</h3>
      {draft.labels.length ? (
        <ul className={styles.fsLabelChips}>
          {draft.labels.map((l) => (
            <li key={l} className={styles.fsLabelChip}>
              {l}
              <button type="button" className={styles.fsRemove} onClick={() => setDraft((d) => ({ ...d, labels: d.labels.filter((x) => x !== l) }))} aria-label={`Remove the label ${l}`}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className={styles.fsAddLabel}>
        <input
          className={labelProblem ? `${styles.enterInput} ${styles.fsBadInput}` : styles.enterInput}
          placeholder="Add a label…"
          aria-label="Add a label"
          aria-invalid={labelProblem ? true : undefined}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addLabel(label);
            }
          }}
        />
        <Button size="sm" variant="secondary" onClick={() => addLabel(label)} disabled={!label.trim()}>
          Add
        </Button>
      </div>
      {labelProblem ? (
        <p className={styles.rowProblem} role="alert">
          {labelProblem}
        </p>
      ) : null}
      {suggestions.length ? (
        <div className={styles.fsSuggest}>
          {suggestions.map((l) => (
            <button key={l} type="button" className={styles.fsSuggestBtn} onClick={() => addLabel(l)}>
              + {l}
            </button>
          ))}
        </div>
      ) : null}

      <h3 className={styles.listLabel}>
        In this set · {draft.items.length}
        {lastUsed ? <span className={styles.optMeta}> · used {fmtDate(lastUsed, { year: false })}</span> : null}
      </h3>
      <ItemList items={draft.items} onRemove={(key) => setDraft((d) => ({ ...d, items: d.items.filter((i) => i.key !== key) }))} />

      <div className={styles.fsSaveBar}>
        <Button onClick={save} disabled={(!dirty && !isNew) || phase === 'saving'} title={!dirty && !isNew ? 'No changes to save yet' : undefined}>
          {phase === 'saving' ? 'Saving changes…' : isNew ? 'Create set' : dirty ? 'Save changes' : 'Saved'}
        </Button>
        <Button
          variant="secondary"
          disabled={!dirty || phase === 'saving'}
          onClick={() => {
            setDraft(() => saved);
            setTried(false);
            setProblem(null);
          }}
        >
          Discard changes
        </Button>
        {tried && blocked ? <SaveProblem reason={blocked.text} /> : null}
        {phase === 'done' && !dirty ? <span className={styles.assigned}>Done</span> : null}
        {problem ? (
          <p className={styles.rowProblem} role="alert">
            {problem}
          </p>
        ) : null}
      </div>

      {!isNew ? (
        <div className={styles.fsSeed}>
          <h3 className={styles.fsSeedTitle}>Add this set to a meeting’s plan</h3>
          {meetings.length ? (
            <>
              <div className={styles.fsSeedRow}>
                <Field label="Meeting" className={styles.fsSeedField}>
                  <SelectInput value={meeting ?? ''} onChange={(e) => setMeeting(Number(e.target.value))}>
                    {meetings.map((m) => (
                      <option key={m.entryId} value={m.entryId}>
                        {m.label}
                      </option>
                    ))}
                  </SelectInput>
                </Field>
                <button type="button" className={styles.seedBtn} onClick={seedIt} disabled={seed.state === 'seeding' || !draft.items.length}>
                  {seed.state === 'seeding' ? 'Adding…' : 'Add to the plan'}
                </button>
              </div>
              {seed.state === 'done' ? (
                <p className={styles.assigned}>
                  {seed.text} · <Link href={`/planner?meeting=${seed.entryId}`}>open the plan</Link>
                </p>
              ) : null}
              {seed.state === 'bad' ? (
                <p className={styles.rowProblem} role="alert">
                  {seed.text}
                </p>
              ) : null}
            </>
          ) : (
            <p className={styles.optMeta}>No meeting coming up takes sign-ups.</p>
          )}
        </div>
      ) : null}

      {!isNew ? (
        <div className={styles.fsDelete}>
          {confirmDelete ? (
            <>
              <p className={styles.optMeta}>Delete “{saved.name}”? Meetings already seeded with it keep their copy.</p>
              <Button size="sm" variant="danger" onClick={remove}>
                Delete set
              </Button>{' '}
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button size="sm" variant="dangerGhost" onClick={() => setConfirmDelete(true)}>
              Delete set
            </Button>
          )}
        </div>
      ) : null}
    </>
  );
}
