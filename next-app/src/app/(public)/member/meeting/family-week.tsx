'use client';

/**
 * This week for a family (Plans/Meeting-Planner-III-Family.md; prototypes/meeting-plan-III/Family.dc.html): the plan
 * is already set, so each scout's card shows it, one line per item with its minutes, then the same three answers on
 * every card: This plan looks good · Change my plan · Can't make it this week. "Change my plan" opens the edit area in
 * the card: untick a planned item (applies at once), or request something (a flag for the planners). A request joins
 * the checklist, ticked and tagged Requested; unticking it withdraws it. The plan holds at most PLAN_MAX things and
 * PLAN_MAX_MIN minutes; anything that won't fit is disabled and says why. Every tap saves; there is no Send button. A
 * household of two or more gets "All of these plans look good". Shared by /member/meeting (signed in) and
 * /i/plan/<token> (the email's link); the caller passes the write.
 *
 * The email's buttons arrive as `initialAnswer` (once, then the URL drops it): "Yes" answers every unanswered card;
 * "Pick something else" (and an older email's "I'd like to teach") opens the edit area; "Not this week" only
 * preselects, and waits for a tap, so a mail scanner that runs the page can never take a scout off the plan.
 */
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { FamilyOp, FamilyOption, FamilyScout, FamilyWeek, FamilyWrite } from '@/lib/family-week';
import { HELP_KEY, PLAN_MAX, PLAN_MAX_MIN, optionLine, planLoad, withMinutes, type FamilyChoice } from '@/lib/family-week-shared';
import styles from './family-week.module.css';

type Write = (scoutId: number, op: FamilyOp) => Promise<FamilyWrite>;
type Answer = 'ok' | 'change' | 'out';

/** An older email's 'mb' reads as the plan looks good; its 'help' as change my plan. */
const asAnswer = (c: FamilyChoice | null): Answer | null => (c == null ? null : c === 'mb' ? 'ok' : c === 'help' ? 'change' : c);

function choicesFor(s: FamilyScout): { k: Answer; label: string; sub: string }[] {
  const first = s.firstName;
  return [
    {
      k: 'ok',
      label: 'This plan looks good',
      sub: s.kind === 'done' ? `A leader will pick something good for ${first}` : `We’ll plan on ${first} in the ${s.kind === 'mb' ? 'Merit badge' : (s.group?.name ?? '')} group`
    },
    { k: 'change', label: 'Change my plan', sub: s.kind === 'done' ? 'Request helping teach, a merit badge, or something else' : 'Untick something, or request something else' },
    { k: 'out', label: 'Can’t make it this week', sub: `We’ll take ${first} off Sunday’s plan` }
  ];
}

