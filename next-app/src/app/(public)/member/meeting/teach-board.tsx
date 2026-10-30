'use client';

/**
 * "Teach at a meeting" (Phase 2 of Plans/Meeting-Requests-And-Teaching-Offers.md). For adults (leaders and parents
 * alike) and Junior Leaders. Since Planner III it is one white card like a scout's (family-week.tsx; prototype
 * prototypes/meeting-plan-III/Family.dc.html, "Can you teach?"): the person's name, a status badge, full-width choices.
 *
 *   - Adults answer Coming / Not sure yet ("We'll find something that fits": a leader puts them where they're needed) /
 *     Can't make it here. A Junior Leader answers once, in their scout section above, and this section follows it.
 *   - "You're teaching (n)": what they've taken on, with how many scouts asked so far. A broad skill offer counts as
 *     one. There is no cap: adults decide for themselves (Plans/Meeting-Planner-II.md, Decision 7).
 *   - "Scouts are asking for these": every topic scouts asked for, the ones with no teacher first, with how many and
 *     who. "I'll teach this" saves on tap; a refusal is said in place under that row.
 *     Topics outside the person's teaching skills sit under "Other things scouts asked for" and can still be taken,
 *     flagged (matcher rule 1); an adults-only skill has no button for a Junior Leader.
 *   - "Offer something": a skill, a requirement or something else, on one or more dates, with a note. Each date is its
 *     own commitment. Problems are marked in place.
 */
