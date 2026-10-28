'use client';

/**
 * This week › "What do you want the focus to be?" (Plans/Meeting-Planner-III.md): the Focus set popover (search,
 * label pills, Add / ✓ Added), the picked sets as removable chips, the night's merit badges (from the focus, or added
 * directly with "+ Merit badge"), and "+ Add a focus set", the inline builder. Changing the focus is the planning
 * team's (seed); everyone else sees the chips.
 */
import { useState } from 'react';
import { fmtDate } from '@/lib/format-date';
import type { ThisWeek } from '@/lib/this-week';
import { twAddFocusSetAction, twRemoveFocusAction, twSetNightBadgeAction } from './this-week-actions';
import { Popover, useWrite } from './this-week-parts';
import { FocusBuilder } from './this-week-builder';
import s from './this-week.module.css';

export interface SetChoice {
  id: number;
  name: string;
  labels: string[];
  count: number;
  /** An instant, or null. */
  lastUsed: string | null;
  /** The set's paired badge. */
  mbId: string | null;
}

export function FocusCard({
  entryId,
  view,
  sets,
  badges,
  canSeed
}: {
  entryId: number;
  view: ThisWeek;
  sets: readonly SetChoice[];
  badges: readonly { id: string; name: string }[];
  canSeed: boolean;
}) {
  const w = useWrite();
  const [q, setQ] = useState('');
  const [label, setLabel] = useState<string | null>(null);
  const [bq, setBq] = useState('');
  const [building, setBuilding] = useState(false);
  const picked = new Set(view.focus.map((f) => f.setId));
  const labels = [...new Set(sets.flatMap((x) => x.labels))].sort();
  const term = q.trim().toLowerCase();
  const rows = sets.filter((x) => (!label || x.labels.includes(label)) && (!term || `${x.name} ${x.labels.join(' ')}`.toLowerCase().includes(term)));
  const nightIds = new Set(view.badges.map((b) => b.mbId));
  const bterm = bq.trim().toLowerCase();
  const badgeRows = bterm ? badges.filter((b) => b.name.toLowerCase().includes(bterm) && !nightIds.has(b.id)).slice(0, 20) : [];
  const pairedOffer = sets.filter((x) => picked.has(x.id) && x.mbId && !nightIds.has(x.mbId)).map((x) => ({ set: x.name, mb: badges.find((b) => b.id === x.mbId) })).filter((x) => x.mb);

  return (
    <section className={s.card} aria-labelledby="focus-h">
      <h2 id="focus-h" className={s.cardTitle}>
        What do you want the focus to be?
      </h2>
      <div className={s.row}>
        {canSeed ? (
          <Popover label="Focus set ▾" triggerClass={s.slot} wide ariaLabel="Focus sets">
            {() => (
              <>
                <div className={s.popHead}>
                  <label className={s.fieldLabel}>
                    Find a focus set
                    <input className={s.search} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="First aid, knots, ceremonies…" />
                  </label>
                  {labels.length ? (
                    <div className={s.pills} role="group" aria-label="Labels">
                      {[null, ...labels].map((l) => (
                        <button key={l ?? 'all'} type="button" className={s.pill} aria-pressed={label === l} onClick={() => setLabel(l)}>
                          {l ?? 'All'}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <ul className={s.popList}>
                  {rows.length ? null : <li className={s.popEmpty}>No focus set matches.</li>}
                  {rows.map((x) => {
                    const on = picked.has(x.id);
                    const fKey = `fg:${x.id}`;
                    return (
                      <li key={x.id} className={s.popItem}>
                        <div className={s.popMain}>
                          <div className={s.popName}>{x.name}</div>
                          <div className={s.popMeta}>
                            {[...x.labels, `${x.count} requirement${x.count === 1 ? '' : 's'}`, x.lastUsed ? `Last used ${fmtDate(x.lastUsed, { year: false })}` : 'Not used yet'].join(' · ')}
                          </div>
                        </div>
                        <button
                          type="button"
                          className={s.toggle}
                          aria-pressed={on}
                          disabled={w.busy}
                          onClick={() => w.run(() => (on ? twRemoveFocusAction({ entryId, key: fKey }) : twAddFocusSetAction({ entryId, setId: x.id })))}
                        >
                          {on ? '✓ Added' : 'Add'}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <div className={s.popFoot}>
                  <button type="button" className={s.quiet} onClick={() => setBuilding(true)}>
                    + Add a focus set
                  </button>
                </div>
              </>
            )}
          </Popover>
        ) : null}
        {view.focus.map((f) => (
          <span key={f.key} className={`${s.pick} ${canSeed ? '' : s.pickPlain}`}>
            {f.name}
            {canSeed ? (
              <button type="button" className={s.x} aria-label={`Remove ${f.name}`} disabled={w.busy} onClick={() => w.run(() => twRemoveFocusAction({ entryId, key: f.key }))}>
                ×
              </button>
            ) : null}
          </span>
        ))}
        {view.focus.length ? null : <span className={s.muted}>No focus set picked yet.</span>}
      </div>

      <div className={s.row}>
        <span className={s.rowLabel}>Merit badges tonight</span>
        {view.badges.map((b) => (
          <span key={b.mbId} className={`${s.pickBadge} ${canSeed && b.direct ? '' : s.pickPlain}`}>
            {b.name}
            {canSeed && b.direct ? (
              <button type="button" className={s.x} aria-label={`Remove ${b.name}`} disabled={w.busy} onClick={() => w.run(() => twSetNightBadgeAction({ entryId, mbId: b.mbId, on: false }))}>
                ×
              </button>
            ) : null}
          </span>
        ))}
        {view.badges.length ? null : <span className={s.muted}>None</span>}
        {canSeed ? (
          <Popover label="+ Merit badge" triggerClass={s.quiet} ariaLabel="Add a merit badge">
            {(close) => (
              <>
                <div className={s.popHead}>
                  <label className={s.fieldLabel}>
                    Find a merit badge
                    <input className={s.search} type="search" value={bq} onChange={(e) => setBq(e.target.value)} placeholder="First Aid, Cooking…" />
                  </label>
                </div>
                <ul className={s.popList}>
                  {bterm && !badgeRows.length ? <li className={s.popEmpty}>No merit badge matches.</li> : null}
                  {badgeRows.map((b) => (
                    <li key={b.id}>
                      <button
                        type="button"
                        className={s.menuBtn}
                        onClick={async () => {
                          if (await w.run(() => twSetNightBadgeAction({ entryId, mbId: b.id, on: true }))) {
                            setBq('');
                            close();
                          }
                        }}
                      >
                        {b.name}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Popover>
        ) : null}
        {canSeed
          ? pairedOffer.map((x) => (
              <button key={x.mb!.id} type="button" className={s.quiet} disabled={w.busy} onClick={() => w.run(() => twSetNightBadgeAction({ entryId, mbId: x.mb!.id, on: true }))}>
                + {x.mb!.name} (goes with {x.set})
              </button>
            ))
          : null}
      </div>
      {view.unplaced.length ? <p className={s.muted}>Not in any group tonight: {view.unplaced.join(', ')} (Star, Life and Eagle scouts are in the Merit badge group).</p> : null}
      {w.error ? (
        <p className={s.err} role="alert">
          {w.error}
        </p>
      ) : null}
      {building ? <FocusBuilder entryId={entryId} badges={badges} onDone={() => setBuilding(false)} /> : null}
    </section>
  );
}