export function FamilyWeekView({
  week,
  write,
  readOnly = false,
  initialAnswer = null,
  lede = null
}: {
  week: FamilyWeek;
  write: Write;
  readOnly?: boolean;
  initialAnswer?: FamilyChoice | null;
  /** The page's opening line (lib/family-week-shared familyLede); none on a page that writes its own. */
  lede?: string | null;
}) {
  const [answers, setAnswers] = useState<Record<number, Answer | null>>(() => Object.fromEntries(week.scouts.map((s) => [s.personId, asAnswer(s.choice)])));
  const first = asAnswer(initialAnswer);
  const [pending, setPending] = useState<Answer | null>(first && first !== 'ok' ? first : null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const applied = useRef(false);

  const [unsure, setUnsure] = useState<Record<number, boolean>>(() => Object.fromEntries(week.scouts.map((s) => [s.personId, s.intent === 'undecided'])));
  // "Not sure yet": the undo for a nervous tap. The card goes back to no answer (saved as undecided); edits stay.
  const clear = async (s: FamilyScout) => {
    const prev = answers[s.personId] ?? null;
    setAnswers((a) => ({ ...a, [s.personId]: null }));
    setUnsure((u) => ({ ...u, [s.personId]: true }));
    try {
      const res = await write(s.personId, { op: 'unsure' });
      if (res.ok) return;
      setError(res.error);
    } catch {
      setError('That didn’t save. Check your connection and try again.');
    }
    setAnswers((a) => ({ ...a, [s.personId]: prev }));
    setUnsure((u) => ({ ...u, [s.personId]: false }));
  };

  const answer = async (s: FamilyScout, k: Answer): Promise<boolean> => {
    const prev = answers[s.personId] ?? null;
    setAnswers((a) => ({ ...a, [s.personId]: k }));
    setUnsure((u) => ({ ...u, [s.personId]: false }));
    try {
      const res = await write(s.personId, { op: 'answer', choice: k });
      if (res.ok) return true;
      setError(res.error);
    } catch {
      setError('That didn’t save. Check your connection and try again.');
    }
    setAnswers((a) => ({ ...a, [s.personId]: prev }));
    return false;
  };

  // The email's button, once: "Yes" answers every unanswered card; then the URL forgets it, so a reload can't
  // re-apply an old answer over a later change.
  useEffect(() => {
    if (applied.current || !initialAnswer) return;
    applied.current = true;
    if (!readOnly && first === 'ok') {
      // After the effect (a write is a server round trip anyway), so the page's first render settles first.
      void Promise.resolve().then(() => {
        for (const s of week.scouts) if (s.choice == null) void answer(s, 'ok');
      });
    }
    router.replace(pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = week.scouts.filter((s) => answers[s.personId] == null);
  const allSet = async () => {
    setError(null);
    for (const s of open) await answer(s, 'ok');
  };

  return (
    <div className={styles.wrap}>
      {lede ? <p className={styles.lede}>{lede}</p> : null}
      {week.scouts.length > 1 && open.length > 0 && !readOnly ? (
        <button type="button" className={styles.allSet} onClick={() => void allSet()}>
          <span className={styles.allSetMain}>✓ All of these plans look good</span>
          <span className={styles.allSetSub}>Answers for {week.scouts.map((s) => s.firstName).join(' and ')} in one tap. You can still change any card below.</span>
        </button>
      ) : null}
      {week.scouts.length > 0 && open.length === 0 ? (
        <p className={styles.allDone} role="status">
          ✓ You&rsquo;re all set for Sunday. You can change an answer here any time before the meeting.
        </p>
      ) : null}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {week.scouts.map((s) => (
        <ScoutCard
          key={s.personId}
          scout={s}
          choice={answers[s.personId] ?? null}
          unsure={!!unsure[s.personId]}
          onUnsure={() => {
            setPending(null);
            setError(null);
            void clear(s);
          }}
          pending={pending}
          onChoose={(k) => {
            setPending(null);
            setError(null);
            void answer(s, k);
          }}
          write={write}
          readOnly={readOnly}
        />
      ))}
    </div>
  );
}

function ScoutCard({
  scout,
  choice,
  unsure,
  onUnsure,
  pending,
  onChoose,
  write,
  readOnly
}: {
  scout: FamilyScout;
  choice: Answer | null;
  unsure: boolean;
  onUnsure: () => void;
  pending: Answer | null;
  onChoose: (k: Answer) => void;
  write: Write;
  readOnly: boolean;
}) {
  const first = scout.firstName;
  const helpOption = scout.also.find((o) => o.key === HELP_KEY) ?? null;
  const [off, setOff] = useState<Set<string>>(() => new Set(scout.items.filter((i) => !i.on).map((i) => i.key)));
  const [requested, setRequested] = useState<FamilyOption[]>(scout.suggestions);
  const [helping, setHelping] = useState(scout.helping);
  const [editing, setEditing] = useState(pending === 'change');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const changes = off.size;
  const requests = requested.length + (helping ? 1 : 0);
  const showEdit = !readOnly && (editing || choice === 'change') && choice !== 'out';

  const items = scout.items.map((i) => ({ ...i, on: !off.has(i.key) }));
  const asked = [...requested, ...(helping && helpOption ? [helpOption] : [])];
  const load = planLoad(items, asked);
  const full = load.things >= PLAN_MAX;
  const minLeft = PLAN_MAX_MIN - load.minutes;
  const fits = (min: number) => !full && min <= minLeft;
  /** What a + Request button says: its verb, or why it can't. */
  const requestMark = (min: number) => (full ? 'Limit reached' : min > minLeft ? `Needs ${min} min · ${Math.max(0, minLeft)} left` : '+ Request');

  const run = async (op: FamilyOp, apply: () => void, undo: () => void) => {
    setBusy(true);
    setError(null);
    apply();
    try {
      const res = await write(scout.personId, op);
      if (!res.ok) {
        undo();
        setError(res.error);
      }
    } catch {
      undo();
      setError('That didn’t save. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };
  const toggleItem = (key: string, on: boolean) => {
    const prev = off;
    const next = new Set(prev);
    if (on) next.delete(key);
    else next.add(key);
    void run({ op: 'item', key, on }, () => setOff(next), () => setOff(prev));
  };
  const toggleRequest = (o: FamilyOption, on: boolean) => {
    if (o.key === HELP_KEY) {
      void run({ op: 'help', on }, () => setHelping(on), () => setHelping(!on));
      return;
    }
    const prev = requested;
    void run({ op: 'suggest', key: o.key, on }, () => setRequested(on ? [...prev, o] : prev.filter((x) => x.key !== o.key)), () => setRequested(prev));
  };
  const choose = (k: Answer) => {
    setEditing(k === 'change');
    onChoose(k);
  };

  const badge =
    choice == null
      ? { text: unsure ? 'Not sure yet' : 'Needs an answer', cls: styles.badgeAsk }
      : choice === 'out'
        ? { text: 'Can’t make it', cls: styles.badgeOut }
        : choice === 'change'
          ? { text: '✓ Changes sent', cls: styles.badgeChanged }
          : { text: '✓ Plan looks good', cls: styles.badgeComing };
  const isAsked = (key: string) => asked.some((x) => x.key === key);
  const alsoOpen = scout.also.filter((o) => !isAsked(o.key));
  const term = q.trim().toLowerCase();
  const found = term ? scout.requestable.filter((r) => !isAsked(r.key) && `${r.codeLabel} ${r.label}`.toLowerCase().includes(term)).slice(0, 5) : [];
  const groupLine = scout.kind === 'mb' ? 'Merit badge group' : scout.group ? `${scout.group.name} group` : '';
  const hid = `fw-${scout.personId}`;
  const qid = `fwq-${scout.personId}`;
  const saved = [changes ? `${changes} ${changes === 1 ? 'change' : 'changes'}` : '', requests ? `${requests} ${requests === 1 ? 'request' : 'requests'}` : ''].filter(Boolean).join(', ');
  const capText = full
    ? `${first}’s plan is full: ${PLAN_MAX} things is the most for one meeting. Untick one to add something else.`
    : minLeft <= 0
      ? `${first}’s plan fills the whole ${PLAN_MAX_MIN}-minute meeting. Untick something to make room.`
      : `${minLeft} min left`;
  const lineOf = (i: { code: string; min: number }) => withMinutes(i.code, i.min);

  return (
    <section className={styles.card} aria-labelledby={hid}>
      <div className={styles.cardHead}>
        <h2 id={hid} className={styles.name}>
          {first}&rsquo;s plan
        </h2>
        {groupLine ? <span className={styles.rankLine}>{groupLine}</span> : null}
        <span className={`${styles.badge} ${badge.cls}`}>{badge.text}</span>
      </div>

      <div className={styles.plan}>
        {!showEdit && choice !== 'out' && (items.some((i) => i.on) || asked.length) ? (
          <ul className={styles.planList}>
            {items
              .filter((i) => i.on)
              .map((i) => (
                <li key={i.key} className={styles.planItem}>
                  <span aria-hidden="true" className={styles.tick}>
                    ✓
                  </span>
                  <span className={styles.itemText}>
                    <span>{i.label}</span>
                    <span className={styles.code}>{lineOf(i)}</span>
                  </span>
                </li>
              ))}
            {asked.map((x) => (
              <li key={x.key} className={styles.planItem}>
                <span aria-hidden="true" className={styles.tick}>
                  ✓
                </span>
                <span className={styles.itemText}>
                  <span>
                    {x.label} <span className={styles.reqTag}>Requested</span>
                  </span>
                  <span className={styles.code}>{optionLine(x)}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {scout.kind === 'done' && !asked.length && choice !== 'out' ? (
          <p className={styles.doneNote}>Nice work: {first} has finished every requirement on offer this week. A leader can pick something good, or you can request something.</p>
        ) : null}
      </div>

      <div className={styles.ask}>
        <div id={qid} className={styles.question}>
          How does {first}&rsquo;s plan look?
        </div>
        <div role="radiogroup" aria-labelledby={qid} className={styles.choices}>
          {choicesFor(scout).map((o) => {
            const on = choice === o.k;
            const waiting = !on && pending === o.k;
            return (
              <button
                key={o.k}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={readOnly || busy}
                className={`${styles.choice} ${on ? (o.k === 'out' ? styles.choiceOut : o.k === 'change' ? styles.choiceChange : styles.choiceOn) : ''} ${waiting ? styles.choicePending : ''}`}
                onClick={() => choose(o.k)}
              >
                <span aria-hidden="true" className={on ? styles.dotOn : styles.dot}>
                  {on ? '✓' : ''}
                </span>
                <span className={styles.choiceText}>
                  <span className={styles.choiceLabel}>{o.label}</span>
                  <span className={styles.choiceSub}>{waiting ? 'Tap to confirm' : o.sub}</span>
                </span>
              </button>
            );
          })}
        </div>
        {choice != null && !readOnly ? (
          <button
            type="button"
            className={styles.unsure}
            disabled={busy}
            onClick={() => {
              setEditing(false);
              onUnsure();
            }}
          >
            Not sure yet? Clear {first}&rsquo;s answer
          </button>
        ) : (
          <p className={styles.notSure}>{unsure ? 'Marked not sure yet. Answer when you know.' : 'Not sure yet? Leave it for now and answer when you know.'}</p>
        )}

        {showEdit ? (
          <div className={styles.edit}>
            <div className={styles.editHead}>
              <span className={styles.editTitle}>Change {first}&rsquo;s plan</span>
              <span role="status" className={styles.saved}>
                {saved ? `✓ Saved · ${saved} sent to the planners` : ''}
              </span>
            </div>
            <div role="status" className={full || minLeft <= 0 ? styles.capFull : styles.cap}>
              <strong>
                {load.things} of {PLAN_MAX} things · {load.minutes} of {PLAN_MAX_MIN} min
              </strong>{' '}
              <span>{capText}</span>
            </div>
            {items.length || asked.length ? (
              <ul className={styles.planList}>
                {items.map((i) => {
                  const locked = !!i.fixed || (!i.on && !fits(i.min));
                  const why = i.fixed ? '' : !i.on && locked ? (full ? ' · untick something to add this back' : ' · too long to fit · untick something to make room') : i.on ? '' : ' · taken off';
                  return (
                    <li key={i.key}>
                      <label className={i.on ? styles.itemOn : styles.item}>
                        <input type="checkbox" checked={i.on} disabled={busy || locked} onChange={(e) => toggleItem(i.key, e.target.checked)} />
                        <span className={styles.itemText}>
                          <span className={styles.itemLabel}>{i.label}</span>
                          <span className={styles.code}>
                            {lineOf(i)}
                            {why}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
                {asked.map((x) => (
                  <li key={x.key}>
                    <label className={styles.itemOn}>
                      <input type="checkbox" checked disabled={busy} onChange={() => toggleRequest(x, false)} />
                      <span className={styles.itemText}>
                        <span className={styles.itemLabel}>
                          {x.label} <span className={styles.reqTag}>Requested</span>
                        </span>
                        <span className={styles.code}>{optionLine(x)}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : null}
            {alsoOpen.length ? (
              <div className={styles.also}>
                <div className={styles.alsoHead}>Also on Sunday</div>
                {alsoOpen.map((o) => (
                  <button key={o.key} type="button" disabled={busy || !fits(o.min)} className={styles.alsoBtn} onClick={() => toggleRequest(o, true)}>
                    <span>
                      <strong>{o.label}</strong>
                      <br />
                      <span className={styles.choiceSub}>{optionLine(o)}</span>
                    </span>
                    <span className={styles.alsoMark}>{requestMark(o.min)}</span>
                  </button>
                ))}
              </div>
            ) : null}
            <label className={styles.searchLabel}>
              Request something not on the list
              <input className={styles.search} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: knots, swimming, 2c, cooking…" />
            </label>
            {found.length ? (
              <ul className={styles.found}>
                {found.map((r) => (
                  <li key={r.key}>
                    <button
                      type="button"
                      className={styles.foundBtn}
                      disabled={busy || !fits(r.min)}
                      onClick={() => {
                        toggleRequest({ key: r.key, label: r.label, sub: '', code: r.codeLabel, min: r.min }, true);
                        setQ('');
                      }}
                    >
                      <span className={styles.foundCode}>{withMinutes(r.codeLabel, r.min)}</span>
                      <span className={styles.foundLabel}>{r.label}</span>
                      <span className={styles.alsoMark}>{requestMark(r.min)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className={styles.notSure}>
              Each change saves as you make it. There&rsquo;s nothing else to press. Anything outside the plan goes to the planners as a request. It isn&rsquo;t guaranteed, and a leader will let you know
              before Sunday if it can&rsquo;t fit.
            </p>
          </div>
        ) : null}
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
