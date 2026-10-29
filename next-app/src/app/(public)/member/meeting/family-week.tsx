'use client';

/**
 * This week for a family (Plans/Meeting-Planner-III-Emails.md, E2; prototypes/meeting-plan-III/Family.dc.html): the
 * plan is already set, so each scout's card shows it, then ONE radio group whose choices answer "coming?" and "the
 * plan?" together. "Change the plan" opens the edit area in the card: untick a planned requirement (applies at once),
 * or suggest something (a flag for the planners, up to SUGGESTION_CAP). Every tap saves; there is no Send button. A
 * household of two or more gets "Everyone's coming and the plans look good". Shared by /member/meeting (signed in) and
 * /i/plan/<token> (the email's link); the caller passes the write.
 *
 * The email's buttons arrive as `initialAnswer` (once, then the URL drops it): "Yes, coming" answers every unanswered
 * card; "Pick something else" opens the edit area; "Not this week" and "help teach" only preselect, and wait for a tap,
 * so a mail scanner that runs the page can never take a scout off the plan.
 */
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { FamilyOp, FamilyScout, FamilyWeek, FamilyWrite } from '@/lib/family-week';
import { SUGGESTION_CAP, type FamilyChoice } from '@/lib/family-week-shared';
import styles from './family-week.module.css';

type Write = (scoutId: number, op: FamilyOp) => Promise<FamilyWrite>;

interface ChoiceDef {
  k: FamilyChoice;
  label: string;
  sub: string;
}

function choicesFor(s: FamilyScout, focus: string): ChoiceDef[] {
  const out: ChoiceDef = { k: 'out', label: 'Can’t make it this week', sub: `We’ll take ${s.firstName} off Sunday’s plan` };
  if (s.kind === 'rank') {
    return [
      { k: 'ok', label: 'Coming · this plan looks good', sub: `We’ll plan on ${s.firstName} in the ${s.group?.name ?? ''} group` },
      { k: 'change', label: 'Coming · but change the plan', sub: 'Untick something, or suggest something else' },
      out
    ];
  }
  if (s.kind === 'done') {
    return [
      { k: 'ok', label: `Coming · a leader can pick for ${s.firstName}`, sub: `We’ll find something good for ${s.firstName}` },
      { k: 'change', label: 'Coming · I’ll choose', sub: 'Suggest helping teach, a merit badge, or something else' },
      out
    ];
  }
  const list: ChoiceDef[] = [];
  if (s.group) list.push({ k: 'mb', label: `Coming · ${s.group.name} merit badge`, sub: 'With a merit badge counselor' });
  if (s.helpGroup) {
    const who = s.helpGroup.teachers.length ? ` and ${s.helpGroup.teachers.join(' and ')}` : '';
    list.push({ k: 'help', label: `Coming · help teach ${focus || 'the younger scouts'}`, sub: `With the ${s.helpGroup.name} group${who}` });
  }
  if (!list.length) list.push({ k: 'ok', label: 'Coming', sub: 'A leader will find something for Sunday' });
  return [...list, out];
}

/** The "plan looks good" choice for a card: what "Everyone's coming" and the email's "Yes, coming" answer. */
const defaultChoice = (s: FamilyScout): FamilyChoice => (s.kind === 'mb' && s.group ? 'mb' : s.kind === 'mb' && s.helpGroup ? 'help' : 'ok');

