'use client';

/**
 * Build a Plan B5: the Suggestions workspace (Plans/Build-A-Plan.md, "B5: Suggestions mode"). The retired Admin
 * generator's information, restored on the planner side as three lenses over ONE engine read (lib/build-plan-suggest):
 *
 *   Group Sessions (default)  a card per session, grouped by rank: the requirement, N need it, the group by name, the
 *                             best teacher and the other qualified ones.
 *   By Scout                  each scout's next ≤3 requirements, merit badges included for older scouts. B9: every
 *                             active scout is listed; one with none says why (the engine's reason, worded).
 *   Teaching                  who can teach what. Each requirement chip in a leader's row is the control (Patrick,
 *                             2026-10-22), labelled "Scout 2 · Flag": a click asks first (add it with them teaching,
 *                             or make them its teacher), with "on plan" and "teaching" markers.
 *                             Rows take no tick: one leader's choice never lights up another's.
 *   Needs a campout           a collapsed footer on every lens, with no Add.
 *   Solo needs (B9)           a collapsed footer on Group Sessions: what only one scout needs, with Add.
 *
 * The sticky bar holds the meeting switcher, the lens and the filters (rank, MB only, show what's already on the plan).
 * Seed holders get one-click Add on each item and a tick on Group Sessions and By Scout; the ticks survive lens switches and go in one
 * "Add N to the plan" (the page's batched add). An item already on the plan reads On plan, with the plan's own quiet
 * Remove (seeded rows only; others say why). Viewers see the lenses read-only. Lens switches, filters and ticks are
 * client state: nothing here reloads anything.
 * Focus (qa-lead B5 #3): the workspace takes focus when the mode opens; after an Add (one, or "Add N to the plan") it
 * moves to the next Add still there, else the workspace, never body. "Finding suggestions…" is a live region that is
 * there from the start. Leaders who may edit Lookups (roster.manage) get "Edit in Lookups" in the Teaching lens.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
  scoutRowShown,
  soloNeeds,
  teacherKeysShown,
  type Lens,
  type SuggestCard,
  type SuggestFilter,
  type SuggestItem,
  type SuggestionsData
} from '@/lib/build-plan-suggest';
import s from './suggestions.module.css';
import b from './build.module.css';

export type SuggestFeed = { status: 'loading' } | { status: 'ready'; data: SuggestionsData } | { status: 'failed' };

const LENSES: Lens[] = ['sessions', 'scouts', 'teaching'];

export function SuggestionsWorkspace({
  feed,
  rows,
  canSeed,
  switcher,
  onOpenPlan,
  addItems,
  canEdit = false,
  onTeach,
  onRemove,
  lookupsHref,
  dayLabel
}: {
  /** 'Oct 25': the Teaching confirm's "to the Oct 25 plan". */
  dayLabel?: string;
  feed: SuggestFeed;
  rows: readonly PlanRow[];
  canSeed: boolean;
  /** The meeting switcher (the next 4 meetings, each staying in this mode). */
  switcher?: ReactNode;
  /** Phone: opens the plan in the Drawer. */
  onOpenPlan: () => void;
  /** The page's batched add: resolves to an error to show, or null. */
  addItems: (items: SuggestItem[]) => Promise<string | null>;
  /** The edit right: a Teaching chip sets a teacher (adding the offering too needs canSeed as well). */
  canEdit?: boolean;
  /** A Teaching chip: this leader teaches this item (added first when it isn't on the plan). An error to show, or null. */
  onTeach?: (item: SuggestItem, personId: number) => Promise<string | null>;
  onRemove: (row: PlanRow, trigger: HTMLElement | null) => void;
  /** Lookups, for a leader who holds the right that page needs (roster.manage); absent otherwise. */
  lookupsHref?: string;
}) {
  // Focus on arrival goes to the view's heading (BuildPlanView); the section is the fallback after an Add.
  const sectionRef = useRef<HTMLElement | null>(null);
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

  /** The Add buttons on screen, in order. */
  const addButtons = () => Array.from(sectionRef.current?.querySelectorAll<HTMLElement>('[data-suggest-add]') ?? []);
  /** Focus the first of these still on screen, else the workspace: never body. */
  const focusFirst = (candidates: HTMLElement[]) =>
    requestAnimationFrame(() => (candidates.find((c) => c.isConnected) ?? sectionRef.current)?.focus());

  const addOne = async (item: SuggestItem, trigger: HTMLElement | null) => {
    const all = addButtons();
    const at = trigger ? all.indexOf(trigger) : -1;
    const next = [...all.slice(at + 1), ...all.slice(0, Math.max(at, 0))].filter((b) => b.dataset.suggestAdd !== item.key);
    const err = await addItems([item]);
    if (!err) {
      setTicked((t) => (t.has(item.key) ? new Set([...t].filter((k) => k !== item.key)) : t));
      focusFirst(next);
    }
    return err;
  };
  const addTicked = async () => {
    if (busy || !pending.length) return;
    setBusy(true);
    setBarProblem(null);
    const err = await addItems(pending.map((k) => byKey.get(k)!));
    setBusy(false);
    if (err) setBarProblem(err);
    else {
      const added = new Set(pending);
      setTicked(new Set());
      focusFirst(addButtons().filter((b) => !added.has(b.dataset.suggestAdd ?? '')));
    }
  };

  const ctl = (item: SuggestItem) => (
    <ItemAction item={item} row={rowByKey.get(item.key)} canSeed={canSeed} onAdd={addOne} onRemove={onRemove} />
  );
  const tick = (item: SuggestItem) =>
    canSeed && !onPlan.has(item.key) ? (
      <input type="checkbox" className={s.tick} checked={ticked.has(item.key)} onChange={() => toggle(item.key)} aria-label={`Select ${item.codeLabel} ${item.title}`} />
    ) : null;

  return (
    <section className={s.workspace} aria-label="Suggestions" ref={sectionRef} tabIndex={-1}>
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
          </span>
        </div>
      </div>

      <div className={s.body}>
        <p className={feed.status === 'loading' ? s.empty : s.srOnly} role="status">
          {feed.status === 'loading' ? 'Finding suggestions…' : ''}
        </p>
        {feed.status === 'failed' ? <p className={s.empty}>Suggestions didn’t load. Reload the page to try again.</p> : null}
        {data && lens === 'sessions' ? <Sessions data={data} filter={filter} onPlan={onPlan} tick={tick} ctl={ctl} /> : null}
        {data && lens === 'scouts' ? <Scouts data={data} filter={filter} onPlan={onPlan} tick={tick} ctl={ctl} /> : null}
        {data && lens === 'teaching' ? <Teaching data={data} filter={filter} rowByKey={rowByKey} byKey={byKey} canSeed={canSeed} canEdit={canEdit} onTeach={onTeach} lookupsHref={lookupsHref} dayLabel={dayLabel} /> : null}
        {data && lens === 'sessions' ? <SoloNeeds data={data} filter={filter} onPlan={onPlan} ctl={ctl} /> : null}
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
              <Button variant="primary" onClick={addTicked} aria-disabled={busy || undefined}>
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
    .filter(({ sc, items }) => scoutRowShown(sc, items.length, filter));
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
          ) : sc.reason ? (
            <p className={s.meta}>{sc.reason}</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function Teaching({
  data,
  filter,
  rowByKey,
  byKey,
  canSeed,
  canEdit,
  onTeach,
  lookupsHref,
  dayLabel
}: {
  dayLabel?: string;
  data: SuggestionsData;
  filter: SuggestFilter;
  rowByKey: ReadonlyMap<string, PlanRow>;
  byKey: ReadonlyMap<string, SuggestItem>;
  canSeed: boolean;
  canEdit: boolean;
  onTeach?: (item: SuggestItem, personId: number) => Promise<string | null>;
  lookupsHref?: string;
}) {
  const onPlan = new Set(rowByKey.keys());
  const rows = data.teachers
    .map((t) => ({ t, keys: teacherKeysShown(t.keys, byKey, onPlan, filter) }))
    .filter(({ keys }) => keys.length || (filter.rank == null && !filter.mbOnly));
  const lookups = lookupsHref ? (
    <p className={s.meta}>
      <Link href={lookupsHref}>Edit in Lookups</Link>
    </p>
  ) : null;
  if (!rows.length)
    return (
      <>
        {lookups}
        <p className={s.empty}>{data.teachers.length ? 'Nothing matches these filters.' : 'Nobody has a teaching skill yet.'}</p>
      </>
    );
  return (
    <>
      {lookups}
      <ul className={s.rows}>
        {rows.map(({ t, keys }) => (
          <li key={t.id} className={s.scout} data-teacher-row>
            <p className={s.who} data-teacher-head tabIndex={-1}>
              {t.name}
              {t.meta ? <span className={s.whoMeta}>{t.scout ? `${t.meta} scout` : t.meta}</span> : null}
            </p>
            <p className={s.meta}>{t.skills.join(' · ')}</p>
            {keys.length ? (
              <ul className={s.chips}>
                {keys.map((k) => (
                  <li key={k}>
                    <TeachChip item={byKey.get(k)!} row={rowByKey.get(k)} teacher={t} canSeed={canSeed} canEdit={canEdit} onTeach={onTeach} dayLabel={dayLabel} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className={s.meta}>No session for them this week</p>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * One requirement in a leader's Teaching row, labelled with its code and short title ("Scout 2 · Flag"; Patrick,
 * 2026-10-22). Not on the plan: the plain chip. On the plan, someone else or nobody teaching: the same chip with a
 * small "on plan" marker. They teach it already: a quiet "teaching" marker and no click. The accessible name keeps the
 * whole action ("Add Scout 2 Flag with Dan K teaching", "Assign Dan K to …"). A click opens a confirm Dialog; nothing
 * is written until its primary ("Add to plan" or "Assign") is pressed, and Cancel or Esc returns focus to the chip.
 * Without the right, or for a non-person teacher (Summer Camp), the chip is plain text: never a dead button.
 */
function TeachChip({
  item,
  row,
  teacher,
  canSeed,
  canEdit,
  onTeach,
  dayLabel
}: {
  item: SuggestItem;
  row: PlanRow | undefined;
  teacher: SuggestionsData['teachers'][number];
  canSeed: boolean;
  canEdit: boolean;
  onTeach?: (item: SuggestItem, personId: number) => Promise<string | null>;
  /** 'Oct 25': the confirm's "to the Oct 25 plan". */
  dayLabel?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const chipRef = useRef<HTMLButtonElement | null>(null);
  const teaching = row != null && (row.teacherIds ? teacher.personId != null && row.teacherIds.includes(teacher.personId) : row.teachers.includes(teacher.name));
  const short = `${item.eagle ? '★ ' : ''}${item.codeLabel} · ${item.title}`;
  if (teaching) {
    return (
      <span className={s.chipOn}>
        {short} <span className={s.chipMark}>teaching</span>
      </span>
    );
  }
  const marker = row ? (
    <>
      {' '}
      <span className={s.chipMark}>on plan</span>
    </>
  ) : null;
  const may = teacher.personId != null && onTeach != null && canEdit && (row != null || canSeed);
  if (!may) {
    return (
      <span className={row ? s.chipOn : s.chip}>
        {short}
        {marker}
      </span>
    );
  }
  const go = async () => {
    // The leader's row, read before the write: a confirmed Assign turns this chip into a "teaching" span (qa-lead B9).
    const rowEl = chipRef.current?.closest<HTMLElement>('[data-teacher-row]') ?? null;
    setBusy(true);
    setProblem(null);
    const err = await onTeach!(item, teacher.personId!);
    setBusy(false);
    setAsking(false);
    if (err) setProblem(err);
    requestAnimationFrame(() => {
      const chip = chipRef.current;
      if (chip?.isConnected) return chip.focus();
      // The chip is gone: the row's next chip, else its heading; never body.
      const next = rowEl?.querySelector<HTMLElement>('button[aria-haspopup="dialog"]');
      (next ?? rowEl?.querySelector<HTMLElement>('[data-teacher-head]'))?.focus();
    });
  };
  const what = `${item.codeLabel} ${item.title}`;
  const plan = dayLabel ? `the ${dayLabel} plan` : 'the plan';
  return (
    <>
      <button
        type="button"
        ref={chipRef}
        className={s.chipBtn}
        onClick={() => {
          if (!busy) setAsking(true);
        }}
        aria-disabled={busy || undefined}
        aria-haspopup="dialog"
        aria-label={row ? `Assign ${teacher.name} to ${what}` : `Add ${what} with ${teacher.name} teaching`}
      >
        {busy ? 'Saving…' : short}
        {busy ? null : marker}
      </button>
      {problem ? (
        <span className={s.problemBox} role="alert">
          {problem}
        </span>
      ) : null}
      {asking ? (
        <ChipConfirm
          question={row ? `Make ${teacher.name} the teacher for ${short}?` : `Add ${short} to ${plan}, with ${teacher.name} teaching?`}
          confirm={row ? 'Assign' : 'Add to plan'}
          busy={busy}
          onConfirm={go}
          onClose={() => {
            setAsking(false);
            requestAnimationFrame(() => chipRef.current?.focus());
          }}
        />
      ) : null}
    </>
  );
}

/** The Teaching chip's confirm: Build a Plan's dialog pattern (native modal, Cancel + one primary). */
function ChipConfirm({ question, confirm, busy, onConfirm, onClose }: { question: string; confirm: string; busy: boolean; onConfirm: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    const dlg = ref.current;
    if (dlg && typeof dlg.showModal === 'function' && !dlg.open) dlg.showModal();
    else dlg?.setAttribute('open', '');
  }, []);
  return (
    <dialog
      ref={ref}
      className={b.confirm}
      aria-labelledby="teach-confirm-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <h2 id="teach-confirm-title" className={b.confirmTitle}>
        {question}
      </h2>
      <div className={b.confirmActions}>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" onClick={onConfirm} disabled={busy}>
          {busy ? 'Saving…' : confirm}
        </Button>
      </div>
    </dialog>
  );
}

/**
 * B9: Group Sessions' "Solo needs", collapsed like the campout footer: each requirement only one scout needs (it never
 * made a session of two), with that scout and the same Add / On plan as everywhere else. Filters apply.
 */
function SoloNeeds({ data, filter, onPlan, ctl }: Pick<LensProps, 'data' | 'filter' | 'onPlan' | 'ctl'>) {
  const shown = soloNeeds(data).filter((n) => cardShown(n.item, onPlan.has(n.item.key), filter));
  if (!shown.length) return null;
  return (
    <details className={s.solo}>
      <summary>Solo needs ({shown.length})</summary>
      <ul className={s.rows}>
        {shown.map((n) => (
          <li key={n.item.key} className={onPlan.has(n.item.key) ? s.itemOn : s.soloRow}>
            <div className={s.itemLine}>
              <p className={s.itemTitle}>
                <span className={s.code}>
                  {n.item.eagle ? '★ ' : ''}
                  {n.item.codeLabel}
                </span>
                {n.item.title}
              </p>
              {ctl(n.item)}
            </div>
            <p className={s.names}>{n.scout}</p>
          </li>
        ))}
      </ul>
    </details>
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
export function ItemAction({
  item,
  row,
  canSeed,
  onAdd,
  onRemove
}: {
  item: SuggestItem;
  row: PlanRow | undefined;
  canSeed: boolean;
  onAdd: (item: SuggestItem, trigger: HTMLElement | null) => Promise<string | null>;
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
  const add = async (trigger: HTMLElement) => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const err = await onAdd(item, trigger);
    setBusy(false);
    if (err) setProblem(err);
  };
  return (
    <span className={s.end}>
      <Button
        variant="secondary"
        size="sm"
        className={s.addBtn}
        onClick={(e) => add(e.currentTarget)}
        aria-disabled={busy || undefined}
        data-suggest-add={item.key}
        aria-label={`Add ${item.codeLabel} ${item.title}`}
      >
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
