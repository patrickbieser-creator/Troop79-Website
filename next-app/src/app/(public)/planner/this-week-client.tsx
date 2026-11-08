'use client';

/**
 * Meeting Planner III › This week (Plans/Meeting-Planner-III.md; prototypes/meeting-plan-III/This Week.dc.html).
 * Plan view: the focus, the coverage strip, the group cards (column 1) and the scout checklist (columns 2–3). Live at
 * the meeting (Decision 10) is the same plan as session cards (this-week-live.tsx). Everything here is derived from
 * the plan on each load; the writes are this-week-actions.ts, and the page refreshes once a write lands.
 */
import Link from 'next/link';
import { useState, useSyncExternalStore } from 'react';
import { SplitPanel } from './this-week-split';
import { joinNames, type ThisWeek, type TwGroup, type TwResponses, type TwRow, type TwSection } from '@/lib/this-week';
import { checklistKeeps, withoutCantCome, type ChecklistFilter } from '@/lib/this-week-shown';
import { usePlanner } from './planner-client';
import { PlannerPoller } from './planner-poller';
import { twRemoveRequirementAction, twSetRoleAction, twSetTeacherAction, twUnmergeGroupAction, type RoleInput } from './this-week-actions';
import { FocusCard, type SetChoice } from './this-week-focus';
import type { SavedPlan } from '@/lib/saved-plans-shared';
import { LiveView } from './this-week-live';
import { StationsSection, StationsSwitch } from './this-week-stations';
import { NameChip, Popover, ReqItem, StateName, TeacherSlot, useWrite } from './this-week-parts';
import type { PlanState } from '@/lib/plan-states';
import s from './this-week.module.css';

export interface WeekLink {
  entryId: number;
  dayLabel: string;
  /** Has a focus: the button is the date alone; otherwise it says "Not planned yet". */
  planned: boolean;
  current: boolean;
}

const toneOf = (sec: Pick<TwSection, 'kind' | 'key'>) =>
  // A split group wears its rank's tone ('fr:tenderfoot~2' → tone-tenderfoot).
  sec.kind === 'rank' ? s[`tone-${sec.key.slice(3).replace(/~[23]$/, '')}`] : sec.kind === 'badge' || sec.key === 'older' || sec.key === 'teaching' ? s['tone-mb'] : s['tone-extra'];
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** A group card's count, and how many said yes once anyone has (D6: information only; most won't answer at first). */
export const groupCount = (members: readonly { intent: string | null }[]) => {
  const yes = members.filter((m) => m.intent === 'coming').length;
  return `${plural(members.length, 'scout')}${yes ? ` · ${yes} said yes` : ''}`;
};

