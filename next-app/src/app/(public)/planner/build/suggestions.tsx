'use client';

/**
 * Build a Plan B5: the Suggestions workspace (Plans/Build-A-Plan.md, "B5: Suggestions mode"). The retired Admin
 * generator's information, restored on the planner side as three lenses over ONE engine read (lib/build-plan-suggest):
 *
 *   Group Sessions (default)  a card per session, grouped by rank: the requirement, N need it, the group by name, the
 *                             best teacher and the other qualified ones.
 *   By Scout                  each scout's next ≤3 requirements, merit badges included for older scouts.
 *   Teaching                  who can teach what; a row can add that teacher's biggest session.
 *   Needs a campout           a collapsed footer on every lens, with no Add.
 *
 * The sticky bar holds the meeting switcher, the lens and the filters (rank, MB only, show what's already on the plan).
 * Seed holders get one-click Add on each item and a tick on every lens; the ticks survive lens switches and go in one
 * "Add N to the plan" (the page's batched add). An item already on the plan reads On plan, with the plan's own quiet
 * Remove (seeded rows only; others say why). Viewers see the lenses read-only. Lens switches, filters and ticks are
 * client state: nothing here reloads anything.
 */
import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Button } from '@/app/_components/button';
import { cannotRemoveReason, type PlanRow } from '@/lib/build-plan';
import {
  campoutShown,
  cardShown,
  DEFAULT_FILTER,
  itemsByKey,
  LENS_LABEL,
  scoutItemsShown,
  teacherKeysShown,
  type Lens,
  type SuggestCard,
  type SuggestFilter,
  type SuggestItem,
  type SuggestionsData
} from '@/lib/build-plan-suggest';
import s from './suggestions.module.css';

export type SuggestFeed = { status: 'loading' } | { status: 'ready'; data: SuggestionsData } | { status: 'failed' };

const LENSES: Lens[] = ['sessions', 'scouts', 'teaching'];

