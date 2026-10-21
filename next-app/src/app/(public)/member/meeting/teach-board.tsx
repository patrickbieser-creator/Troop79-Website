'use client';

/**
 * "Teach at a meeting" (Phase 2 of Plans/Meeting-Requests-And-Teaching-Offers.md; prototype
 * prototypes/meeting-board/meeting.html, teach section). For adults (leaders and parents alike) and Junior Leaders.
 *
 *   - Adults answer Coming / Not sure yet ("We'll find something that fits": a leader puts them where they're needed) /
 *     Can't make it here. A Junior Leader answers once, in their scout section above, and this section follows it.
 *   - "You're teaching (n of 2)": what they've taken on, with how many scouts asked so far. A broad skill offer is one
 *     of the two.
 *   - "Scouts are asking for these": every topic scouts asked for, the ones with no teacher first, with how many and
 *     who. "I'll teach this" saves on tap; a third says in place "You're teaching 2. Remove one to add another."
 *     Topics outside the person's teaching skills sit under "Other things scouts asked for" and can still be taken,
 *     flagged (matcher rule 1); an adults-only skill has no button for a Junior Leader.
 *   - "Offer something": a skill, a requirement or something else, on one or more dates, with a note. Each date is its
 *     own commitment. Problems are marked in place.
 *   - Phase 3b, a merit badge night: the badge's stations instead, each with "I'll take this station" (one of the two;
 *     the counselor flag applies), and for a station they teach, which group comes in each rotation. Anything else they
 *     signed up for this week shows as held for a regular meeting, with Remove.
 */
