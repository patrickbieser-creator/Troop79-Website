'use client';

/**
 * Station rotations on This week (Plans/Planner-Station-Rotations.md; prototypes/station-rotations/this-week.html):
 * the Groups | Stations switch, the station order, the rotation grid and each rotation group's checklist. Teachers stay
 * put at a station all evening; Group 1..N come to them, one round each. Step 3 is read-only apart from the switch and
 * the order; moving scouts between groups and naming station teachers come with step 4.
 */
import type { ThisWeek } from '@/lib/this-week';
import type { TwRotation, TwRotationGroup, TwRotationStation } from '@/lib/this-week-rotation';
import { twOrderStationsAction, twSetStationsAction } from './this-week-actions';
import { NameChip, useWrite } from './this-week-parts';
import s from './this-week.module.css';
import st from './this-week-stations.module.css';

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** The title line's Groups | Stations switch. Planning team only; it shows only once the night has a focus set. */
export function StationsSwitch({ entryId, view, canSeed }: { entryId: number; view: ThisWeek; canSeed: boolean }) {
  const w = useWrite();
  const on = !!view.rotation?.on;
  if (!canSeed || (!view.focus.length && !view.rotation?.stations.length)) return null;
  return (
    <>
      <div className={s.seg} role="radiogroup" aria-label="Meeting shape">
        {([false, true] as const).map((v) => (
          <button
            key={String(v)}
            type="button"
            role="radio"
            aria-checked={on === v}
            className={s.segBtn}
            disabled={w.busy}
            onClick={() => (on === v ? undefined : w.run(() => twSetStationsAction({ entryId, on: v })))}
          >
            {v ? 'Stations' : 'Groups'}
          </button>
        ))}
      </div>
      {w.error ? (
        <span className={s.err} role="alert">
          {w.error}
        </span>
      ) : null}
    </>
  );
}

/** The Stations section: shown while the switch is on. */
export function StationsSection({ entryId, rotation, canSeed }: { entryId: number; rotation: TwRotation; canSeed: boolean }) {
  if (!rotation.on) return null;
  return (
    <section className={st.wrap} aria-labelledby="stations-h">
      <div className={st.head}>
        <h2 id="stations-h" className={s.cardTitle}>
          Stations
        </h2>
        <span className={s.muted}>Teachers stay put. Groups come to them.</span>
      </div>
      {rotation.problem === 'empty' ? (
        <p className={st.problem} role="status">
          No stations yet. Add a focus set above and it becomes a station.
        </p>
      ) : rotation.problem === 'mixed' ? (
        <p className={st.problem} role="status">
          Every station has to come from one merit badge. Take off the focus sets from another badge, or switch back to Groups.
        </p>
      ) : null}
      <div className={st.top}>
        <StationOrder entryId={entryId} rotation={rotation} canSeed={canSeed} />
        {rotation.problem ? null : <RotationGrid rotation={rotation} />}
      </div>
      {rotation.problem ? null : rotation.groups.map((g) => <GroupChecklist key={g.number} group={g} stations={rotation.stations} />)}
    </section>
  );
}

