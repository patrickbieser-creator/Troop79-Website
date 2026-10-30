'use client';

/**
 * Meeting Planner III › This week (Plans/Meeting-Planner-III.md; prototypes/meeting-plan-III/This Week.dc.html).
 * Plan view: the focus, the coverage strip, the group cards (column 1) and the scout checklist (columns 2–3). Live at
 * the meeting (Decision 10) is the same plan as session cards (this-week-live.tsx). Everything here is derived from
 * the plan on each load; the writes are this-week-actions.ts, and the page refreshes once a write lands.
 */
import Link from 'next/link';
import { useState } from 'react';
import { joinNames, type ThisWeek, type TwRow, type TwSection } from '@/lib/this-week';
import { checklistKeeps, withoutCantCome, type ChecklistFilter } from '@/lib/this-week-shown';
import { usePlanner } from './planner-client';
import { PlannerPoller } from './planner-poller';
import { twRemoveRequirementAction, twSetRoleAction, twSetTeacherAction, type RoleInput } from './this-week-actions';
import { FocusCard, type SetChoice } from './this-week-focus';
import type { SavedPlan } from '@/lib/saved-plans-shared';
import { LiveView } from './this-week-live';
import { NameChip, Popover, ReqItem, TeacherSlot, useWrite } from './this-week-parts';
import s from './this-week.module.css';

export interface WeekLink {
  entryId: number;
  dayLabel: string;
  /** Has a focus: the button is the date alone; otherwise it says "Not planned yet". */
  planned: boolean;
  current: boolean;
}

const toneOf = (sec: Pick<TwSection, 'kind' | 'key'>) =>
  sec.kind === 'rank' ? s[`tone-${sec.key.slice(3)}`] : sec.kind === 'badge' || sec.key === 'older' ? s['tone-mb'] : s['tone-extra'];
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function ThisWeekView({
  entryId,
  dayLabel,
  title,
  weeks,
  view,
  sets,
  badges,
  stamp,
  canSeed,
  isToday,
  live,
  meetingDate,
  savedPlans
}: {
  entryId: number;
  dayLabel: string;
  title: string;
  weeks: readonly WeekLink[];
  view: ThisWeek;
  sets: readonly SetChoice[];
  badges: readonly { id: string; name: string }[];
  stamp: string;
  canSeed: boolean;
  isToday: boolean;
  live: { present: number[] };
  /** 'YYYY-MM-DD'. */
  meetingDate: string;
  /** Saved meeting plans: seed holders only. */
  savedPlans: readonly SavedPlan[];
}) {
  const [mode, setMode] = useState<'plan' | 'live'>(isToday ? 'live' : 'plan');
  const focusName = [...view.focus.map((f) => f.name), ...view.badges.filter((b) => b.direct).map((b) => b.name)].join(' + ') || 'No focus yet';
  return (
    <>
      <header className={s.wrap}>
        <div>
          <p className={s.muted}>Meeting Planner · This week</p>
          <h1 className={s.cardTitle}>
            {dayLabel} · {focusName}
          </h1>
          <p className={s.cardSub}>{title}</p>
          <div className={s.headRow}>
            <div className={s.seg} role="radiogroup" aria-label="View">
              {(['plan', 'live'] as const).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={mode === m} className={s.segBtn} onClick={() => setMode(m)}>
                  {m === 'plan' ? 'Plan' : 'Live at the meeting'}
                </button>
              ))}
            </div>
            <Link href="/planner/calendar" className={s.week}>
              Theme calendar
            </Link>
            <span className={s.weeksLabel}>Coming weeks</span>
            <ul className={s.weeks}>
              {weeks.map((w) => (
                <li key={w.entryId}>
                  <Link href={`/planner?meeting=${w.entryId}`} className={w.current ? s.weekOn : s.week} aria-current={w.current ? 'page' : undefined}>
                    <span className={s.weekDate}>{w.dayLabel}</span>
                    {w.planned ? null : ' · Not planned yet'}
                  </Link>
                </li>
              ))}
            </ul>
            <PlannerPoller entryId={entryId} stamp={stamp} />
          </div>
        </div>
      </header>
      <div className={s.wrap}>
        {mode === 'plan' ? <PlanView entryId={entryId} view={view} sets={sets} badges={badges} canSeed={canSeed} meetingDate={meetingDate} savedPlans={savedPlans} /> : <LiveView entryId={entryId} view={view} isToday={isToday} present={live.present} />}
      </div>
    </>
  );
}