// "Not now" on a split offer (D1), remembered on this device per meeting; a private window forgets it on reload.
const OFFER_EVENT = 'planner-split-offer';
const offerSub = (cb: () => void) => {
  window.addEventListener('storage', cb);
  window.addEventListener(OFFER_EVENT, cb);
  return () => {
    window.removeEventListener('storage', cb);
    window.removeEventListener(OFFER_EVENT, cb);
  };
};
function useHiddenOffers(entryId: number) {
  const key = `planner.splitOffer.${entryId}`;
  const [session, setSession] = useState<string[]>([]);
  const read = () => {
    try {
      return localStorage.getItem(key) ?? '';
    } catch {
      return '';
    }
  };
  const raw = useSyncExternalStore(offerSub, read, () => '');
  const hidden = new Set([...raw.split(' ').filter(Boolean), ...session]);
  const hide = (base: string) => {
    setSession([...session, base]);
    try {
      localStorage.setItem(key, [...hidden, base].join(' '));
      window.dispatchEvent(new Event(OFFER_EVENT));
    } catch {
      // Private window: set aside for this visit only.
    }
  };
  return { hidden, hide };
}

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
          <div className={s.row}>
            <h1 className={s.cardTitle}>
              {dayLabel} · {focusName}
            </h1>
            <StationsSwitch entryId={entryId} view={view} canSeed={canSeed} />
          </div>
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
  // Who already teaches what tonight, by short name, for the teacher lists ("Scout Group 2, First Aid").
  const teachingElsewhere = new Map<number, { key: string; title: string }[]>();
  for (const slot of [...view.groups, ...view.extras]) {
    for (const t of slot.teachers) teachingElsewhere.set(t.personId, [...(teachingElsewhere.get(t.personId) ?? []), { key: slot.key, title: shortTitle(slot) }]);
  }
  // Split or merge… (D8): the panel's group, the Undo after a merge, and offers set aside on this device (D1).
  const [splitting, setSplitting] = useState<TwGroup | null>(null);
  const [merged, setMerged] = useState<string | null>(null);
  const offers = useHiddenOffers(entryId);

  return (
    <>
      <FocusCard entryId={entryId} view={view} sets={sets} badges={badges} canSeed={canSeed} meetingDate={meetingDate} savedPlans={savedPlans} />

      {view.rotation ? <StationsSection entryId={entryId} rotation={view.rotation} canSeed={canSeed} /> : null}

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

      {splitting ? <SplitPanel entryId={entryId} group={splitting} onClose={() => setSplitting(null)} onMerged={setMerged} /> : null}

      <div className={s.body}>
        <div className={s.col}>
          {view.groups.filter((g) => g.kind === 'rank').map((g) => (
            <section key={g.key} className={s.group} aria-labelledby={`g-${g.key}`}>
              <div className={`${s.groupHead} ${toneOf({ kind: 'rank', key: g.key })}`}>
                <div>
                  <h2 id={`g-${g.key}`} className={s.groupName}>
                    {g.title}
                  </h2>
                  <span className={s.groupSub}>{g.subtitle}</span>
                </div>
                {canSeed ? (
                  <button type="button" className={s.splitBtn} title="Split or merge…" aria-label={`Sp/Mg: split or merge the ${g.name} group`} onClick={() => setSplitting(g)}>
                    Sp/Mg
                  </button>
                ) : null}
                <span className={s.groupCount}>{groupCount(g.members)}</span>
              </div>
              <div className={s.groupBody}>
                {merged === g.base ? (
                  <p className={s.offer} role="status">
                    Merged into one group.
                    <button
                      type="button"
                      className={s.quiet}
                      disabled={w.busy}
                      onClick={async () => {
                        if (await w.run(() => twUnmergeGroupAction({ entryId, group: g.base }))) setMerged(null);
                      }}
                    >
                      Undo
                    </button>
                  </p>
                ) : canSeed && g.offer && !offers.hidden.has(g.base) ? (
                  <p className={s.offer}>
                    <button type="button" className={s.quiet} onClick={() => setSplitting(g)}>
                      Split into 2 groups…
                    </button>
                    <button type="button" className={s.quiet} onClick={() => offers.hide(g.base)}>
                      Not now
                    </button>
                  </p>
                ) : null}
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
                <TeacherSlot slotKey={g.key} title={`the ${g.title}`} teachers={g.teachers} candidates={g.candidates} everyone={view.everyone} onSet={setTeacher} teachingElsewhere={teachingElsewhere} />
                <NeedsTeacher teachers={g.teachers} saidNo={g.saidNo} />
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
                <span className={s.groupCount}>{groupCount(g.members)}</span>
              </div>
              <div className={s.groupBody}>
                <div className={s.chips}>
                  {g.members.map((m) => (
                    <NameChip key={m.personId} person={m} tone="rsvp" />
                  ))}
                  {g.members.length ? null : <span className={s.muted}>Nobody taking it yet.</span>}
                </div>
                <TeacherSlot slotKey={g.key} title={`${g.name}`} teachers={g.teachers} candidates={g.candidates} everyone={view.everyone} onSet={setTeacher} teachingElsewhere={teachingElsewhere} />
                <NeedsTeacher teachers={g.teachers} saidNo={g.saidNo} />
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
                  <TeacherSlot slotKey={x.key} title={x.title} teachers={x.teachers} candidates={x.candidates} everyone={view.everyone} onSet={setTeacher} teachingElsewhere={teachingElsewhere} />
                  {canSeed && x.origin === 'planner' ? (
                    <button type="button" className={s.quiet} disabled={w.busy} onClick={() => w.run(() => twRemoveRequirementAction({ entryId, key: x.key }))}>
                      Remove from tonight
                    </button>
                  ) : null}
                </div>
                <NeedsTeacher teachers={x.teachers} saidNo={x.saidNo} />
              </div>
            </section>
          ))}
        </div>

        <div className={s.col}>
          <Checklist view={full} filter={filter} setFilter={setFilter} onRole={setRole} busy={w.busy} />
          <AdultsCard view={view} />
          <ResponsesCard responses={view.responses} />
        </div>
      </div>
    </>
  );
}

/** A group's or class's name where space is tight: a badge without "merit badge" ('First Aid'). */
/** A group's or class's name where space is tight: a badge as 'First Aid MB' (Patrick, 2026-10-31). */
const shortTitle = (slot: { title: string; kind?: string; name?: string }) => (slot.kind === 'badge' && slot.name ? `${slot.name} MB` : slot.title);

/**
 * Adults teaching tonight (Patrick, 2026-10-31): each adult once, their name as a chip like the scouts' (an outline of
 * its own, so it never reads as a rank) and every group or class they teach, by short name, in the order the cards
 * stand on the screen. Then each card nobody teaches yet: a "No teachers yet" chip in that card's colours, which takes
 * you to the card. Junior Leaders are scouts: they're in the checklist.
 */