function StationOrder({ entryId, rotation, canSeed }: { entryId: number; rotation: TwRotation; canSeed: boolean }) {
  const w = useWrite();
  const keys = rotation.stations.map((x) => x.key);
  const move = (i: number, by: -1 | 1) => {
    const next = [...keys];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    return w.run(() => twOrderStationsAction({ entryId, keys: next }));
  };
  // Who could help where: a scout who has finished a station rotates with the group and is a hint for its teacher.
  const helpers = new Map<string, string[]>();
  for (const g of rotation.groups) for (const m of g.members) for (const k of m.helperAt) helpers.set(k, [...(helpers.get(k) ?? []), m.name]);
  return (
    <div className={s.card}>
      <h3 className={st.cardHead}>Station order</h3>
      <ol className={st.list}>
        {rotation.stations.map((x, i) => (
          <li key={x.key} className={st.station}>
            <span className={st.num} aria-hidden="true">
              {i + 1}
            </span>
            <div className={st.stMain}>
              <div className={st.stTitle}>{x.title}</div>
              <div className={s.muted}>
                {x.cells.length ? `${plural(x.cells.length, 'requirement')} · ` : ''}
                {x.goalMinutes ? `${x.goalMinutes} min` : 'No time goal yet'}
              </div>
              <div className={st.teachers}>
                {x.teachers.length ? (
                  x.teachers.map((t) => (
                    <span key={t.personId} className={s.chip}>
                      {t.name}
                    </span>
                  ))
                ) : (
                  <span className={s.muted}>No teacher yet</span>
                )}
              </div>
              {helpers.get(x.key)?.length ? <div className={s.muted}>Could help: {helpers.get(x.key)!.join(', ')}</div> : null}
            </div>
            {canSeed ? (
              <div className={st.moves}>
                <button type="button" className={st.mv} aria-label={`Move ${x.title} up`} disabled={w.busy || i === 0} onClick={() => move(i, -1)}>
                  ↑
                </button>
                <button type="button" className={st.mv} aria-label={`Move ${x.title} down`} disabled={w.busy || i === keys.length - 1} onClick={() => move(i, 1)}>
                  ↓
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ol>
      {w.error ? (
        <p className={s.err} role="alert">
          {w.error}
        </p>
      ) : null}
    </div>
  );
}

function RotationGrid({ rotation }: { rotation: TwRotation }) {
  const { stations, groups, rounds, roundMinutes, totalMinutes } = rotation;
  const stationCell = (i: number | undefined) =>
    i === undefined ? (
      <span className={s.muted}>Empty</span>
    ) : (
      <span className={st.slot}>
        <span className={st.numSm} aria-hidden="true">
          {i + 1}
        </span>
        {stations[i].title}
      </span>
    );
  // Stations no group visits in a round (fewer groups than stations).
  const idle = (r: number) => stations.map((_, i) => i).filter((i) => !rounds[r].includes(i));
  return (
    <div className={`${s.card} ${st.rotCard}`}>
      <h3 className={st.cardHead}>Rotation</h3>
      {groups.length ? (
        <>
          <table className={st.grid}>
            <thead>
              <tr>
                <th scope="col">
                  <span className={st.srOnly}>Round</span>
                </th>
                {groups.map((g) => (
                  <th key={g.number} scope="col">
                    <span className={st.gName}>{g.name}</span> · {g.members.length}
                    <div className={st.gSub}>{g.seededFrom}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rounds.map((row, r) => (
                <tr key={r}>
                  <th scope="row">
                    Round {r + 1}
                    {roundMinutes ? <div className={st.gSub}>{roundMinutes} min</div> : null}
                  </th>
                  {groups.map((g, gi) => (
                    <td key={g.number}>{stationCell(row[gi])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {/* On a phone the grid stacks one block per group (Patrick, 2026-11-08). */}
          <div className={st.stack}>
            {groups.map((g, gi) => (
              <div key={g.number} className={st.stackBlock}>
                <div>
                  <span className={st.gName}>{g.name}</span> · {g.members.length} <span className={st.gSub}>{g.seededFrom}</span>
                </div>
                <ol className={st.stackList}>
                  {rounds.map((row, r) => (
                    <li key={r}>
                      Round {r + 1}: {stationCell(row[gi])}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
            {rounds.some((_, r) => idle(r).length) ? <p className={s.muted}>Some stations sit empty in a round: there are fewer groups than stations.</p> : null}
          </div>
          <p className={st.total}>
            {totalMinutes ? (
              <>
                <strong>{totalMinutes} min total</strong> <span className={s.muted}>{`${plural(rounds.length, 'round')} × ${roundMinutes} min`}</span>
              </>
            ) : (
              <span className={s.muted}>No time goal yet</span>
            )}
          </p>
        </>
      ) : (
        <p className={s.muted}>Everyone already has this badge.</p>
      )}
    </div>
  );
}

function GroupChecklist({ group, stations }: { group: TwRotationGroup; stations: readonly TwRotationStation[] }) {
  const title = (k: string) => stations.find((x) => x.key === k)?.title ?? k;
  return (
    <section className={`${s.section} ${st.groupCard}`} aria-labelledby={`rg-${group.number}`}>
      <div className={st.groupHead}>
        <h3 id={`rg-${group.number}`} className={s.sectionName}>
          {group.name}
        </h3>
        <span className={st.gSub}>{group.seededFrom}</span>
        <span className={st.count}>{plural(group.members.length, 'scout')}</span>
      </div>
      <div className={s.scroll}>
        <table className={s.table}>
          <thead>
            <tr>
              <th scope="col" className={s.nameCol} rowSpan={2}>
                Scout
              </th>
              {stations.map((x, i) => (
                <th key={x.key} scope="colgroup" colSpan={Math.max(1, x.cells.length)} className={st.stationHead}>
                  <span className={st.numSm} aria-hidden="true">
                    {i + 1}
                  </span>
                  {x.title}
                </th>
              ))}
              <th scope="col" className={s.noteCol} rowSpan={2}>
                <span className={st.srOnly}>Notes</span>
              </th>
            </tr>
            <tr>
              {stations.flatMap((x) =>
                x.cells.map((c) => (
                  <th key={c.key} scope="col" className={s.cell} title={`${c.code}: ${c.label}`}>
                    {c.code}
                  </th>
                ))
              )}
            </tr>
          </thead>
          <tbody>
            {group.members.map((m) => {
              const done = new Set(m.done);
              return (
                <tr key={m.personId}>
                  <td className={s.nameCol}>
                    <NameChip person={{ ...m, intent: null }} tone="rank" />
                  </td>
                  {stations.flatMap((x) =>
                    x.cells.map((c) => (
                      <td key={c.key} className={s.cell}>
                        <span className={done.has(c.key) ? s.checkDone : s.check} role="img" aria-label={`${c.code}: ${done.has(c.key) ? 'already done' : 'still to do'}`} />
                      </td>
                    ))
                  )}
                  <td className={s.noteCol}>
                    {m.helperAt.length ? <span className={st.helpTag}>Could help · {m.helperAt.map(title).join(', ')}</span> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
