'use client';

/**
 * An adult's or Junior Leader's card on the family page (Plans/Meeting-Planner-III-Family.md, F3 + F4;
 * prototypes/meeting-plan-III/Family.dc.html). The same shape as a scout's (family-week.tsx): first name, the
 * teaching line, a badge, the plan, and This plan looks good · Change my plan · Can't make it this week.
 *
 *   - "Change my plan" opens "{name}'s Sunday": their classes as checkboxes (untick = drop), the load meter, Classes
 *     that need a teacher (I'll teach this), Classes with a teacher (I'll help teach), Scouts are asking for these,
 *     and Offer something. At most TEACH_MAX_CLASSES classes and TEACH_MAX_MIN minutes; anything that won't fit is
 *     disabled and says why (teach-actions checks it again). Adults-only classes are shown to a Junior Leader, not
 *     takeable.
 *   - Someone with nothing assigned and no answer gets the class list open, with only Can't make it under it.
 *     Signing up answers the card; the next visit shows the standard card.
 *   - Can't make it this week opens an optional note for the planners (F3b): 3 lines and 240 characters, its own Send.
 *   - "Not sure yet? Clear …'s answer" gives back everything signed up on this page. Pre-assigned to a class, it asks
 *     first whether to take them off the plan for now.
 */
import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/app/_components/button';
import { classMinutes, TEACH_MAX_CLASSES, TEACH_MAX_MIN, teachRefusal, withMinutes } from '@/lib/family-week-shared';
import type { OfferChoices, TeachView, WantedItem } from '@/lib/meeting-board-supply';
import type { TeacherClass, TeacherWeek } from '@/lib/teacher-week';
import { fmtDay } from '@/lib/format-date';
import { DECLINE_NOTE_CHARS, DECLINE_NOTE_LINES } from '@/lib/decline-note';
import {
  meetingPostOfferAction,
  meetingTeachAction,
  meetingTeacherClearAction,
  meetingTeacherIntentAction,
  meetingTeacherNoteAction,
  meetingUnteachAction,
  meetingWithdrawOfferAction,
  type OfferWhat,
  type TeachActionResult
} from './teach-actions';
import { OfferForm, type Draft } from './offer-form';
import styles from './meeting.module.css';
import fw from './family-week.module.css';

type Answer = 'ok' | 'change' | 'out';

export interface TeacherCardProps {
  entryId: number;
  date: string;
  isSelf: boolean;
  initial: TeacherWeek;
  /** The old teach section's data: what scouts asked for, and whether this person may still add. */
  view: TeachView;
  choices: OfferChoices;
  onBehalf: boolean;
  readOnly: boolean;
}

const classes = (n: number) => `${n} ${n === 1 ? 'class' : 'classes'}`;

/** The answer as saved: coming with something signed up on this page reads as a change. */
function answerOf(w: TeacherWeek): Answer | null {
  if (w.intent === 'not_coming') return 'out';
  if (w.intent !== 'coming') return null;
  return [...w.mine, ...w.other].some((x) => !x.preassigned) ? 'change' : 'ok';
}