export function FamilyWeekView({ week, write, readOnly = false, initialAnswer = null }: { week: FamilyWeek; write: Write; readOnly?: boolean; initialAnswer?: FamilyChoice | null }) {
  const [answers, setAnswers] = useState<Record<number, FamilyChoice | null>>(() => Object.fromEntries(week.scouts.map((s) => [s.personId, s.choice])));
  const [pending, setPending] = useState<FamilyChoice | null>(initialAnswer && initialAnswer !== 'ok' && initialAnswer !== 'mb' ? initialAnswer : null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const applied = useRef(false);
  const focus = week.focus.join(' + ').toLowerCase();

  const answer = async (s: FamilyScout, k: FamilyChoice): Promise<boolean> => {
    const prev = answers[s.personId] ?? null;
    setAnswers((a) => ({ ...a, [s.personId]: k }));
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

  // The email's button, once: "Yes, coming" answers every unanswered card; then the URL forgets it, so a reload
  // can't re-apply an old answer over a later change.
  useEffect(() => {
    if (applied.current || !initialAnswer) return;
    applied.current = true;
    if (!readOnly && (initialAnswer === 'ok' || initialAnswer === 'mb')) {
      // After the effect (a write is a server round trip anyway), so the page's first render settles first.
      void Promise.resolve().then(() => {
        for (const s of week.scouts) if (s.choice == null) void answer(s, defaultChoice(s));
      });
    }
    router.replace(pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = week.scouts.filter((s) => answers[s.personId] == null);
  const allSet = async () => {
    setError(null);
    for (const s of open) await answer(s, defaultChoice(s));
  };

  return (
    <div className={styles.wrap}>
      {week.scouts.length > 1 && open.length > 0 && !readOnly ? (
        <button type="button" className={styles.allSet} onClick={() => void allSet()}>
          <span className={styles.allSetMain}>✓ Everyone&rsquo;s coming and the plans look good</span>
          <span className={styles.allSetSub}>
            Answers for {week.scouts.map((s) => s.firstName).join(' and ')} in one tap. You can still change any one below.
          </span>
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
          focus={focus}
          choice={answers[s.personId] ?? null}
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
  focus,
  choice,
  pending,
  onChoose,
  write,
  readOnly
}: {
  scout: FamilyScout;
  focus: string;
  choice: FamilyChoice | null;
  pending: FamilyChoice | null;
  onChoose: (k: FamilyChoice) => void;
  write: Write;
  readOnly: boolean;
}) {
  const [off, setOff] = useState<Set<string>>(() => new Set(scout.items.filter((i) => !i.on).map((i) => i.key)));
  const [suggested, setSuggested] = useState(scout.suggestions);
  const [editing, setEditing] = useState(pending === 'change');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const choices = choicesFor(scout, focus);
  const changes = off.size + suggested.length;
  const showEdit = !readOnly && (editing || choice === 'change') && choice !== 'out';

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
  const toggleSuggest = (o: { key: string; label: string; sub: string }, on: boolean) => {
    const prev = suggested;
    if (on && prev.length >= SUGGESTION_CAP) {
      setError(`Suggest up to ${SUGGESTION_CAP} things. Remove one first.`);
      return;
    }
    void run({ op: 'suggest', key: o.key, on }, () => setSuggested(on ? [...prev, o] : prev.filter((x) => x.key !== o.key)), () => setSuggested(prev));
  };
  const choose = (k: FamilyChoice) => {
    setEditing(k === 'change');
    onChoose(k);
  };

  const badge =
    choice == null
      ? { text: 'Needs an answer', cls: styles.badgeAsk }
      : choice === 'out'
        ? { text: 'Not coming', cls: styles.badgeOut }
        : changes > 0
          ? { text: 'Coming · changes sent', cls: styles.badgeChanged }
          : { text: '✓ Coming', cls: styles.badgeComing };
  const isSuggested = (key: string) => suggested.some((x) => x.key === key);
  const alsoKeys = new Set(scout.also.map((o) => o.key));
  const extras = suggested.filter((x) => !alsoKeys.has(x.key));
  const term = q.trim().toLowerCase();
  const found = term ? scout.requestable.filter((r) => !isSuggested(r.key) && `${r.codeLabel} ${r.label}`.toLowerCase().includes(term)).slice(0, 5) : [];
  const planTitle = scout.kind === 'mb' ? `${scout.firstName}’s options` : `${scout.firstName}’s plan`;
  const planSub = scout.kind === 'rank' ? `${scout.group?.name} group${scout.group?.teachers.length ? ` · with ${scout.group.teachers.join(' and ')}` : ''}` : scout.kind === 'mb' ? 'Merit badge group' : '';
  const hid = `fw-${scout.personId}`;
  const qid = `fwq-${scout.personId}`;

  return (
    <section className={styles.card} aria-labelledby={hid}>
      <div className={styles.cardHead}>
        <h2 id={hid} className={styles.name}>
          {scout.firstName}
        </h2>
        <span className={styles.rankLine}>{scout.rankName} rank</span>
        <span className={`${styles.badge} ${badge.cls}`}>{badge.text}</span>
      </div>

      <div className={styles.plan}>
        <div className={styles.planHead}>
          <h3 className={styles.planTitle}>{planTitle}</h3>
          {planSub ? <span className={styles.planSub}>{planSub}</span> : null}
        </div>
        {scout.kind === 'rank' && !showEdit && choice !== 'out' ? (
          <ul className={styles.planList}>
            {scout.items
              .filter((i) => !off.has(i.key))
              .map((i) => (
                <li key={i.key} className={styles.planItem}>
                  <span aria-hidden="true" className={styles.tick}>
                    ✓
                  </span>
                  <span>
                    {i.label} <span className={styles.code}>· {i.code}</span>
                  </span>
                </li>
              ))}
          </ul>
        ) : null}
        {scout.kind === 'done' && choice !== 'out' ? (
          <p className={styles.doneNote}>
            Nice work: {scout.firstName} has finished every requirement on offer this week. A leader can pick something good, or you can suggest something.
          </p>
        ) : null}
      </div>

      <div className={styles.ask}>
        <div id={qid} className={styles.question}>
          Is {scout.firstName} coming Sunday{scout.kind === 'mb' ? ', and what would they like to do?' : '?'}
        </div>
        <div role="radiogroup" aria-labelledby={qid} className={styles.choices}>
          {choices.map((o) => {
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
        <p className={styles.notSure}>Not sure yet? Leave it for now and answer when you know.</p>

        {showEdit ? (
          <div className={styles.edit}>
            <div className={styles.editHead}>
              <span className={styles.editTitle}>{scout.kind === 'done' ? `Suggest something for ${scout.firstName}` : `Change ${scout.firstName}’s plan`}</span>
              <span role="status" className={styles.saved}>
                {changes ? `✓ Saved · ${[off.size ? `${off.size} ${off.size === 1 ? 'change' : 'changes'}` : '', suggested.length ? `${suggested.length} ${suggested.length === 1 ? 'suggestion' : 'suggestions'}` : ''].filter(Boolean).join(', ')} sent to the planners` : ''}
              </span>
            </div>
            {scout.items.length ? (
              <ul className={styles.planList}>
                {scout.items.map((i) => {
                  const on = !off.has(i.key);
                  return (
                    <li key={i.key}>
                      <label className={on ? styles.itemOn : styles.item}>
                        <input type="checkbox" checked={on} disabled={busy} onChange={(e) => toggleItem(i.key, e.target.checked)} />
                        <span className={styles.itemText}>
                          <span className={styles.itemLabel}>{i.label}</span>
                          <span className={styles.code}>
                            {i.code}
                            {on ? '' : ' · taken off'}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {scout.also.length ? (
              <div className={styles.also}>
                <div className={styles.alsoHead}>Also on Sunday · suggest one</div>
                {scout.also.map((o) => {
                  const on = isSuggested(o.key);
                  return (
                    <button key={o.key} type="button" aria-pressed={on} disabled={busy} className={on ? styles.alsoOn : styles.alsoBtn} onClick={() => toggleSuggest(o, !on)}>
                      <span>
                        <strong>{o.label}</strong>
                        <br />
                        <span className={styles.choiceSub}>{o.sub}</span>
                      </span>
                      <span className={styles.alsoMark}>{on ? '✓ Suggested' : '+ Suggest'}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
            {extras.map((x) => (
              <div key={x.key} className={styles.extra}>
                <span className={styles.extraLabel}>
                  <strong>{x.label}</strong> <span className={styles.code}>· suggested</span>
                </span>
                <button type="button" className={styles.link} aria-label={`Remove ${x.label}`} disabled={busy} onClick={() => toggleSuggest(x, false)}>
                  Remove
                </button>
              </div>
            ))}
            <label className={styles.searchLabel}>
              Suggest something not on the list
              <input className={styles.search} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: knots, swimming, 2c, cooking…" />
            </label>
            {found.length ? (
              <ul className={styles.found}>
                {found.map((r) => (
                  <li key={r.key}>
                    <button
                      type="button"
                      className={styles.foundBtn}
                      disabled={busy}
                      onClick={() => {
                        toggleSuggest({ key: r.key, label: r.label, sub: r.codeLabel }, true);
                        setQ('');
                      }}
                    >
                      <span className={styles.foundCode}>{r.codeLabel}</span>
                      <span className={styles.foundLabel}>{r.label}</span>
                      <span className={styles.alsoMark}>+ Suggest</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className={styles.notSure}>
              Each change saves as you make it. There&rsquo;s nothing else to press. Anything outside the plan goes to the planners as a suggestion (up to {SUGGESTION_CAP}). It isn&rsquo;t guaranteed, and a leader
              will let you know before Sunday if it can&rsquo;t fit.
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