import { useId, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/app/_components/button';
import { Badge } from '@/app/_components/badge';
import { INTENT_LABEL, type Intent } from '@/lib/meeting-board-shared';
import { MAX_COMMITMENTS, TEACH_FULL } from '@/lib/meeting-board-teach';
import { minutesText } from '@/lib/meeting-board-picklist';
import type { OfferChoices, TeachItem, TeachView, WantedItem } from '@/lib/meeting-board-supply';
import type { MatchLine } from '@/lib/meeting-board-match';
import type { StationTeachLine } from '@/lib/meeting-board-rotations';
import { IntentControl, Saved } from './scout-board';
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

const FLASH_MS = 1800;

export interface TeachBoardProps {
  entryId: number;
  mode: 'rank' | 'merit_badge';
  subject: { personId: number; firstName: string; isSelf: boolean };
  initial: TeachView;
  choices: OfferChoices;
  onBehalf: boolean;
  readOnly: boolean;
  /** Phase 3a: the sessions the live match has this person teaching so far, by block. Empty once the agenda is
   *  published (the page links to it). */
  teaching?: MatchLine[];
  /** Phase 3b, a merit badge night: its stations as this person sees them (rotation order only on their own, and only
   *  until the agenda is published). */
  stations?: StationTeachLine[];
  mbName?: string | null;
  /** "sign-off needs a counselor" when this person isn't a counselor for the night's badge. */
  stationFlags?: string[];
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

  function chooseIntent(next: Intent) {
    if (next === view.intent) return;
    run(() => meetingTeacherIntentAction({ ...target, intent: next }), { what: 'intent', say: `Saved: ${INTENT_LABEL[next]}` });
  }

  function commit(w: WantedItem) {
    if (readOnly) return;
    if (view.count >= MAX_COMMITMENTS) {
      setErrKey(w.key);
      setProblem(null);
      setLive(TEACH_FULL);
      return;
    }
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

  const intentBlock = junior || !view.canAdd ? null : (
    <IntentControl
      groupName={`${ids}-teach-intent`}
      label={subject.isSelf ? 'Are you coming?' : `Is ${subject.firstName} coming?`}
      value={view.intent}
      implied={view.intent == null && view.count > 0}
      options={['coming', 'undecided', 'not_coming']}
      helper={view.intent === 'undecided' ? 'We’ll find something that fits.' : view.intent === 'not_coming' ? 'Got it. Thanks for letting us know.' : null}
      saved={flash.intent > 0}
      disabled={readOnly}
      onChange={chooseIntent}
    />
  );

  const head = (
    <h2 className={styles.teachHead} id={`${ids}-teach`}>
      {junior ? 'Help teach' : 'Teach at a meeting'}
      {junior && <Badge tone="info">Junior Leader</Badge>}
    </h2>
  );

  const liveRegion = (
    <p className={styles.sr} aria-live="polite">
      {pending ? '' : live}
    </p>
  );

  if (view.canAdd && props.mode === 'merit_badge' && view.intent !== 'not_coming') {
    const stations = props.stations ?? [];
    const stationKeys = new Set(stations.map((s) => s.key));
    const held = view.items.filter((i) => !(i.kind === 'topic' && stationKeys.has(i.key)));
    const take = (s: StationTeachLine) => {
      if (readOnly) return;
      if (view.count >= MAX_COMMITMENTS) {
        setErrKey(s.key);
        setProblem(null);
        setLive(TEACH_FULL);
        return;
      }
      run(() => meetingTeachAction({ ...target, key: s.key }), { what: 'teach', say: `Saved. ${you} teaching ${s.title}.`, errorAt: s.key });
    };
    const drop = (s: StationTeachLine) => run(() => meetingUnteachAction({ ...target, key: s.key }), { what: 'teach', say: 'Saved. Removed.' });
    return (
      <section className={styles.teach} aria-labelledby={`${ids}-teach`}>
        {head}
        {intentBlock}
        <div className={errKey && view.count >= MAX_COMMITMENTS ? styles.badBox : undefined}>
          <h3 className={styles.groupHead}>
            <span>
              {props.mbName ? `${props.mbName} stations` : 'Stations'}
              <Saved on={flash.teach > 0} />
            </span>
            <span className={styles.meta}>
              {view.count} of {MAX_COMMITMENTS}
            </span>
          </h3>
          {stations.length ? (
            stations.map((s) => (
              <div key={s.key} className={styles.teachWrap}>
                <div className={styles.teachRow}>
                  <span className={styles.grow}>
                    <b>
                      {s.index + 1}. {s.title}
                    </b>
                    <small>
                      {[s.place, s.codes, s.others.length ? `Teacher: ${s.others.join(', ')}` : s.mine ? null : 'No teacher yet'].filter(Boolean).join(' · ')}
                      {s.mine && props.stationFlags && props.stationFlags.length > 0 && <span className={styles.flag}> · {props.stationFlags.join(' · ')}</span>}
                    </small>
                    {s.mine && s.visits.length > 0 && (
                      <ul className={styles.assignList}>
                        {s.visits.map((v) => (
                          <li key={v}>{v}</li>
                        ))}
                      </ul>
                    )}
                  </span>
                  {!readOnly &&
                    (s.mine ? (
                      <button type="button" className={styles.linkBtn} onClick={() => drop(s)} aria-label={`Remove ${s.title}`}>
                        Remove
                      </button>
                    ) : (
                      <Button size="sm" variant="secondary" onClick={() => take(s)}>
                        I&rsquo;ll take this station
                      </Button>
                    ))}
                </div>
                {errKey === s.key && (
                  <p className={styles.badNote} role="alert">
                    {problem ?? TEACH_FULL}
                  </p>
                )}
              </div>
            ))
          ) : (
            <p className={styles.emptyLine}>A leader hasn&rsquo;t set up the stations yet. You can take one once they&rsquo;re posted.</p>
          )}
          {problem && !errKey && (
            <p className={styles.badNote} role="alert">
              {problem}
            </p>
          )}
        </div>
        {held.length > 0 && (
          <div className={styles.group}>
            <h3 className={styles.groupHead}>Held for a regular meeting</h3>
            {held.map((item) => (
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
          </div>
        )}
        {liveRegion}
      </section>
    );
  }

  if (view.canAdd && (view.intent === 'not_coming' || props.mode === 'merit_badge')) {
    return (
      <section className={styles.teach} aria-labelledby={`${ids}-teach`}>
        {head}
        {intentBlock}
        {liveRegion}
      </section>
    );
  }

  if (!view.canAdd) {
    return (
      <section className={styles.teach} aria-labelledby={`${ids}-teach`}>
        {head}
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
            {problem ?? TEACH_FULL}
          </p>
        )}
      </div>
    );
  };

  return (
    <section className={styles.teach} aria-labelledby={`${ids}-teach`}>
      {head}
      {intentBlock}

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

      <div className={errKey && view.count >= MAX_COMMITMENTS ? styles.badBox : undefined}>
        <h3 className={styles.groupHead}>
          <span>
            {you} teaching
            <Saved on={flash.teach > 0} />
          </span>
          <span className={styles.meta}>
            {view.count} of {MAX_COMMITMENTS}
          </span>
        </h3>
        {view.items.length ? (
          view.items.map((item) => {
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
          })
        ) : (
          <p className={styles.emptyLine}>Nothing yet. You&rsquo;ll teach one or two things.</p>
        )}
        {problem && !errKey && (
          <p className={styles.badNote} role="alert">
            {problem}
          </p>
        )}
      </div>

      {!view.hasSkills && !junior && (
        <div className={styles.notice}>
          <p>
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

      <div className={styles.group}>
        <h3 className={styles.groupHead}>Scouts are asking for these</h3>
        {mine.length ? mine.map(wantRow) : <p className={styles.emptyLine}>{view.wanted.length ? 'Nothing you can teach is waiting for a teacher.' : 'No picks yet.'}</p>}
      </div>
      {otherWanted.length > 0 && (
        <details className={styles.group}>
          <summary>
            Other things scouts asked for
            <span className={styles.meta}>{otherWanted.length}</span>
          </summary>
          <p className={styles.helper}>
            Not in what {subject.isSelf ? 'you’ve' : `${subject.firstName} has`} said {subject.isSelf ? 'you' : 'they'} can teach. You can still take one.
            {subject.isSelf && (
              <>
                {' '}
                <Link href="/member/teaching">What I can teach</Link>
              </>
            )}
          </p>
          {otherWanted.map(wantRow)}
        </details>
      )}

      {!readOnly &&
        (draft ? (
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
          <p className={styles.group}>
            <Button variant="secondary" onClick={openOffer}>
              Offer something
            </Button>
          </p>
        ))}
      {liveRegion}
    </section>
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
