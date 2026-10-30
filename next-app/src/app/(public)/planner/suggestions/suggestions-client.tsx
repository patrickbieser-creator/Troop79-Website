'use client';

/**
 * Suggestions (prototypes/meeting-plan-III/README.md, "Screen: Suggestions"; prototype Suggestions.dc.html): three
 * views over ONE engine read (lib/planner-suggest), all client state after the page loads.
 *
 *   Toolbar (sticky)   For: the next meetings · View: Group sessions · By scout · Teaching · group pills in the rank
 *                      colours · Only this week's focus · Show what's on the plan. With anything ticked, a second bar:
 *                      "N ticked · Add N to the {date} plan · Save as a focus set… (an inline name, never a modal) ·
 *                      Clear". Ticks carry across views, per meeting.
 *   Group sessions     a section per III group, a card per requirement two or more scouts need, most-needed first;
 *                      Solo needs collapsed below.
 *   By scout           every active scout, their group and patrol, and up to three tick chips; one with none says why.
 *   Teaching           a row per teacher; each chip opens an inline confirm: add it with them teaching, or make them
 *                      its teacher (a focus requirement's teacher is its group's).
 *   Needs another      collapsed on every view, by class; never added.
 *   setting
 *
 * Seed holders get ticks, Add and Save as a focus set; a Teaching chip needs Edit (and Seed when it adds). Viewers read
 * it with no controls. After a write the page refreshes, so what is on each plan reloads; the engine read is cached.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  addChunks,
  campoutShown,
  DEFAULT_FILTER,
  GROUPS,
  groupLabel,
  itemShown,
  itemsByKey,
  LENS_LABEL,
  onPlanOf,
  scoutItemsShown,
  scoutRowShown,
  sessionGroups,
  settingItems,
  soloNeeds,
  teacherKeysShown,
  teacherTarget,
  type Lens,
  type PlanState,
  type SuggestFilter,
  type SuggestItem,
  type SuggestionsData,
  type SuggestPerson
} from '@/lib/planner-suggest';
import { suggestAddAction } from './actions';
import { twSetTeacherAction } from '../this-week-actions';
import { focusSaveSetAction } from '../focus-actions';
import s from './suggestions.module.css';

export interface SuggestMeeting extends PlanState {
  entryId: number;
  /** 'Sun, Nov 1'. */
  label: string;
  /** 'Nov 1'. */
  short: string;
  focusNames: string[];
  teachers: Record<string, number[]>;
}

const LENSES: Lens[] = ['sessions', 'scouts', 'teaching'];
const PILLS: { id: string | null; label: string }[] = [{ id: null, label: 'All' }, ...GROUPS.map((g) => ({ id: g.id, label: g.id === 'mb' ? 'Merit badges' : g.label }))];
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const firstName = (name: string) => name.split(' ')[0];

/** A rank-coloured name chip (the rank they hold; New scout when none). */
function Chip({ p }: { p: SuggestPerson }) {
  return (
    <span className={`${s.chip} ${s[`rank-${p.rankId ?? 'new'}`] ?? ''}`} title={p.rankLabel}>
      {p.name}
    </span>
  );
}