import { useId, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/app/_components/button';
import { Badge } from '@/app/_components/badge';
import { INTENT_LABEL, type Intent } from '@/lib/meeting-board-shared';
import { minutesText } from '@/lib/meeting-board-picklist';
import type { OfferChoices, TeachItem, TeachView, WantedItem } from '@/lib/meeting-board-supply';
import type { MatchLine } from '@/lib/meeting-board-match';
import { Saved } from './answer-control';
import {
  meetingPostOfferAction,
  meetingTeachAction,
  meetingTeacherIntentAction,
  meetingUnteachAction,
  meetingWithdrawOfferAction,
  type OfferWhat,
  type TeachActionResult
} from './teach-actions';
import { TopicParts } from './topic-parts';
import styles from './meeting.module.css';
import fw from './family-week.module.css';

const FLASH_MS = 1800;

const INTENTS: { k: Intent; label: string; sub: (who: string) => string }[] = [
  { k: 'coming', label: INTENT_LABEL.coming, sub: () => 'Take on something below, or offer something' },
  { k: 'undecided', label: INTENT_LABEL.undecided, sub: (who) => `A leader can put ${who} where help is needed` },
  { k: 'not_coming', label: 'Can’t make it this week', sub: (who) => `We won’t plan on ${who} Sunday` }
];

export interface TeachBoardProps {
  entryId: number;
  /** name: the full display name, which heads the card (the page is signed-in only). */
  subject: { personId: number; firstName: string; name?: string; isSelf: boolean };
  initial: TeachView;
  choices: OfferChoices;
  onBehalf: boolean;
  readOnly: boolean;
  /** Phase 3a: the sessions the live match has this person teaching so far, by block. Empty once the agenda is
   *  published (the page links to it). */
  teaching?: MatchLine[];
}

type OfferType = OfferWhat['type'];
interface Draft {
  type: OfferType;
  skillId: string;
  key: string;
  title: string;
  dates: number[];
  note: string;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function TeachBoard(props: TeachBoardProps) {
  const { entryId, subject, choices, onBehalf, readOnly } = props;
  const router = useRouter();
  const [view, setView] = useState(props.initial);
  const [errKey, setErrKey] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [flash, setFlash] = useState({ intent: 0, teach: 0 });
  const [live, setLive] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [offerErr, setOfferErr] = useState<{ what?: string; dates?: string }>({});
  const [pending, start] = useTransition();
  const busy = useRef(false);
  const ids = useId();
  const target = { entryId, personId: subject.personId, onBehalf };
  const junior = view.kind === 'junior';
  const you = subject.isSelf ? 'You’re' : `${subject.firstName} is`;

  function run(call: () => Promise<TeachActionResult>, after: { what: 'intent' | 'teach'; say: string; errorAt?: string; onOk?: () => void; onFail?: (r: { error: string; field?: 'what' | 'dates' }) => boolean }) {
    if (readOnly || busy.current) return;
    busy.current = true;
    setProblem(null);
    start(async () => {
      try {
        const res = await call();
        if (!res.ok) {
          if (after.onFail?.(res)) {
            setLive(res.error);
            return;
          }
          if (after.errorAt) setErrKey(after.errorAt);
          setProblem(res.error);
          setLive(res.error);
          return;
        }
        setView(res.view);
        setErrKey(null);
        after.onOk?.();
        const stamp = Date.now();
        setFlash((f) => ({ ...f, [after.what]: stamp }));
        setTimeout(() => setFlash((f) => (f[after.what] === stamp ? { ...f, [after.what]: 0 } : f)), FLASH_MS);
        setLive(after.say);
        router.refresh();
      } finally {
        busy.current = false;
      }
    });
  }

  /** null = "Clear this answer": back to no answer. */
  function chooseIntent(next: Intent | null) {
    if (next === view.intent) return;
    run(() => meetingTeacherIntentAction({ ...target, intent: next }), { what: 'intent', say: next ? `Saved: ${INTENT_LABEL[next]}` : 'Answer cleared.' });
  }

  function commit(w: WantedItem) {
    if (readOnly) return;
    run(() => meetingTeachAction({ ...target, key: w.key }), { what: 'teach', say: `Saved. ${you} teaching ${w.label}.`, errorAt: w.key });
  }

  function remove(item: TeachItem) {
    run(
      () => (item.kind === 'topic' ? meetingUnteachAction({ ...target, key: item.key }) : meetingWithdrawOfferAction({ ...target, skillId: item.key })),
      { what: 'teach', say: item.kind === 'topic' ? 'Saved. Removed.' : 'Offer withdrawn.' }
    );
  }

  function openOffer() {
    setOfferErr({});
    setDraft({ type: choices.skills.length ? 'skill' : 'req', skillId: '', key: '', title: '', dates: choices.dates.some((d) => d.entryId === entryId) ? [entryId] : [], note: '' });
  }

  function postOffer() {
    if (!draft) return;
    const errs: { what?: string; dates?: string } = {};
    if (draft.type === 'skill' && !draft.skillId) errs.what = 'Choose a skill.';
    if (draft.type === 'req' && !draft.key) errs.what = 'Choose a requirement.';
    if (draft.type === 'ff' && !draft.title.trim()) errs.what = 'Say what you’ll teach.';
    if (!draft.dates.length) errs.dates = 'Pick at least one date.';
    setOfferErr(errs);
    if (errs.what || errs.dates) {
      setLive(`Can’t post yet: ${[errs.what, errs.dates].filter(Boolean).join(' ')}`);
      return;
    }
    const what: OfferWhat = draft.type === 'skill' ? { type: 'skill', skillId: draft.skillId } : draft.type === 'req' ? { type: 'req', key: draft.key } : { type: 'ff', title: draft.title };
    run(() => meetingPostOfferAction({ ...target, what, entryIds: draft.dates, note: draft.note }), {
      what: 'teach',
      say: 'Offer posted.',
      onOk: () => setDraft(null),
      onFail: (r) => {
        if (!r.field) return false;
        setOfferErr({ [r.field]: r.error });
        return true;
      }
    });
  }

  // The same card as a scout's (family-week.tsx): a white card, the person's name, a status badge, and one radio
  // group of full-width choices.
  const shown: Intent | null = view.intent ?? (view.count > 0 ? 'coming' : null);
  const qid = `${ids}-teach-q`;
  const intentBlock = junior || !view.canAdd ? null : (
    <div className={`${fw.ask} ${fw.askRuled}`}>
      <div id={qid} className={fw.question}>
        {subject.isSelf ? 'Are you coming Sunday to teach?' : `Is ${subject.firstName} coming Sunday to teach?`}
        <Saved on={flash.intent > 0} />
      </div>
      <div role="radiogroup" aria-labelledby={qid} className={fw.choices}>
        {INTENTS.map((o) => {
          const on = shown === o.k;
          return (
            <button
              key={o.k}
              type="button"
              role="radio"
              aria-checked={on}
              aria-labelledby={`${ids}-${o.k}-label`}
              aria-describedby={`${ids}-${o.k}-sub`}
              disabled={readOnly || pending}
              className={`${fw.choice} ${on ? (o.k === 'not_coming' ? fw.choiceOut : o.k === 'undecided' ? fw.choiceChange : fw.choiceOn) : ''}`}
              onClick={() => chooseIntent(o.k)}
            >
              <span aria-hidden="true" className={on ? fw.dotOn : fw.dot}>
                {on ? '✓' : ''}
              </span>
              <span className={fw.choiceText}>
                <span id={`${ids}-${o.k}-label`} className={fw.choiceLabel}>
                  {o.label}
                </span>
                <span id={`${ids}-${o.k}-sub`} className={fw.choiceSub}>
                  {o.sub(subject.isSelf ? 'you' : subject.firstName)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {view.intent === 'undecided' ? (
        <p className={fw.notSure}>We&rsquo;ll find something that fits.</p>
      ) : view.intent === 'not_coming' ? (
        <p className={fw.notSure}>Got it. Thanks for letting us know.</p>
      ) : null}
      {view.intent != null && !readOnly ? (
        <button type="button" className={fw.unsure} disabled={pending} onClick={() => chooseIntent(null)}>
          Clear this answer
        </button>
      ) : null}
    </div>
  );

  const badge = junior
    ? null
    : shown == null
      ? { text: 'Needs an answer', cls: fw.badgeAsk }
      : shown === 'not_coming'
        ? { text: 'Not coming', cls: fw.badgeOut }
        : shown === 'undecided'
          ? { text: 'Not sure yet', cls: fw.badgeChanged }
          : { text: '✓ Coming', cls: fw.badgeComing };
  const head = (
    <div className={fw.cardHead}>
      <h2 className={fw.name} id={`${ids}-teach`}>
        {subject.name ?? subject.firstName}
      </h2>
      <span className={fw.rankLine}>{junior ? 'Helping teach Sunday' : 'Teaching Sunday'}</span>
      {junior ? <Badge tone="info">Junior Leader</Badge> : null}
      {badge ? <span className={`${fw.badge} ${badge.cls}`}>{badge.text}</span> : null}
    </div>
  );

  const liveRegion = (
    <p className={styles.sr} aria-live="polite">
      {pending ? '' : live}
    </p>
  );

  if (view.canAdd && view.intent === 'not_coming') {
    return (
      <section className={fw.teachCard} aria-labelledby={`${ids}-teach`}>
        {head}
        {intentBlock}
        {liveRegion}
      </section>
    );
  }

  if (!view.canAdd) {
    return (
      <section className={fw.teachCard} aria-labelledby={`${ids}-teach`}>
        {head}
        <div className={fw.section}>
        <p className={styles.helper}>
          {subject.isSelf ? 'You’re' : `${subject.firstName} is`} not on the teaching list any more. Remove these, or ask a leader to sign{' '}
          {subject.isSelf ? 'you' : 'them'} up again.
        </p>
        {view.items.map((item) => (
          <div key={`${item.kind}:${item.key}`} className={styles.teachRow}>
            <span className={styles.grow}>
              <b>{item.kind === 'offer' ? `${item.label} (any requirement)` : item.label}</b>
              <small>{item.sub}</small>
            </span>
            {!readOnly && (
              <button type="button" className={styles.linkBtn} onClick={() => remove(item)} aria-label={`${item.kind === 'offer' ? 'Withdraw' : 'Remove'} ${item.label}`}>
                {item.kind === 'offer' ? 'Withdraw' : 'Remove'}
              </button>
            )}
          </div>
        ))}
        {!view.items.length && <p className={styles.emptyLine}>Nothing left to remove.</p>}
        {problem && (
          <p className={styles.badNote} role="alert">
            {problem}
          </p>
        )}
        </div>
        {liveRegion}
      </section>
    );
  }

  const mine = view.wanted.filter((w) => w.qualified);
  const otherWanted = view.wanted.filter((w) => !w.qualified);

  const wantRow = (w: WantedItem) => {
    const bits = [w.codeLabel, minutesText(w.minutes), plural(w.scouts, 'scout'), `asked ${plural(w.weeks, 'week')}`];
    if (w.teachers.length) bits.push(`Teacher: ${w.teachers.join(', ')}`);
    return (
      <div key={w.key} className={styles.teachWrap}>
        <div className={styles.teachRow}>
          <span className={styles.grow}>
            <b>{w.label}</b>
            <small>
              {bits.filter(Boolean).join(' · ')}
              {w.flags.length > 0 && <span className={styles.flag}> · {w.flags.join(' · ')}</span>}
            </small>
            {w.names.length > 0 && <small>{w.names.join(', ')}</small>}
            {w.refused && <small className={styles.flag}>Adults only</small>}
            <TopicParts parts={w.parts} title={w.label} />
          </span>
          {!readOnly && !w.refused && (
            <Button size="sm" variant="secondary" onClick={() => commit(w)}>
              I&rsquo;ll teach this
            </Button>
          )}
        </div>
        {errKey === w.key && (
          <p className={styles.badNote} role="alert">
            {problem}
          </p>
        )}
      </div>
    );
  };

  return (
    <>
      <section className={fw.teachCard} aria-labelledby={`${ids}-teach`}>
        {head}

        <div className={fw.plan}>
          <div className={fw.planHead}>
            <h3 className={fw.planTitle}>
              {you} teaching
              <Saved on={flash.teach > 0} />
            </h3>
            <span className={fw.planSub}>{view.count ? plural(view.count, 'thing') : ''}</span>
          </div>
          {props.teaching && props.teaching.length > 0 && view.intent !== 'not_coming' && (
            <div className={styles.assignCard}>
              <p className={styles.assignHead}>
                So far, {you.replace(/^You/, 'you')} teaching {props.teaching.map((l) => l.title).join(', then ')}
              </p>
              <ul className={styles.assignList}>
                {props.teaching.map((l, i) => (
                  <li key={i}>
                    {l.block && <>{l.block} · </>}
                    <b>{l.title}</b>
                    <span className={styles.meta}>
                      {' '}
                      · {l.codeLabel}
                      {l.minutes != null ? ` · ${minutesText(l.minutes)}` : ''} · {l.scouts.length ? `${plural(l.scouts.length, 'scout')}: ${l.scouts.join(', ')}` : 'no scouts placed yet'}
                    </span>
                    <TopicParts parts={l.parts} title={l.title} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {view.items.length ? (
            <div className={fw.rows}>
              {view.items.map((item) => {
                const bits = [item.sub, minutesText(item.minutes), item.scouts ? `${plural(item.scouts, 'scout')} so far: ${item.names.join(', ')}` : '0 scouts so far'];
                if (item.note) bits.push(item.note);
                if (item.alsoOn.length) bits.push(`also ${item.alsoOn.join(', ')}`);
                return (
                  <div key={`${item.kind}:${item.key}`} className={styles.teachRow}>
                    <span className={styles.grow}>
                      <b>{item.kind === 'offer' ? `${item.label} (any requirement)` : item.label}</b>
                      <small>
                        {item.kind === 'offer' ? 'Your offer · ' : ''}
                        {bits.filter(Boolean).join(' · ')}
                        {item.flags.length > 0 && <span className={styles.flag}> · {item.flags.join(' · ')}</span>}
                      </small>
                      <TopicParts parts={item.parts} title={item.label} />
                    </span>
                    {!readOnly && (
                      <button type="button" className={styles.linkBtn} onClick={() => remove(item)} aria-label={`${item.kind === 'offer' ? 'Withdraw' : 'Remove'} ${item.label}`}>
                        {item.kind === 'offer' ? 'Withdraw' : 'Remove'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className={fw.empty}>Nothing yet.</p>
          )}
          {problem && !errKey && (
            <p className={styles.badNote} role="alert">
              {problem}
            </p>
          )}
          {!readOnly && (
            <div className={fw.offerLine}>
              {draft ? (
                <OfferForm
                  ids={ids}
                  draft={draft}
                  choices={choices}
                  junior={junior}
                  errors={offerErr}
                  pending={pending}
                  onChange={(d) => setDraft(d)}
                  onSubmit={postOffer}
                  onCancel={() => {
                    setDraft(null);
                    setOfferErr({});
                  }}
                />
              ) : (
                <button type="button" className={fw.unsure} onClick={openOffer}>
                  Offer something
                </button>
              )}
            </div>
          )}
        </div>

        {!view.hasSkills && !junior && (
          <div className={fw.section}>
            <p className={fw.doneNote}>
              {subject.isSelf ? (
                <>
                  Tell us what you can teach first: <Link href="/member/teaching">What I can teach</Link>. Or choose Not sure yet and a leader will
                  find you a spot.
                </>
              ) : (
                `${subject.firstName} hasn’t said what they can teach yet.`
              )}
            </p>
          </div>
        )}

        {intentBlock}
        {liveRegion}
      </section>

      <section className={fw.teachCard} aria-labelledby={`${ids}-wanted`}>
        <div className={fw.cardHead}>
          <h2 className={fw.name} id={`${ids}-wanted`}>
            Scouts are asking for these
          </h2>
          {mine.length ? <span className={fw.rankLine}>{plural(mine.length, 'topic')}</span> : null}
        </div>
        <div className={fw.plan}>
          {mine.length ? <div className={fw.rows}>{mine.map(wantRow)}</div> : <p className={fw.empty}>{view.wanted.length ? 'Nothing you can teach is waiting for a teacher.' : 'No picks yet.'}</p>}
          {otherWanted.length > 0 && (
            <details className={fw.more}>
              <summary>
                Other things scouts asked for <span className={fw.planSub}>· {otherWanted.length}</span>
              </summary>
              <p className={fw.notSure}>
                Not in what {subject.isSelf ? 'you’ve' : `${subject.firstName} has`} said {subject.isSelf ? 'you' : 'they'} can teach. You can still take one.
                {subject.isSelf && (
                  <>
                    {' '}
                    <Link href="/member/teaching">What I can teach</Link>
                  </>
                )}
              </p>
              <div className={fw.rows}>{otherWanted.map(wantRow)}</div>
            </details>
          )}
        </div>
      </section>
    </>
  );
}

const TYPES: { type: OfferType; label: string }[] = [
  { type: 'skill', label: 'A skill' },
  { type: 'req', label: 'A requirement' },
  { type: 'ff', label: 'Something else' }
];

function OfferForm({
  ids,
  draft,
  choices,
  junior,
  errors,
  pending,
  onChange,
  onSubmit,
  onCancel
}: {
  ids: string;
  draft: Draft;
  choices: OfferChoices;
  junior: boolean;
  errors: { what?: string; dates?: string };
  pending: boolean;
  onChange: (d: Draft) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  const whatId = `${ids}-offer-what`;
  return (
    <form
      className={styles.offerForm}
      noValidate
      aria-label="Offer something"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div>
        <div className={styles.fieldLabel} id={`${ids}-offer-type`}>
          What
        </div>
        <div className={styles.seg} role="radiogroup" aria-labelledby={`${ids}-offer-type`}>
          {TYPES.map((t) => (
            <button key={t.type} type="button" role="radio" aria-checked={draft.type === t.type} className={styles.segButton} onClick={() => set({ type: t.type })}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className={`${styles.field} ${errors.what ? styles.badBox : ''}`}>
        {draft.type === 'skill' && (
          <>
            <label htmlFor={whatId}>Skill</label>
            <select id={whatId} value={draft.skillId} aria-invalid={!!errors.what} onChange={(e) => set({ skillId: e.target.value })}>
              <option value="">Choose…</option>
              {choices.skills.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <p className={styles.helper}>
              {choices.skills.length
                ? 'Scouts who picked any requirement in this skill get matched to you.'
                : `Nothing in What I can teach yet${junior ? ' that a Junior Leader can teach' : ''}.`}
            </p>
          </>
        )}
        {draft.type === 'req' && (
          <>
            <label htmlFor={whatId}>Requirement</label>
            <select id={whatId} value={draft.key} aria-invalid={!!errors.what} onChange={(e) => set({ key: e.target.value })}>
              <option value="">Choose…</option>
              {choices.requirements.map((g) => (
                <optgroup key={g.rank} label={g.rank}>
                  {g.options.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </>
        )}
        {draft.type === 'ff' && (
          <>
            <label htmlFor={whatId}>What you&rsquo;ll teach</label>
            <input id={whatId} type="text" maxLength={80} value={draft.title} aria-invalid={!!errors.what} onChange={(e) => set({ title: e.target.value })} />
          </>
        )}
      </div>
      {errors.what && <p className={styles.badNote}>{errors.what}</p>}

      <fieldset className={`${styles.field} ${errors.dates ? styles.badBox : ''}`}>
        <legend>Dates</legend>
        <div className={styles.dates}>
          {choices.dates.map((d) => (
            <label key={d.entryId} className={styles.check}>
              <input
                type="checkbox"
                checked={draft.dates.includes(d.entryId)}
                onChange={(e) => set({ dates: e.target.checked ? [...draft.dates, d.entryId] : draft.dates.filter((x) => x !== d.entryId) })}
              />
              {d.label}
            </label>
          ))}
        </div>
        <p className={styles.helper}>Merit badge nights and weeks with no sign-ups aren&rsquo;t listed.</p>
      </fieldset>
      {errors.dates && <p className={styles.badNote}>{errors.dates}</p>}

      <div className={styles.field}>
        <label htmlFor={`${ids}-offer-note`}>
          Note <span className={styles.opt}>(optional)</span>
        </label>
        <textarea id={`${ids}-offer-note`} maxLength={200} value={draft.note} onChange={(e) => set({ note: e.target.value })} />
      </div>

      <div className={styles.formActions}>
        <Button type="submit" disabled={pending}>
          Post offer
        </Button>
        <button type="button" className={styles.linkBtn} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