export function SuggestionsWorkspace({
  feed,
  rows,
  canSeed,
  switcher,
  planHref,
  onOpenPlan,
  addItems,
  onRemove
}: {
  feed: SuggestFeed;
  rows: readonly PlanRow[];
  canSeed: boolean;
  /** The meeting switcher (the next 4 meetings, each staying in this mode). */
  switcher?: ReactNode;
  planHref: string;
  /** Phone: opens the plan in the Drawer. */
  onOpenPlan: () => void;
  /** The page's batched add: resolves to an error to show, or null. */
  addItems: (items: SuggestItem[]) => Promise<string | null>;
  onRemove: (row: PlanRow, trigger: HTMLElement | null) => void;
}) {
  const [lens, setLens] = useState<Lens>('sessions');
  const [filter, setFilter] = useState<SuggestFilter>(DEFAULT_FILTER);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [barProblem, setBarProblem] = useState<string | null>(null);

  const rowByKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows]);
  const onPlan = useMemo(() => new Set(rows.map((r) => r.key)), [rows]);
  const data = feed.status === 'ready' ? feed.data : null;
  const byKey = useMemo(() => (data ? itemsByKey(data) : new Map<string, SuggestItem>()), [data]);
  // A tick on something that has since gone on the plan no longer counts.
  const pending = [...ticked].filter((k) => !onPlan.has(k) && byKey.has(k));

  const toggle = (key: string) =>
    setTicked((t) => {
      const next = new Set(t);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const addOne = async (item: SuggestItem) => {
    const err = await addItems([item]);
    if (!err) setTicked((t) => (t.has(item.key) ? new Set([...t].filter((k) => k !== item.key)) : t));
    return err;
  };
  const addTicked = async () => {
    if (busy || !pending.length) return;
    setBusy(true);
    setBarProblem(null);
    const err = await addItems(pending.map((k) => byKey.get(k)!));
    setBusy(false);
    if (err) setBarProblem(err);
    else setTicked(new Set());
  };

  const ctl = (item: SuggestItem) => (
    <ItemAction item={item} row={rowByKey.get(item.key)} canSeed={canSeed} onAdd={addOne} onRemove={onRemove} />
  );
  const tick = (item: SuggestItem) =>
    canSeed && !onPlan.has(item.key) ? (
      <input type="checkbox" className={s.tick} checked={ticked.has(item.key)} onChange={() => toggle(item.key)} aria-label={`Select ${item.codeLabel} ${item.title}`} />
    ) : null;

  return (
    <section className={s.workspace} aria-label="Suggestions">
      <div className={s.bar}>
        {switcher}
        <div className={s.barRow}>
          <span className={s.seg} role="radiogroup" aria-label="Lens">
            {LENSES.map((l) => (
              <label key={l} className={l === lens ? s.segOn : s.segOption}>
                <input type="radio" className={s.segInput} name="build-lens" value={l} checked={l === lens} onChange={() => setLens(l)} />
                {LENS_LABEL[l]}
              </label>
            ))}
          </span>
          <select className={s.select} aria-label="Rank" value={filter.rank ?? ''} onChange={(e) => setFilter((f) => ({ ...f, rank: e.target.value || null }))}>
            <option value="">All ranks</option>
            {(data?.ranks ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
          <label className={s.check}>
            <input type="checkbox" checked={filter.mbOnly} onChange={(e) => setFilter((f) => ({ ...f, mbOnly: e.target.checked }))} />
            MB only
          </label>
          <label className={s.check}>
            <input type="checkbox" checked={filter.showOnPlan} onChange={(e) => setFilter((f) => ({ ...f, showOnPlan: e.target.checked }))} />
            Show what’s already on the plan
          </label>
          <span className={s.barEnd}>
            <button type="button" className={s.planBtn} onClick={onOpenPlan} aria-haspopup="dialog">
              Plan ({rows.length})
            </button>
            <Link href={planHref} className={s.back}>
              Back to the plan
            </Link>
          </span>
        </div>
      </div>

      <div className={s.body}>
        {feed.status === 'loading' ? <p className={s.empty}>Finding suggestions…</p> : null}
        {feed.status === 'failed' ? <p className={s.empty}>Suggestions didn’t load. Reload the page to try again.</p> : null}
        {data && lens === 'sessions' ? <Sessions data={data} filter={filter} onPlan={onPlan} tick={tick} ctl={ctl} /> : null}
        {data && lens === 'scouts' ? <Scouts data={data} filter={filter} onPlan={onPlan} tick={tick} ctl={ctl} /> : null}
        {data && lens === 'teaching' ? <Teaching data={data} filter={filter} onPlan={onPlan} byKey={byKey} tick={tick} ctl={ctl} /> : null}
        {data ? <Campout data={data} filter={filter} /> : null}
      </div>

      {canSeed && (pending.length || barProblem) ? (
        <div className={s.addBar}>
          {barProblem ? (
            <p className={s.problemBox} role="alert">
              {barProblem}
            </p>
          ) : null}
          {pending.length ? (
            <>
              <button type="button" className={s.quiet} onClick={() => setTicked(new Set())} disabled={busy}>
                Clear
              </button>
              <Button variant="primary" onClick={addTicked} disabled={busy}>
                {busy ? 'Adding…' : `Add ${pending.length} to the plan`}
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

type LensProps = {
  data: SuggestionsData;
  filter: SuggestFilter;
  onPlan: ReadonlySet<string>;
  tick: (item: SuggestItem) => ReactNode;
  ctl: (item: SuggestItem) => ReactNode;
};

const filtering = (f: SuggestFilter) => f.rank != null || f.mbOnly || !f.showOnPlan;

function Sessions({ data, filter, onPlan, tick, ctl }: LensProps) {
  const shown = data.cards.filter((c) => cardShown(c, onPlan.has(c.key), filter));
  if (!shown.length) return <p className={s.empty}>{data.cards.length ? 'Nothing matches these filters.' : 'No requirement is shared by two scouts this week. By Scout has each scout’s own.'}</p>;
  const groups = [
    ...data.ranks.map((r) => ({ id: r.id, label: r.label, cards: shown.filter((c) => c.rankId === r.id) })),
    { id: 'mb', label: 'Merit badges', cards: shown.filter((c) => c.kind === 'mb') }
  ].filter((g) => g.cards.length);
  return (
    <>
      {groups.map((g) => (
        <section key={g.id} aria-labelledby={`sg-${g.id}`}>
          <h3 id={`sg-${g.id}`} className={s.groupHead}>
            {g.label}
          </h3>
          <ul className={s.cards}>
            {g.cards.map((c) => (
              <SessionCard key={c.key} card={c} on={onPlan.has(c.key)} tick={tick(c)} ctl={ctl(c)} />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

function SessionCard({ card, on, tick, ctl }: { card: SuggestCard; on: boolean; tick: ReactNode; ctl: ReactNode }) {
  const teach = card.best
    ? `Best teacher: ${who(card.best)}${card.others.length ? ` · also ${card.others.map(who).join(', ')}` : ''}`
    : card.skillName
      ? `Nobody has the ${card.skillName} skill yet`
      : 'Any leader can teach it';
  return (
    <li className={on ? s.cardOn : s.card}>
      <div className={s.itemLine}>
        {tick}
        <p className={s.itemTitle}>
          <span className={s.code}>
            {card.eagle ? '★ ' : ''}
            {card.codeLabel}
          </span>
          {card.title}
        </p>
        {ctl}
      </div>
      <p className={s.meta}>
        {card.need} need it{card.adultOnly ? ' · adults only' : card.youthTeachable ? ' · an older scout may teach' : ''}
      </p>
      {card.groups.map((g, i) => (
        <p key={i} className={s.names}>
          {g.part ? <span className={s.part}>Group {g.part}: </span> : null}
          {g.scouts.join(', ')}
        </p>
      ))}
      <p className={card.best ? s.teach : s.noTeach}>{teach}</p>
    </li>
  );
}

const who = (t: { name: string; note: string | null }) => (t.note ? `${t.name} (${t.note})` : t.name);

function Scouts({ data, filter, onPlan, tick, ctl }: LensProps) {
  const rows = data.scouts
    .map((sc) => ({ sc, items: scoutItemsShown(sc.items, onPlan, filter) }))
    .filter(({ sc, items }) => items.length || (!filtering(filter) && !sc.items.length));
  if (!rows.length) return <p className={s.empty}>{data.scouts.length ? 'Nothing matches these filters.' : 'No scout has a suggestion this week.'}</p>;
  return (
    <ul className={s.rows}>
      {rows.map(({ sc, items }) => (
        <li key={sc.id} className={s.scout}>
          <p className={s.who}>
            {sc.name}
            <span className={s.whoMeta}>
              {sc.rankLabel}
              {sc.patrol ? ` · ${sc.patrol}` : ''}
            </span>
          </p>
          {items.length ? (
            <ul className={s.items}>
              {items.map((i) => (
                <li key={i.key} className={onPlan.has(i.key) ? s.itemOn : s.item}>
                  <div className={s.itemLine}>
                    {tick(i)}
                    <p className={s.itemTitle}>
                      <span className={s.code}>
                        {i.eagle ? '★ ' : ''}
                        {i.codeLabel}
                      </span>
                      {i.title}
                    </p>
                    {ctl(i)}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className={s.meta}>Only campout items left</p>
          )}
        </li>
      ))}
    </ul>
  );
}

function Teaching({ data, filter, onPlan, byKey, tick, ctl }: LensProps & { byKey: ReadonlyMap<string, SuggestItem> }) {
  const rows = data.teachers
    .map((t) => ({ t, keys: teacherKeysShown(t.keys, byKey, onPlan, filter) }))
    .filter(({ keys }) => keys.length || (filter.rank == null && !filter.mbOnly));
  if (!rows.length) return <p className={s.empty}>{data.teachers.length ? 'Nothing matches these filters.' : 'Nobody has a teaching skill yet.'}</p>;
  return (
    <ul className={s.rows}>
      {rows.map(({ t, keys }) => {
        const best = keys.map((k) => byKey.get(k)!).find((i) => !onPlan.has(i.key));
        return (
          <li key={t.id} className={s.scout}>
            <div className={s.itemLine}>
              {best ? tick(best) : null}
              <p className={s.who}>
                {t.name}
                {t.meta ? <span className={s.whoMeta}>{t.scout ? `${t.meta} scout` : t.meta}</span> : null}
              </p>
              {best ? ctl(best) : null}
            </div>
            <p className={s.meta}>{t.skills.join(' · ')}</p>
            {keys.length ? (
              <p className={s.names}>
                {keys.map((k, i) => {
                  const item = byKey.get(k)!;
                  return (
                    <span key={k} className={onPlan.has(k) ? s.chipOn : s.chip}>
                      {item.codeLabel}
                      {onPlan.has(k) ? ' · on plan' : ''}
                      {i < keys.length - 1 ? ' ' : ''}
                    </span>
                  );
                })}
              </p>
            ) : (
              <p className={s.meta}>No session for them this week</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Campout({ data, filter }: { data: SuggestionsData; filter: SuggestFilter }) {
  const shown = data.campout.filter((c) => campoutShown(c, filter));
  if (!shown.length) return null;
  return (
    <details className={s.campout}>
      <summary>Needs a campout ({shown.length})</summary>
      <ul className={s.rows}>
        {shown.map((c) => (
          <li key={`${c.codeLabel}|${c.title}`} className={s.campoutRow}>
            <p className={s.itemTitle}>
              <span className={s.code}>{c.codeLabel}</span>
              {c.title}
            </p>
            <p className={s.names}>{c.scouts.join(', ')}</p>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** An item's end: Add (with its error in place), or On plan with the plan's quiet Remove; nothing for a viewer. */
function ItemAction({
  item,
  row,
  canSeed,
  onAdd,
  onRemove
}: {
  item: SuggestItem;
  row: PlanRow | undefined;
  canSeed: boolean;
  onAdd: (item: SuggestItem) => Promise<string | null>;
  onRemove: (row: PlanRow, trigger: HTMLElement | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (row) {
    const why = canSeed ? cannotRemoveReason(row) : null;
    return (
      <span className={s.end}>
        <span className={s.onPlan}>On plan</span>
        {canSeed && !why ? (
          <button type="button" className={s.quiet} onClick={(e) => onRemove(row, e.currentTarget)} aria-label={`Remove ${item.codeLabel} ${item.title}`} aria-haspopup="dialog">
            Remove
          </button>
        ) : null}
        {why ? <span className={s.why}>{why}</span> : null}
      </span>
    );
  }
  if (!canSeed) return null;
  const add = async () => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const err = await onAdd(item);
    setBusy(false);
    if (err) setProblem(err);
  };
  return (
    <span className={s.end}>
      <Button variant="secondary" size="sm" className={s.addBtn} onClick={add} disabled={busy} aria-label={`Add ${item.codeLabel} ${item.title}`}>
        {busy ? 'Adding…' : 'Add'}
      </Button>
      {problem ? (
        <span className={s.problemBox} role="alert">
          {problem}
        </span>
      ) : null}
    </span>
  );
}