export function TeacherCard({ entryId, date, isSelf, initial, view: initialView, choices, onBehalf, readOnly }: TeacherCardProps) {
  const router = useRouter();
  const ids = useId();
  const [week, setWeek] = useState(initial);
  const [view, setView] = useState(initialView);
  const [answer, setAnswer] = useState<Answer | null>(() => answerOf(initial));
  const [unsure, setUnsure] = useState<'plain' | 'off' | 'kept' | null>(() => (initial.intent === 'undecided' ? 'plain' : null));
  // Nothing assigned and no answer yet: the class list opens first (held until the next visit).
  const [empty] = useState(() => !initial.mine.length && !initial.other.length && initial.intent == null);
  const [editing, setEditing] = useState(false);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState(initial.note ?? '');
  const [problem, setProblem] = useState<{ at: string | null; text: string } | null>(null);
  const [live, setLive] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [offerErr, setOfferErr] = useState<{ what?: string; dates?: string }>({});
  const [pending, start] = useTransition();
  const target = { entryId, personId: week.personId, onBehalf };
  const first = week.firstName;
  const you = isSelf ? 'you' : first;
  const who = isSelf ? 'You' : first;

  function run(call: () => Promise<TeachActionResult>, say: string, opts: { at?: string; onOk?: (r: Extract<TeachActionResult, { ok: true }>) => void; onFail?: (r: { error: string; field?: 'what' | 'dates' }) => boolean } = {}) {
    if (readOnly || pending) return;
    setProblem(null);
    start(async () => {
      const res = await call();
      if (!res.ok) {
        if (!opts.onFail?.(res)) setProblem({ at: opts.at ?? null, text: res.error });
        setLive(res.error);
        return;
      }
      setView(res.view);
      if (res.week) setWeek(res.week);
      opts.onOk?.(res);
      setLive(say);
      router.refresh();
    });
  }

  const choose = (k: Answer) => {
    setEditing(k === 'change');
    setAsking(false);
    if (k === answer) return;
    const prev = answer;
    setAnswer(k);
    setUnsure(null);
    run(() => meetingTeacherIntentAction({ ...target, intent: k === 'out' ? 'not_coming' : 'coming' }), 'Saved.', { onFail: () => (setAnswer(prev), false) });
  };

  /** Taking a class on answers the card (it implies coming). */
  const take = (key: string, label: string) =>
    run(() => meetingTeachAction({ ...target, key }), `Saved. ${isSelf ? 'You’re' : `${first} is`} teaching ${label}.`, {
      at: key,
      onOk: () => {
        if (answer !== 'change') {
          setAnswer('change');
          setUnsure(null);
          void meetingTeacherIntentAction({ ...target, intent: 'coming' });
        }
      }
    });
  const drop = (kind: 'topic' | 'offer', key: string) =>
    run(() => (kind === 'topic' ? meetingUnteachAction({ ...target, key }) : meetingWithdrawOfferAction({ ...target, skillId: key })), 'Saved. Removed.', { at: key });

  const clear = (takeOff: boolean) => {
    setAsking(false);
    setEditing(false);
    const prev = answer;
    setAnswer(null);
    setUnsure(takeOff ? 'off' : week.mine.some((m) => m.preassigned) || week.other.some((o) => o.preassigned) ? 'kept' : 'plain');
    run(() => meetingTeacherClearAction({ ...target, takeOff }), 'Answer cleared.', { onFail: () => (setAnswer(prev), setUnsure(null), false) });
  };

  function postOffer() {
    if (!draft) return;
    const errs: { what?: string; dates?: string } = {};
    if (draft.type === 'skill' && !draft.skillId) errs.what = 'Choose a skill.';
    if (draft.type === 'req' && !draft.key) errs.what = 'Choose a requirement.';
    if (draft.type === 'ff' && !draft.title.trim()) errs.what = 'Say what you’ll teach.';
    if (!draft.dates.length) errs.dates = 'Pick at least one date.';
    setOfferErr(errs);
    if (errs.what || errs.dates) return;
    const what: OfferWhat = draft.type === 'skill' ? { type: 'skill', skillId: draft.skillId } : draft.type === 'req' ? { type: 'req', key: draft.key } : { type: 'ff', title: draft.title };
    run(() => meetingPostOfferAction({ ...target, what, entryIds: draft.dates, note: draft.note }), 'Offer posted.', {
      onOk: () => setDraft(null),
      onFail: (r) => {
        if (!r.field) return false;
        setOfferErr({ [r.field]: r.error });
        return true;
      }
    });
  }

  const preassigned = [...week.mine, ...week.other].filter((x) => x.preassigned);
  const atLimit = week.load.classes >= TEACH_MAX_CLASSES || week.load.minutes >= TEACH_MAX_MIN;
  const why = (c: { key: string; min: number; adultsOnly?: boolean }) => (week.junior && c.adultsOnly ? 'Adults only' : teachRefusal(who, week.load, c.min));
  const teaching = week.mine.filter((m) => m.role === 'teach').map((m) => `the ${m.label}`);
  const helping = week.mine.filter((m) => m.role === 'help').map((m) => `the ${m.label}`);
  const groupLine = [teaching.length ? `Teaching ${teaching.join(' and ')}` : '', helping.length ? `${teaching.length ? 'helping' : 'Helping'} teach ${helping.join(' and ')}` : '']
    .filter(Boolean)
    .join(' · ');
  const badge =
    answer == null
      ? { text: unsure ? 'Not sure yet' : 'Needs an answer', cls: unsure ? fw.badgeChanged : fw.badgeAsk }
      : answer === 'out'
        ? { text: 'Can’t make it', cls: fw.badgeOut }
        : answer === 'change'
          ? { text: '✓ Changes sent', cls: fw.badgeChanged }
          : { text: '✓ Plan looks good', cls: fw.badgeComing };
  const hid = `${ids}-teach`;
  const qid = `${ids}-q`;
  const showEdit = !readOnly && view.canAdd && answer !== 'out' && (editing || (empty && answer == null && !unsure));
  const plan = [...week.mine, ...week.other];
  const unsureText =
    unsure === 'off'
      ? `Not sure yet. We’ve taken ${you} off Sunday’s plan for now, and that class is open for another adult. Come back as soon as ${isSelf ? 'you know' : 'they know'} more. If a class is still open, you can pick it again.`
      : unsure === 'kept'
        ? `Not sure yet. ${isSelf ? 'You’re' : `${first} is`} still on the plan for ${preassigned.map((p) => `the ${p.label}`).join(' and ')}.`
        : unsure
          ? 'Marked not sure yet. Answer when you know.'
          : 'Not sure yet? Leave it for now and answer when you know.';

  const classRow = (c: TeacherClass, verb: string) => {
    const no = why(c);
    return (
      <div key={c.key} className={styles.teachWrap}>
        <div className={styles.teachRow}>
          <span className={styles.grow}>
            <b>
              {c.label}
              {c.adultsOnly ? <span className={fw.reqTag}> Adults only</span> : null}
            </b>
            <small>
              {c.line}
              {c.teachers.length ? ` · taught by ${c.teachers.join(' and ')}` : ''}
            </small>
            {c.parts.length ? <small>{c.parts.join(' · ')}</small> : null}
            {no ? <small className={styles.flag}>{no}</small> : null}
          </span>
          {!readOnly && (
            <Button size="sm" variant="secondary" disabled={!!no || pending} onClick={() => take(c.key, c.label)}>
              {verb}
            </Button>
          )}
        </div>
        {problem?.at === c.key ? (
          <p className={styles.badNote} role="alert">
            {problem.text}
          </p>
        ) : null}
      </div>
    );
  };
  const wantRow = (w: WantedItem) => {
    const min = classMinutes(w.minutes ?? 15);
    const no = w.refused ? 'Adults only' : teachRefusal(who, week.load, min);
    return (
      <div key={w.key} className={styles.teachWrap}>
        <div className={styles.teachRow}>
          <span className={styles.grow}>
            <b>{w.label}</b>
            <small>{[withMinutes(w.codeLabel, min), `${w.scouts} ${w.scouts === 1 ? 'scout' : 'scouts'}`, `asked ${w.weeks} ${w.weeks === 1 ? 'week' : 'weeks'}`].join(' · ')}</small>
            {w.names.length ? <small>{w.names.join(', ')}</small> : null}
            {no ? <small className={styles.flag}>{no}</small> : null}
          </span>
          {!readOnly && (
            <Button size="sm" variant="secondary" disabled={!!no || pending} onClick={() => take(w.key, w.label)}>
              I&rsquo;ll teach this
            </Button>
          )}
        </div>
        {problem?.at === w.key ? (
          <p className={styles.badNote} role="alert">
            {problem.text}
          </p>
        ) : null}
      </div>
    );
  };

  const choicesList: { k: Answer; label: string; sub: string }[] = [
    {
      k: 'ok',
      label: 'This plan looks good',
      sub: week.mine.length ? `We’ll plan on ${you} for ${week.mine.map((m) => `the ${m.label}`).join(' and ')}` : `A leader will put ${you} where help is needed`
    },
    { k: 'change', label: 'Change my plan', sub: 'Drop something, take on something scouts asked for, or offer something' },
    { k: 'out', label: 'Can’t make it this week', sub: `We’ll take ${you} off Sunday’s plan` }
  ];
  const firstVisit = empty && answer == null && !unsure;

  return (
    <section className={fw.teachCard} aria-labelledby={hid}>
      <div className={fw.cardHead}>
        <h2 id={hid} className={fw.name}>
          {first}&rsquo;s plan
        </h2>
        <span className={fw.rankLine}>{groupLine || 'Not teaching a group yet'}</span>
        <span className={`${fw.badge} ${badge.cls}`}>{badge.text}</span>
      </div>

      {plan.length && !showEdit && answer !== 'out' ? (
        <div className={fw.plan}>
          <ul className={fw.planList}>
            {plan.map((x) => (
              <li key={x.key} className={fw.planItem}>
                <span aria-hidden="true" className={fw.tick}>
                  ✓
                </span>
                <span className={fw.itemText}>
                  <span>{x.label}</span>
                  <span className={fw.code}>{x.line}</span>
                </span>
              </li>
            ))}
          </ul>
          {!atLimit && week.needs.length && view.canAdd ? (
            <p className={fw.notSure}>
              {classes(week.needs.length)} on Sunday&rsquo;s plan still {week.needs.length === 1 ? 'needs' : 'need'} a teacher. Choose Change my plan to take one on.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className={fw.ask}>
        {firstVisit && !readOnly ? (
          <p className={fw.doneNote}>
            Hi {first}, {isSelf ? 'you’re' : 'they’re'} not signed up for anything yet. Can {you} help teach any of the items below?
          </p>
        ) : (
          <>
            <div id={qid} className={fw.question}>
              How does {first}&rsquo;s plan look?
            </div>
            <div role="radiogroup" aria-labelledby={qid} className={fw.choices}>
              {choicesList.map((o) => {
                const on = answer === o.k;
                return (
                  <button
                    key={o.k}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={readOnly || pending}
                    className={`${fw.choice} ${on ? (o.k === 'out' ? fw.choiceOut : o.k === 'change' ? fw.choiceChange : fw.choiceOn) : ''}`}
                    onClick={() => choose(o.k)}
                  >
                    <span aria-hidden="true" className={on ? fw.dotOn : fw.dot}>
                      {on ? '✓' : ''}
                    </span>
                    <span className={fw.choiceText}>
                      <span className={fw.choiceLabel}>{o.label}</span>
                      <span className={fw.choiceSub}>{o.sub}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {showEdit ? (
          <div className={fw.edit}>
            {!firstVisit ? (
              <div className={fw.editHead}>
                <span className={fw.editTitle}>{first}&rsquo;s Sunday</span>
              </div>
            ) : null}
            {plan.length ? (
              <ul className={fw.planList}>
                {plan.map((x) => (
                  <li key={x.key}>
                    <label className={fw.itemOn}>
                      <input type="checkbox" checked disabled={pending} onChange={() => drop('kind' in x ? x.kind : 'topic', x.key)} />
                      <span className={fw.itemText}>
                        <span className={fw.itemLabel}>{x.label}</span>
                        <span className={fw.code}>{x.line}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : null}
            <div role="status" className={atLimit ? fw.capFull : fw.cap}>
              <strong>
                {week.load.classes} of {TEACH_MAX_CLASSES} classes · {week.load.minutes} of {TEACH_MAX_MIN} minutes
              </strong>{' '}
              <span>
                {atLimit
                  ? `${first}’s Sunday is full. To take on something else, drop a class first.`
                  : `Up to ${TEACH_MAX_CLASSES} classes and ${TEACH_MAX_MIN} minutes of teaching on a Sunday, so no one takes on more than they can deliver.`}
              </span>
            </div>
            {week.needs.length ? (
              <div className={fw.also}>
                <div className={fw.alsoHead}>Classes that need a teacher · {fmtDay(date)}</div>
                {week.needs.map((c) => classRow(c, 'I’ll teach this'))}
              </div>
            ) : null}
            {week.taught.length ? (
              <div className={fw.also}>
                <div className={fw.alsoHead}>Classes with a teacher · help teach one</div>
                {week.taught.map((c) => classRow(c, 'I’ll help teach'))}
              </div>
            ) : null}
            {view.wanted.some((w) => !w.teachers.length) ? (
              <div className={fw.also}>
                <div className={fw.alsoHead}>Scouts are asking for these · take one on</div>
                {view.wanted.filter((w) => !w.teachers.length).map(wantRow)}
              </div>
            ) : null}
            {problem && !problem.at ? (
              <p className={styles.badNote} role="alert">
                {problem.text}
              </p>
            ) : null}
            <div className={fw.offerLine}>
              {draft ? (
                <OfferForm
                  ids={ids}
                  draft={draft}
                  choices={choices}
                  junior={week.junior}
                  errors={offerErr}
                  pending={pending}
                  onChange={setDraft}
                  onSubmit={postOffer}
                  onCancel={() => {
                    setDraft(null);
                    setOfferErr({});
                  }}
                />
              ) : (
                <button
                  type="button"
                  className={fw.unsure}
                  onClick={() => {
                    setOfferErr({});
                    setDraft({ type: 'ff', skillId: '', key: '', title: '', dates: choices.dates.some((d) => d.entryId === entryId) ? [entryId] : [], note: '' });
                  }}
                >
                  Offer something
                </button>
              )}
            </div>
          </div>
        ) : null}

        {!view.canAdd && plan.length ? (
          <div className={fw.edit}>
            <p className={styles.helper}>
              {isSelf ? 'You’re' : `${first} is`} not on the teaching list any more. Remove these, or ask a leader to sign {isSelf ? 'you' : 'them'} up again.
            </p>
            {plan.map((x) => (
              <div key={x.key} className={styles.teachRow}>
                <span className={styles.grow}>
                  <b>{x.label}</b>
                </span>
                {!readOnly && (
                  <button type="button" className={styles.linkBtn} onClick={() => drop('kind' in x ? x.kind : 'topic', x.key)} aria-label={`Remove ${x.label}`}>
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : null}

        {firstVisit && !readOnly ? (
          <div role="radiogroup" aria-label={`Can ${first} make it?`} className={fw.choices}>
            <button type="button" role="radio" aria-checked={false} disabled={pending} className={fw.choice} onClick={() => choose('out')}>
              <span aria-hidden="true" className={fw.dot} />
              <span className={fw.choiceText}>
                <span className={fw.choiceLabel}>Can&rsquo;t make it this week</span>
                <span className={fw.choiceSub}>We&rsquo;ll take {you} off Sunday&rsquo;s plan</span>
              </span>
            </button>
          </div>
        ) : null}

        {answer === 'out' && !readOnly ? (
          <div className={fw.note}>
            <label htmlFor={`${ids}-note`} className={fw.noteLabel}>
              No problem. Anything you&rsquo;d like us to know?
            </label>
            <textarea
              id={`${ids}-note`}
              rows={DECLINE_NOTE_LINES}
              maxLength={DECLINE_NOTE_CHARS}
              className={fw.noteBox}
              value={note}
              onChange={(e) => setNote(e.target.value.split('\n').slice(0, DECLINE_NOTE_LINES).join('\n').slice(0, DECLINE_NOTE_CHARS))}
            />
            <span className={fw.noteCount}>
              {DECLINE_NOTE_CHARS - note.length} characters left · up to {DECLINE_NOTE_LINES} lines
            </span>
            <div>
              <Button
                variant="secondary"
                size="sm"
                disabled={pending || note.trim() === (week.note ?? '')}
                title={note.trim() === (week.note ?? '') ? 'No changes to send yet' : undefined}
                onClick={() => run(() => meetingTeacherNoteAction({ ...target, note }), 'Note sent.')}
              >
                {note.trim() === (week.note ?? '') ? (week.note ? 'Sent' : 'Send') : week.note ? 'Send changes' : 'Send'}
              </Button>
            </div>
          </div>
        ) : null}
        {asking ? (
          <div className={fw.capFull} role="group" aria-labelledby={`${ids}-ask`}>
            <p id={`${ids}-ask`}>
              <strong>Should we take {you} off Sunday&rsquo;s plan for now?</strong>
            </p>
            <p>
              {isSelf ? 'You’re' : `${first} is`} down to teach {preassigned.map((p) => `the ${p.label}`).join(' and ')}. If we take {you} off until {isSelf ? 'you know' : 'they know'}, a leader
              can ask another adult to cover the class. Come back to this page as soon as {isSelf ? 'you know' : 'they know'} more.
            </p>
            <div className={fw.choices}>
              <Button variant="secondary" disabled={pending} onClick={() => clear(true)}>
                Yes, take {isSelf ? 'me' : first} off the plan for now
              </Button>
              <Button variant="secondary" disabled={pending} onClick={() => clear(false)}>
                No, keep {isSelf ? 'me' : first} on the plan while {isSelf ? 'I decide' : 'they decide'}
              </Button>
              <button type="button" className={fw.unsure} onClick={() => setAsking(false)}>
                Never mind, keep {isSelf ? 'my' : 'the'} answer
              </button>
            </div>
          </div>
        ) : answer != null && !readOnly ? (
          <button type="button" className={fw.unsure} disabled={pending} onClick={() => (preassigned.length ? setAsking(true) : clear(false))}>
            Not sure yet? Clear {first}&rsquo;s answer
          </button>
        ) : !firstVisit ? (
          <p className={fw.notSure}>{unsureText}</p>
        ) : null}
        {problem && !problem.at && !showEdit ? (
          <p className={fw.error} role="alert">
            {problem.text}
          </p>
        ) : null}
        <p className={styles.sr} aria-live="polite">
          {pending ? '' : live}
        </p>
      </div>
    </section>
  );
}