export function SuggestionsView({ data, meetings, canSeed, canEdit, lookupsHref }: { data: SuggestionsData; meetings: SuggestMeeting[]; canSeed: boolean; canEdit: boolean; lookupsHref?: string }) {
  const router = useRouter();
  const [at, setAt] = useState(meetings[0].entryId);
  const [lens, setLens] = useState<Lens>('sessions');
  const [filter, setFilter] = useState<SuggestFilter>(DEFAULT_FILTER);
  const [ticks, setTicks] = useState<Record<number, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [setName, setSetName] = useState('');
  const [confirm, setConfirm] = useState<{ teacher: string; key: string } | null>(null);

  const meeting = meetings.find((m) => m.entryId === at) ?? meetings[0];
  const plan: PlanState = meeting;
  const byKey = useMemo(() => itemsByKey(data), [data]);
  const ticked = (ticks[at] ?? []).filter((k) => byKey.has(k) && !onPlanOf(k, plan));
  const isTicked = (key: string) => ticked.includes(key);
  const toggle = (key: string) => setTicks((t) => ({ ...t, [at]: (t[at] ?? []).includes(key) ? (t[at] ?? []).filter((k) => k !== key) : [...(t[at] ?? []), key] }));
  const set = (patch: Partial<SuggestFilter>) => setFilter((f) => ({ ...f, ...patch }));
  const focusName = meeting.focusNames.join(' + ') || 'none yet';

  /** Add, one action per ADD_MAX keys; says where they went (`quiet`: the Teaching confirm says it once the teacher is
   *  set too). */
  const add = async (items: SuggestItem[], quiet = false): Promise<boolean> => {
    if (!items.length || busy) return false;
    setBusy(true);
    setProblem(null);
    setFlash(null);
    try {
      for (const chunk of addChunks(items.map((i) => i.key))) {
        const res = await suggestAddAction({ entryId: meeting.entryId, keys: chunk });
        if (!res.ok) {
          setProblem(res.error);
          return false;
        }
      }
      const groups = [...new Set(items.map((i) => groupLabel(i.group).replace(/ group$/, '')))];
      if (!quiet)
        setFlash(`✓ Added ${plural(items.length, 'requirement')} to the ${meeting.label} plan: ${groups.join(', ')} ${groups.length === 1 ? 'group' : 'groups'}. The checklist and Live update right away.`);
      const done = new Set(items.map((i) => i.key));
      setTicks((t) => ({ ...t, [at]: (t[at] ?? []).filter((k) => !done.has(k)) }));
      router.refresh();
      return true;
    } catch {
      setProblem('That didn’t save. Check your connection and try again.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveSet = async () => {
    if (!setName.trim() || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const res = await focusSaveSetAction({ id: null, name: setName.trim(), labels: [], items: ticked });
      if (!res.ok) {
        setProblem(res.error);
        return;
      }
      setFlash(`✓ Saved “${setName.trim()}” as a focus set with ${plural(ticked.length, 'requirement')}.`);
      setNaming(false);
      setSetName('');
      setTicks((t) => ({ ...t, [at]: [] }));
    } catch {
      setProblem('That didn’t save. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  /** Teaching's confirm: add it first when it isn't on the plan, then set the teacher. If the add lands and the
   *  teacher doesn't, it says so, and the confirm stays open to try again (the add isn't repeated). */
  const teach = async (item: SuggestItem, personId: number, name: string) => {
    const target = teacherTarget(item, plan);
    if (target.add && !(await add([item], true))) return;
    const added = target.add ? `${item.codeLabel} is on the ${meeting.label} plan, but ` : '';
    setBusy(true);
    try {
      const res = await twSetTeacherAction({ entryId: meeting.entryId, key: target.key, personId, on: true });
      if (!res.ok) setProblem(`${added}${added ? `${name} isn’t its teacher yet: ` : ''}${res.error}`);
      else {
        setConfirm(null);
        setFlash(`✓ ${target.add ? `Added ${item.codeLabel} to the ${meeting.label} plan (${groupLabel(item.group)}), with ${name} teaching.` : `${name} is teaching ${item.codeLabel} on ${meeting.short}.`}`);
        router.refresh();
      }
    } catch {
      setProblem(`${added}${added ? `${name} isn’t its teacher yet. ` : ''}That didn’t save. Check your connection and try again.`);
    } finally {
      setBusy(false);
    }
  };

  const onPlanLine = (item: SuggestItem) => (
    <span className={s.onPlan}>
      ✓ On {meeting.short} plan · {groupLabel(item.group)}
    </span>
  );

  // ── Group sessions ──────────────────────────────────────────────────────────────────────────────────────────
  const groups = sessionGroups(data, plan, filter);
  const solo = soloNeeds(data).filter((n) => itemShown(n.item, plan, filter));
  const sessions = (
    <div className={s.stack}>
      <p className={s.hint}>Requirements that two or more scouts in the same group need, most-needed first. Each card names the scouts, the best teacher and the other qualified ones.</p>
      {groups.map((g) => (
        <section key={g.id} aria-labelledby={`sg-${g.id}`}>
          <div className={s.groupHead}>
            <h2 id={`sg-${g.id}`} className={`${s.groupName} ${s[`tone-${g.id}`] ?? ''}`}>
              {g.label}
            </h2>
            <span className={s.meta}>
              {plural(g.cards.length, 'shared need')}
            </span>
          </div>
          <div className={s.cards}>
            {g.cards.map((c) => {
              const op = onPlanOf(c.key, plan);
              return (
                <article key={c.key} className={op ? `${s.card} ${s.cardOn}` : s.card}>
                  <div className={s.cardTop}>
                    {canSeed && !op ? <input type="checkbox" className={s.tick} checked={isTicked(c.key)} onChange={() => toggle(c.key)} aria-label={`Tick ${c.codeLabel}`} /> : null}
                    <div className={s.grow}>
                      <div className={s.tags}>
                        <span className={s.code}>{c.codeLabel}</span>
                        {plan.focus.includes(c.key) ? <span className={s.tagFocus}>In this week&rsquo;s focus</span> : null}
                        {c.eagle ? <span className={s.tagEagle}>Eagle required</span> : null}
                      </div>
                      <h3 className={s.cardTitle}>{c.title}</h3>
                    </div>
                    <span className={s.need}>{c.need} need it</span>
                  </div>
                  <div className={s.chips}>
                    {c.scouts.map((p, i) => (
                      <Chip key={`${p.name}-${i}`} p={p} />
                    ))}
                  </div>
                  <p className={s.teachers}>
                    <strong>{c.kind === 'mb' ? 'Counselor:' : 'Best teacher:'}</strong> {c.best ? `${c.best.name}${c.best.note ? ` (${c.best.note})` : ''}` : c.kind === 'mb' ? 'No counselor on file' : 'No one with this skill yet'}
                    {c.others.length ? (
                      <>
                        <br />
                        <span className={s.meta}>Also: {c.others.map((o) => `${o.name}${o.note ? ` (${o.note})` : ''}`).join(', ')}</span>
                      </>
                    ) : null}
                  </p>
                  <div className={s.cardFoot}>
                    {op ? onPlanLine(c) : null}
                    {canSeed && !op ? (
                      <button type="button" className={s.addBtn} disabled={busy} onClick={() => void add([c])}>
                        + Add to {meeting.short}
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
      {groups.length ? null : <p className={s.empty}>No shared needs match these filters.</p>}
      <details className={s.fold}>
        <summary>
          {`Solo needs · ${plural(solo.length, 'thing')} only one scout needs`}
        </summary>
        <div className={s.foldBody}>
          {solo.map((n) => {
            const op = onPlanOf(n.item.key, plan);
            return (
              <div key={n.item.key} className={s.soloRow}>
                {canSeed ? <input type="checkbox" className={s.tick} checked={op || isTicked(n.item.key)} disabled={op} onChange={() => toggle(n.item.key)} aria-label={`Tick ${n.item.codeLabel} for ${n.scout.name}`} /> : <span />}
                <span className={s.code}>{n.item.codeLabel}</span>
                <span className={s.soloTitle}>{n.item.title}</span>
                <span>
                  <Chip p={n.scout} />
                </span>
                <span className={op ? s.onPlanText : s.meta}>{op ? `✓ On ${meeting.short} plan` : groupLabel(n.item.group)}</span>
              </div>
            );
          })}
          {solo.length ? null : <p className={s.meta}>Nothing here under these filters.</p>}
        </div>
      </details>
    </div>
  );

  // ── By scout ────────────────────────────────────────────────────────────────────────────────────────────────
  const rows = data.scouts
    .map((sc) => ({ sc, items: scoutItemsShown(sc.items, plan, filter) }))
    .filter(({ sc, items }) => scoutRowShown(sc, items.length, filter));
  const scouts = (
    <section className={s.panel}>
      <p className={s.panelHint}>Every active scout and their next three things, shared needs first. Older scouts get merit badge requirements. A scout with nothing says why.</p>
      <div className={s.scroll}>
        {rows.map(({ sc, items }) => (
          <div key={sc.id} className={s.scoutRow}>
            <span>
              <Chip p={sc} />
            </span>
            <span className={s.meta}>
              {groupLabel(sc.group)}
              {sc.patrol ? ` · ${sc.patrol}` : ''}
            </span>
            <div className={s.chips}>
              {items.map((i) => {
                const op = onPlanOf(i.key, plan);
                const need = data.cards.find((c) => c.key === i.key)?.need ?? 1;
                return (
                  <label key={i.key} className={op ? `${s.item} ${s.itemOn}` : isTicked(i.key) ? `${s.item} ${s.itemTicked}` : s.item}>
                    {canSeed ? <input type="checkbox" checked={op || isTicked(i.key)} disabled={op} onChange={() => toggle(i.key)} aria-label={`Tick ${i.codeLabel} for ${sc.name}`} /> : null}
                    <strong className={s.code}>{i.codeLabel}</strong> {i.title}
                    <span className={s.meta}>{op ? ' · ✓ on plan' : ` · ${need} need it`}</span>
                  </label>
                );
              })}
              {sc.items.length ? null : <span className={s.why}>{sc.reason ?? 'Nothing to suggest'}</span>}
            </div>
          </div>
        ))}
        {rows.length ? null : <p className={s.empty}>No scouts match these filters.</p>}
      </div>
    </section>
  );

  // ── Teaching ────────────────────────────────────────────────────────────────────────────────────────────────
  const teaching = (
    <section className={s.panel}>
      <div className={s.panelHint}>
        <span>Who can teach what this week, best fit first.{canEdit ? ' Click a requirement to put it on the plan with that person teaching.' : ''}</span>
        {lookupsHref ? (
          <Link href={lookupsHref} className={s.lookups}>
            Edit teaching skills in Lookups
          </Link>
        ) : null}
      </div>
      {data.teachers.map((t) => {
        const keys = teacherKeysShown(t.keys, byKey, plan, filter);
        const open = confirm?.teacher === t.id ? byKey.get(confirm.key) : undefined;
        const openOn = open ? onPlanOf(open.key, plan) : false;
        return (
          <div key={t.id} className={s.teachRow}>
            <div>
              <div className={s.teachName}>{t.name}</div>
              {t.meta ? <div className={s.meta}>{t.meta}</div> : null}
              {t.skills.length ? <div className={s.skills}>{t.skills.join(', ')}</div> : null}
            </div>
            <div className={s.stackTight}>
              <div className={s.chips}>
                {keys.map((k) => {
                  const item = byKey.get(k)!;
                  const op = onPlanOf(k, plan);
                  const mine = t.personId != null && (meeting.teachers[teacherTarget(item, plan).key] ?? []).includes(t.personId);
                  const need = data.cards.find((c) => c.key === k)?.need ?? 1;
                  const can = t.personId != null && canEdit && (op || canSeed) && !mine;
                  // One span: the chip is a flex box, which would drop the spaces between separate text nodes.
                  const label = (
                    <span>
                      <strong>{item.codeLabel}</strong>
                      {` · ${need}${mine ? ' · ✓ teaching' : op ? ' · on plan' : ''}`}
                    </span>
                  );
                  const cls = mine ? `${s.teachChip} ${s.teachMine}` : op ? `${s.teachChip} ${s.teachOn}` : s.teachChip;
                  return can ? (
                    <button key={k} type="button" className={cls} aria-expanded={confirm?.teacher === t.id && confirm.key === k} onClick={() => setConfirm(confirm?.teacher === t.id && confirm.key === k ? null : { teacher: t.id, key: k })}>
                      {label}
                    </button>
                  ) : (
                    <span key={k} className={cls}>
                      {label}
                    </span>
                  );
                })}
                {keys.length ? null : <span className={s.meta}>Nothing scouts need right now matches these skills.</span>}
              </div>
              {open && t.personId != null ? (
                <div className={s.confirm}>
                  <span className={s.grow}>
                    {openOn
                      ? `${open.codeLabel} ${open.title} is on the ${meeting.short} plan. Make ${t.name} its teacher?`
                      : `Add ${open.codeLabel} ${open.title} to the ${meeting.short} plan (${groupLabel(open.group)}), with ${t.name} teaching?`}
                  </span>
                  <button type="button" className={s.primary} disabled={busy} onClick={() => void teach(open, t.personId!, t.name)}>
                    {openOn ? `Make ${firstName(t.name)} the teacher` : `Add with ${firstName(t.name)} teaching`}
                  </button>
                  <button type="button" className={s.secondary} onClick={() => setConfirm(null)}>
                    Cancel
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </section>
  );

  // ── Needs another setting ───────────────────────────────────────────────────────────────────────────────────
  const elsewhere = data.campout.filter((c) => campoutShown(c, filter));
  const settings = data.settings.map((st) => ({ ...st, items: settingItems(elsewhere, st.code) })).filter((st) => st.items.length);

  return (
    <div className={s.wrap}>
      <div className={s.toolbar}>
        <div className={s.toolRow}>
          <div className={s.toolGroup}>
            <span className={s.toolLabel} id="sg-for">
              For
            </span>
            <span role="group" aria-labelledby="sg-for" className={s.seg}>
              {meetings.map((m) => (
                <button
                  key={m.entryId}
                  type="button"
                  aria-pressed={m.entryId === at}
                  className={m.entryId === at ? `${s.segBtn} ${s.segOn}` : s.segBtn}
                  onClick={() => {
                    setAt(m.entryId);
                    setConfirm(null);
                    setFlash(null);
                    setNaming(false);
                  }}
                >
                  {m.label}
                </button>
              ))}
            </span>
          </div>
          <div role="tablist" aria-label="View" className={s.lenses}>
            {LENSES.map((l) => (
              <button
                key={l}
                type="button"
                role="tab"
                aria-selected={lens === l}
                className={lens === l ? `${s.lens} ${s.lensOn}` : s.lens}
                onClick={() => {
                  setLens(l);
                  setConfirm(null);
                }}
              >
                {LENS_LABEL[l]}
              </button>
            ))}
          </div>
          <div role="group" aria-label="Group" className={s.pills}>
            {PILLS.map((p) => (
              <button key={p.label} type="button" aria-pressed={filter.group === p.id} className={`${s.pill} ${filter.group === p.id ? s.pillOn : ''} ${p.id ? (s[`pill-${p.id}`] ?? '') : ''}`} onClick={() => set({ group: p.id })}>
                {p.label}
              </button>
            ))}
          </div>
          <label className={s.toggle}>
            <input type="checkbox" checked={filter.focusOnly} onChange={() => set({ focusOnly: !filter.focusOnly })} />
            Only this week&rsquo;s focus ({focusName})
          </label>
          <label className={s.toggle}>
            <input type="checkbox" checked={filter.showOnPlan} onChange={() => set({ showOnPlan: !filter.showOnPlan })} />
            Show what&rsquo;s on the plan
          </label>
        </div>
        {canSeed && ticked.length ? (
          <div className={s.tickBar}>
            <div className={s.toolRow}>
              <span className={s.tickCount}>{ticked.length} ticked</span>
              <button type="button" className={s.primary} disabled={busy} onClick={() => void add(ticked.map((k) => byKey.get(k)!))}>
                Add {ticked.length} to the {meeting.label} plan
              </button>
              <button type="button" className={s.secondaryGreen} disabled={busy} aria-expanded={naming} onClick={() => setNaming((n) => !n)}>
                Save as a focus set…
              </button>
              <button type="button" className={s.linkBtn} onClick={() => setTicks((t) => ({ ...t, [at]: [] }))}>
                Clear
              </button>
              {naming ? (
                <form
                  className={s.nameForm}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveSet();
                  }}
                >
                  <input className={s.nameInput} value={setName} onChange={(e) => setSetName(e.target.value)} aria-label="Focus set name" placeholder="Name, e.g. Knots for new scouts" maxLength={80} autoFocus />
                  <button type="submit" className={s.saveGreen} disabled={busy || !setName.trim()}>
                    Save
                  </button>
                </form>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <main className={s.main}>
        {flash ? (
          <div role="status" className={s.flash}>
            {flash}{' '}
            <Link href={`/planner?meeting=${meeting.entryId}`}>Open This week</Link>
          </div>
        ) : null}
        {problem ? (
          <p role="alert" className={s.problem}>
            {problem}
          </p>
        ) : null}
        {lens === 'sessions' ? sessions : lens === 'scouts' ? scouts : teaching}
        <details className={s.fold}>
          <summary>
            {`Needs another setting · ${plural(elsewhere.length, 'requirement')} a meeting can’t cover`}
          </summary>
          <div className={s.foldBody}>
            <p className={s.meta}>For campouts, the pool and outings. Listed so they&rsquo;re not forgotten. These can&rsquo;t be added to a meeting.</p>
            {settings.map((st) => (
              <div key={st.code || 'other'} className={s.setting}>
                <div className={s.settingHead}>
                  {st.name} · {st.items.length}
                </div>
                {st.items.map((i) => (
                  <div key={`${i.codeLabel}|${i.title}`} className={s.settingRow}>
                    <span className={s.code}>{i.codeLabel}</span>
                    <span>
                      <span className={s.soloTitle}>{i.title}</span> <span className={s.meta}>· {i.scouts.join(', ')}</span>
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </details>
      </main>
    </div>
  );
}