function PlanView({
  entryId,
  view: full,
  sets,
  badges,
  canSeed,
  meetingDate,
  savedPlans
}: {
  entryId: number;
  view: ThisWeek;
  sets: readonly SetChoice[];
  badges: readonly { id: string; name: string }[];
  canSeed: boolean;
  meetingDate: string;
  savedPlans: readonly SavedPlan[];
}) {
  const p = usePlanner();
  const w = useWrite();
  const [filter, setFilter] = useState<ChecklistFilter>('all');
  // A scout who can't come is off every card; the checklist's "Can't come" pill still lists them (lib/this-week-shown).
  const view = withoutCantCome(full);
  const setTeacher = (key: string, personId: number | null, on: boolean) => w.run(() => twSetTeacherAction({ entryId, key, personId, on }));
  const setRole = (personId: number, role: RoleInput) => w.run(() => twSetRoleAction({ entryId, personId, ...role }));
  const { coverage: c, answers: a } = view;
  const badgeGroups = view.groups.filter((g) => g.kind === 'badge');

  return (
    <>
      <FocusCard entryId={entryId} view={view} sets={sets} badges={badges} canSeed={canSeed} meetingDate={meetingDate} savedPlans={savedPlans} />

      <section className={s.coverage} aria-label="Coverage">
        <div className={s.covMain}>
          <span className={s.covNum}>
            Rank work: {c.rankWork} of {c.counted} · {c.pct}%
          </span>
          <svg className={s.covBar} viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
            <rect className={s.covTrack} x="0" y="0" width="100" height="10" rx="5" />
            <rect className={s.covFill} x="0" y="0" width={c.pct} height="10" rx="5" />
          </svg>
        </div>
        <button type="button" className={`${s.covStat} ${c.nothing ? s.covWarn : ''}`} aria-pressed={filter === 'gaps'} onClick={() => setFilter(filter === 'gaps' ? 'all' : 'gaps')}>
          {c.nothing} with nothing assigned
        </button>
        <span className={`${s.covStat} ${c.groupsWithoutTeacher ? s.covWarn : ''}`}>{plural(c.groupsWithoutTeacher, 'group')} without a teacher</span>
        <div className={s.answers}>
          <span>
            Scouts: <strong>{a.scouts.coming}</strong> coming · <strong>{a.scouts.undecided}</strong> not sure · <strong>{a.scouts.notComing}</strong> can’t ·{' '}
            <strong>{a.scouts.none}</strong> no answer
          </span>
          <span>
            Adults: <strong>{a.adults.coming}</strong> coming · <strong>{a.adults.undecided}</strong> not sure · <strong>{a.adults.notComing}</strong> can’t
          </span>
        </div>
        {w.error ? (
          <p className={s.err} role="alert">
            {w.error}
          </p>
        ) : null}
      </section>

      <div className={s.body}>
        <div className={s.col}>
          {view.groups.filter((g) => g.kind === 'rank').map((g) => (
            <section key={g.key} className={s.group} aria-labelledby={`g-${g.key}`}>
              <div className={`${s.groupHead} ${toneOf({ kind: 'rank', key: g.key })}`}>
                <div>
                  <h2 id={`g-${g.key}`} className={s.groupName}>
                    {g.name} group
                  </h2>
                  <span className={s.groupSub}>{g.subtitle}</span>
                </div>
                <span className={s.groupCount}>{plural(g.members.length, 'scout')}</span>
              </div>
              <div className={s.groupBody}>
                <ul className={s.reqs}>
                  {g.columns.map((col) => (
                    <ReqItem key={col.key} col={col} />
                  ))}
                </ul>
                <div className={s.chips}>
                  {g.members.map((m) => (
                    <NameChip key={m.personId} person={m} tone="rsvp" />
                  ))}
                  {g.members.length ? null : <span className={s.muted}>Nobody needs these tonight.</span>}
                </div>
                <TeacherSlot slotKey={g.key} title={`the ${g.name} group`} teachers={g.teachers} candidates={g.candidates} everyone={view.everyone} onSet={setTeacher} />
                <DeclineNotes notes={g.declineNotes} />
              </div>
            </section>
          ))}

          {view.older.length ? (
            <section className={s.group} aria-labelledby="g-older">
              <div className={`${s.groupHead} ${s['tone-mb']}`}>
                <div>
                  <h2 id="g-older" className={s.groupName}>
                    Merit badge group
                  </h2>
                  <span className={s.groupSub}>First Class and up: teach, or take a merit badge</span>
                </div>
                <span className={s.groupCount}>{plural(view.older.length, 'scout')}</span>
              </div>
              <div className={s.groupBody}>
                <ul className={s.olderList}>
                  {view.older.map((o) => (
                    <li key={o.personId} className={s.olderRow}>
                      <NameChip person={o} tone="rsvp" />
                      <div className={s.seg} role="radiogroup" aria-label={`${o.name}: teach or a merit badge`}>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={o.role === 'teach'}
                          className={s.segBtn}
                          disabled={!p?.canEdit || w.busy}
                          onClick={() => setRole(o.personId, { role: 'teach' })}
                        >
                          Teach
                        </button>
                        {badgeGroups.map((b) => (
                          <button
                            key={b.key}
                            type="button"
                            role="radio"
                            aria-checked={o.role === 'badge' && o.badgeKey === b.key}
                            className={s.segBtn}
                            disabled={!p?.canEdit || w.busy}
                            onClick={() => setRole(o.personId, { role: 'group', key: b.key })}
                          >
                            {b.name}
                          </button>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
                {badgeGroups.length ? null : <p className={s.muted}>No merit badge tonight: add one above, or they help teach.</p>}
              </div>
            </section>
          ) : null}

          {badgeGroups.map((g) => (
            <section key={g.key} className={s.group} aria-labelledby={`g-${g.key}`}>
              <div className={`${s.groupHead} ${s['tone-mb']}`}>
                <div>
                  <h2 id={`g-${g.key}`} className={s.groupName}>
                    {g.name} merit badge
                  </h2>
                  <span className={s.groupSub}>{g.columns.map((col) => col.code).join(', ')}</span>
                </div>
                <span className={s.groupCount}>{plural(g.members.length, 'scout')}</span>
              </div>
              <div className={s.groupBody}>
                <div className={s.chips}>
                  {g.members.map((m) => (
                    <NameChip key={m.personId} person={m} tone="rsvp" />
                  ))}
                  {g.members.length ? null : <span className={s.muted}>Nobody taking it yet.</span>}
                </div>
                <TeacherSlot slotKey={g.key} title={`${g.name}`} teachers={g.teachers} candidates={g.candidates} everyone={view.everyone} onSet={setTeacher} />
                <DeclineNotes notes={g.declineNotes} />
              </div>
            </section>
          ))}

          {view.helpers.length ? (
            <section className={s.group} aria-labelledby="g-help">
              <div className={`${s.groupHead} ${s['tone-mb']}`}>
                <h2 id="g-help" className={s.groupName}>
                  Helping teach
                </h2>
                <span className={s.groupCount}>{plural(view.helpers.length, 'scout')}</span>
              </div>
              <div className={s.groupBody}>
                <div className={s.chips}>
                  {view.helpers.map((m) => (
                    <NameChip key={m.personId} person={m} tone="rsvp" />
                  ))}
                </div>
              </div>
            </section>
          ) : null}

          {view.extras.map((x) => (
            <section key={x.key} className={s.group} aria-labelledby={`x-${x.key}`}>
              <div className={`${s.groupHead} ${s['tone-extra']}`}>
                <div>
                  <h2 id={`x-${x.key}`} className={s.groupName}>
                    {x.title}
                  </h2>
                  <span className={s.groupSub}>
                    From requests and offers{x.codeLabel ? ` · ${x.codeLabel}` : ''} · {x.origin === 'offered' ? 'teacher offered' : x.origin === 'planner' ? 'added by a planner' : 'scouts asked'}
                  </span>
                  {x.offerNotes.map((n, i) => (
                    <span key={i} className={s.groupSub}>
                      {n.name}: &ldquo;{n.note}&rdquo;
                    </span>
                  ))}
                </div>
                <span className={s.groupCount}>{plural(x.scouts.length, 'scout')}</span>
              </div>
              <div className={s.groupBody}>
                <div className={s.chips}>
                  {x.scouts.map((m) => (
                    <NameChip key={m.personId} person={m} tone="rsvp" />
                  ))}
                  {x.scouts.length ? null : <span className={s.muted}>Nobody signed up yet.</span>}
                </div>
                <div className={s.row}>
                  <TeacherSlot slotKey={x.key} title={x.title} teachers={x.teachers} candidates={x.candidates} everyone={view.everyone} onSet={setTeacher} />
                  {canSeed && x.origin === 'planner' ? (
                    <button type="button" className={s.quiet} disabled={w.busy} onClick={() => w.run(() => twRemoveRequirementAction({ entryId, key: x.key }))}>
                      Remove from tonight
                    </button>
                  ) : null}
                </div>
              </div>
            </section>
          ))}
        </div>

        <Checklist view={full} filter={filter} setFilter={setFilter} onRole={setRole} busy={w.busy} />
      </div>
    </>
  );
}

function Checklist({
  view,
  filter,
  setFilter,
  onRole,
  busy
}: {
  view: ThisWeek;
  filter: ChecklistFilter;
  setFilter: (f: ChecklistFilter) => void;
  onRole: (personId: number, role: RoleInput) => Promise<boolean>;
  busy: boolean;
}) {
  const [legend, setLegend] = useState(false);
  const rows = view.sections.flatMap((sec) => sec.rows);
  const count = (f: ChecklistFilter) => rows.filter((r) => checklistKeeps(f, r)).length;
  const filters: { k: ChecklistFilter; label: string }[] = [
    { k: 'all', label: 'Everyone' },
    { k: 'gaps', label: `Nothing assigned · ${count('gaps')}` },
    { k: 'noanswer', label: `No answer · ${count('noanswer')}` },
    { k: 'cant', label: `Can’t come · ${count('cant')}` }
  ];
  const sections = view.sections
    .map((sec) => ({ ...sec, rows: sec.rows.filter((r) => checklistKeeps(filter, r)), gaps: sec.rows.filter((r) => checklistKeeps('gaps', r)).length }))
    .filter((sec) => sec.rows.length);
  return (
    <section className={s.gridCard} aria-labelledby="grid-h">
      <div className={s.toolbar}>
        <h2 id="grid-h" className={s.cardTitle}>
          Scout checklist
        </h2>
        <div className={s.row}>
          <div className={s.pills} role="group" aria-label="Show">
            {filters.map((f) => (
              <button key={f.k} type="button" className={s.pill} aria-pressed={filter === f.k} onClick={() => setFilter(f.k)}>
                {f.label}
              </button>
            ))}
          </div>
          <button type="button" className={s.quiet} aria-expanded={legend} onClick={() => setLegend(!legend)}>
            {legend ? 'Hide legend' : 'Legend'}
          </button>
        </div>
      </div>
      {legend ? (
        <div className={s.legend}>
          <span className={s.legendItem}>Names wear the rank the scout holds:</span>
          {[
            ['new', 'New scout'],
            ['scout', 'Scout'],
            ['tenderfoot', 'Tenderfoot'],
            ['second-class', 'Second Class'],
            ['first-class', 'First Class'],
            ['star', 'Star'],
            ['life', 'Life'],
            ['eagle', 'Eagle']
          ].map(([id, name]) => (
            <span key={id} className={`${s.chip} ${s[`rank-${id}`]}`}>
              {name}
            </span>
          ))}
          <span className={s.legendItem}>
            <span className={s.check} aria-hidden="true" />
            still to do (could work on it tonight)
          </span>
          <span className={s.legendItem}>
            <span className={s.checkDone} aria-hidden="true" />
            already done
          </span>
          <span className={s.legendItem}>
            <span className={s.checkPart} aria-hidden="true" />
            partly done (merit badge)
          </span>
          <span className={s.legendItem}>
            <span className={s.legendGap} aria-hidden="true" />
            nothing assigned yet
          </span>
        </div>
      ) : null}
      {sections.length ? null : <p className={s.muted}>{filter === 'gaps' ? 'Every scout has something tonight.' : filter === 'cant' ? 'Nobody has said they can’t come.' : 'Nobody here.'}</p>}
      {sections.map((sec) => (
        <div key={sec.key} className={s.section}>
          <div className={`${s.sectionHead} ${toneOf(sec)}`}>
            <h3 className={s.sectionName}>{sec.kind === 'badge' ? `${sec.name} merit badge` : sec.kind === 'rank' ? `${sec.name} group` : sec.name}</h3>
            <span className={s.sectionSub}>
              {plural(sec.rows.length, 'scout')}
              {sec.gaps ? ` · ${sec.gaps} with nothing assigned` : ''}
            </span>
          </div>
          <div className={s.scroll}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th scope="col" className={s.nameCol}>
                    Scout
                  </th>
                  {sec.columns.map((col) => (
                    <th key={col.key} scope="col" className={s.cell} title={`${col.code}: ${col.label}`}>
                      {col.code}
                    </th>
                  ))}
                  <th scope="col" className={s.noteCol}>
                    Tonight
                  </th>
                </tr>
              </thead>
              <tbody>
                {sec.rows.map((r) => (
                  <tr key={r.personId} className={r.gap ? s.gapRow : undefined}>
                    <td className={s.nameCol}>
                      <NameChip person={r} tone="rank" />
                    </td>
                    {sec.columns.map((col) => {
                      // White = still to do (could work on it tonight); green = already done; half green = a badge
                      // requirement partly done. The same reading as the library's advancement views.
                      const mark = (sec.key === r.groupKey ? r.marks : sec.key === r.homeKey ? r.homeMarks : {})[col.key];
                      const [cls, said] = mark === 'open' ? [s.check, 'still to do'] : mark === 'part' ? [s.checkPart, 'partly done'] : [s.checkDone, 'already done'];
                      return (
                        <td key={col.key} className={s.cell}>
                          <span className={cls} role="img" aria-label={`${col.code}: ${said}`} />
                        </td>
                      );
                    })}
                    <td className={s.noteCol}>
                      <div className={s.noteCell}>
                        <span className={r.gap ? s.gapNote : undefined}>{r.note}</span>
                        <FamilyFlags row={r} />
                        <PlaceMenu row={r} view={view} onRole={onRole} busy={busy} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </section>
  );
}

/** A row's place menu (Decision 2): a gap gets "Place…", a hand-placed scout "Change". Editors only. */
function PlaceMenu({ row, view, onRole, busy }: { row: TwRow; view: ThisWeek; onRole: (personId: number, role: RoleInput) => Promise<boolean>; busy: boolean }) {
  const p = usePlanner();
  if (!p?.canEdit || !(row.gap || row.hand)) return null;
  const groups = view.groups.filter((g) => g.key !== row.groupKey);
  const pick = (role: RoleInput, close: () => void) => async () => {
    if (await onRole(row.personId, role)) close();
  };
  return (
    <Popover label={row.gap ? 'Place…' : 'Change'} triggerClass={row.gap ? s.placeBtn : s.quiet} right ariaLabel={`Place ${row.name}`}>
      {(close) => (
        <>
          {view.extras.length ? <div className={s.menuHead}>From requests and offers</div> : null}
          {view.extras.map((x) => (
            <button key={x.key} type="button" className={s.menuBtn} disabled={busy} aria-current={row.requestKey === x.key ? 'true' : undefined} onClick={pick({ role: 'request', key: x.key }, close)}>
              {x.title}
              <span className={s.menuNote}>{[x.codeLabel, x.teachers.length ? joinNames(x.teachers.map((t) => t.name)) : 'no teachers yet'].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
          <div className={s.menuHead}>Or</div>
          <button type="button" className={s.menuBtn} disabled={busy} onClick={pick({ role: 'teach' }, close)}>
            Help teach
          </button>
          {groups.map((g) => (
            <button key={g.key} type="button" className={s.menuBtn} disabled={busy} onClick={pick({ role: 'group', key: g.key }, close)}>
              Move to {g.kind === 'badge' ? `${g.name} merit badge` : `the ${g.name} group`}
            </button>
          ))}
          {row.hand ? (
            <div className={s.popFoot}>
              <button type="button" className={s.quiet} disabled={busy} onClick={pick({ role: null }, close)}>
                Let placement decide
              </button>
            </div>
          ) : null}
        </>
      )}
    </Popover>
  );
}

/** What a family changed or suggested (Emails E2): a flag for the planners on the scout's row. Suggestions never place
 *  anyone; a planner who takes one up places the scout with the usual tools. */
export function FamilyFlags({ row }: { row: TwRow }) {
  if (!row.familyUnticked.length && !row.familySuggestions.length) return null;
  return (
    <span className={s.familyFlags}>
      {row.familyUnticked.length ? <span className={s.familyFlag}>Family took off {row.familyUnticked.join(', ')}</span> : null}
      {row.familySuggestions.length ? <span className={s.familyFlag}>Family suggests: {row.familySuggestions.join(' · ')}</span> : null}
    </span>
  );
}

/** Notes from people who said "Not this week" to teaching a group. */
export function DeclineNotes({ notes }: { notes: readonly { name: string; note: string }[] }) {
  if (!notes.length) return null;
  return (
    <ul className={s.declineNotes} aria-label="Notes from people who can’t teach this week">
      {notes.map((n, i) => (
        <li key={i}>
          <strong>{n.name}</strong> can&rsquo;t this week: &ldquo;{n.note}&rdquo;
        </li>
      ))}
    </ul>
  );
}