export function AdultsCard({ view }: { view: Pick<ThisWeek, 'groups' | 'extras'> }) {
  const slots = [
    ...view.groups.map((g) => ({ key: g.key, id: `g-${g.key}`, title: shortTitle(g), tone: toneOf({ kind: g.kind, key: g.key }), teachers: g.teachers })),
    ...view.extras.map((x) => ({ key: x.key, id: `x-${x.key}`, title: x.title, tone: toneOf({ kind: 'none', key: x.key }), teachers: x.teachers }))
  ];
  const by = new Map<number, { name: string; first: number; slots: { title: string; state?: PlanState }[] }>();
  slots.forEach((slot, i) => {
    for (const t of slot.teachers) {
      if (t.kind !== 'adult') continue;
      const a = by.get(t.personId) ?? { name: t.name, first: i, slots: [] };
      a.slots.push({ title: slot.title, state: t.state });
      by.set(t.personId, a);
    }
  });
  const adults = [...by.entries()].sort((x, y) => x[1].first - y[1].first || x[1].name.localeCompare(y[1].name));
  const open = slots.filter((x) => !x.teachers.length);
  const chip = (id: number, name: string) => <AdultChip personId={id} name={name} />;
  return (
    <section className={s.gridCard} aria-labelledby="adults-h">
      <div className={s.toolbar}>
        <h2 id="adults-h" className={s.cardTitle}>
          Adults <span className={s.muted}>{adults.length}</span>
        </h2>
      </div>
      {adults.length || open.length ? (
        <ul className={s.adultList}>
          {adults.map(([id, a]) => (
            <li key={id} className={s.adultRow}>
              {chip(id, a.name)}
              <span className={s.adultTeaches}>
                {a.slots.map((x, j) => (
                  <span key={j}>
                    {j ? ', ' : null}
                    <StateName name={x.title} state={x.state} />
                  </span>
                ))}
              </span>
            </li>
          ))}
          {open.map((x) => (
            <li key={x.key} className={s.adultRow}>
              <button
                type="button"
                className={`${s.chip} ${s.noTeacherChip} ${x.tone}`}
                aria-label={`No teachers yet for ${x.title}: go to its card`}
                onClick={() => document.getElementById(x.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
              >
                No teachers yet
              </button>
              <span className={s.adultTeaches}>{x.title}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={s.muted}>Nothing planned yet.</p>
      )}
    </section>
  );
}

/** An adult's name chip: an outline of its own (never read as a rank); editors open the person drawer. */
function AdultChip({ personId, name }: { personId: number; name: string }) {
  const p = usePlanner();
  return p?.canEdit ? (
    <button type="button" className={`${s.chip} ${s.adultChip}`} aria-label={`${name}, adult`} onClick={() => p.openPerson(personId)}>
      {name}
    </button>
  ) : (
    <span className={`${s.chip} ${s.adultChip}`} aria-label={`${name}, adult`}>
      {name}
    </span>
  );
}

const RESPONSE_GROUPS = [
  ['coming', 'Coming'],
  ['undecided', 'Not sure'],
  ['not_coming', 'Can’t come']
] as const;

/**
 * Responses this week (Patrick, 2026-11-01): everyone who has answered, scouts and adults, coming on top, not sure in
 * the middle, can't come at the bottom. Scouts first in each (their rank chips), then adults; an empty answer is left out.
 */
export function ResponsesCard({ responses }: { responses: TwResponses }) {
  const groups = RESPONSE_GROUPS.map(([k, label]) => ({ k, label, ...responses[k], n: responses[k].scouts.length + responses[k].adults.length })).filter((g) => g.n);
  return (
    <section className={s.gridCard} aria-labelledby="responses-h">
      <div className={s.toolbar}>
        <h2 id="responses-h" className={s.cardTitle}>
          Responses this week <span className={s.muted}>{groups.reduce((t, g) => t + g.n, 0)}</span>
        </h2>
      </div>
      {groups.length ? (
        groups.map((g) => (
          <div key={g.k} role="group" aria-label={g.label} className={s.respGroup}>
            <h3 className={s.respHead}>
              {g.label} <span className={s.muted}>{g.n}</span>
            </h3>
            <div className={s.chips}>
              {g.scouts.map((x) => (
                <NameChip key={x.personId} person={x} tone="rank" />
              ))}
              {g.adults.map((x) => (
                <AdultChip key={x.personId} personId={x.personId} name={x.name} />
              ))}
            </div>
          </div>
        ))
      ) : (
        <p className={s.muted}>No answers yet.</p>
      )}
    </section>
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
            <h3 className={s.sectionName}>{sec.title}</h3>
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
          {row.status === 'unassigned' ? null : (
            <button type="button" className={s.menuBtn} disabled={busy} onClick={pick({ role: 'none' }, close)}>
              Unassigned
            </button>
          )}
          {groups.map((g) => (
            <button key={g.key} type="button" className={s.menuBtn} disabled={busy} onClick={pick({ role: 'group', key: g.key }, close)}>
              Move to {g.kind === 'badge' ? g.title : `the ${g.title}`}
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
/** Confirmations C-D2: a card a No emptied says it needs a teacher, and who said no (with their note). */
export function NeedsTeacher({ teachers, saidNo }: { teachers: readonly unknown[]; saidNo: readonly { personId: number; name: string; note: string | null }[] }) {
  if (teachers.length || !saidNo.length) return null;
  return (
    <p className={s.needsTeacher} role="status">
      Needs a teacher ·{' '}
      {saidNo.map((n, i) => (
        <span key={n.personId}>
          {i ? '; ' : null}
          {n.name} said no{n.note ? `: “${n.note}”` : ''}
        </span>
      ))}
    </p>
  );
}

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

