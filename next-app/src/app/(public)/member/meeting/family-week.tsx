'use client';

/**
 * This week for a family (Plans/Meeting-Planner-III.md, Decision 5): the meeting's focus and options as last
 * published, each scout's answer (Coming / Not sure yet / Can't make it), and two or three ticks per scout, the
 * suggested ones marked. Any option may be ticked, and "Request something else" picks from the scout's own list.
 * Shared by /member/meeting (signed in) and /i/plan/<token> (the email's link); the caller passes the write.
 * Everything saves on tap; a refusal is said under the control and the control goes back.
 */
import { useState } from 'react';
import type { FamilyOp, FamilyWeek, FamilyWrite } from '@/lib/family-week';
import { PLAN_PICK_CAP } from '@/lib/family-week-shared';
import type { Intent } from '@/lib/meeting-board-shared';
import styles from './family-week.module.css';

const ANSWERS: { intent: Intent; label: string }[] = [
  { intent: 'coming', label: 'Coming' },
  { intent: 'undecided', label: 'Not sure yet' },
  { intent: 'not_coming', label: 'Can’t make it' }
];

export function FamilyWeekView({ week, write, readOnly = false }: { week: FamilyWeek; write: (scoutId: number, op: FamilyOp) => Promise<FamilyWrite>; readOnly?: boolean }) {
  return (
    <div className={styles.wrap}>
      {week.focus.length ? (
        <p className={styles.focus}>
          This week&rsquo;s focus: <strong>{week.focus.join(' + ')}</strong>
        </p>
      ) : (
        <p className={styles.focus}>The plan for this meeting isn&rsquo;t out yet. You can still say who&rsquo;s coming and ask for something.</p>
      )}
      {week.scouts.map((s) => (
        <ScoutWeek key={s.personId} week={week} scout={s} write={write} readOnly={readOnly} />
      ))}
    </div>
  );
}

function ScoutWeek({ week, scout, write, readOnly }: { week: FamilyWeek; scout: FamilyWeek['scouts'][number]; write: (scoutId: number, op: FamilyOp) => Promise<FamilyWrite>; readOnly: boolean }) {
  const [intent, setIntent] = useState<Intent | null>(scout.intent);
  const [picks, setPicks] = useState<string[]>(scout.picks);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [asking, setAsking] = useState(false);
  const suggested = new Set(scout.suggested);
  const optionKeys = new Set(week.options.map((o) => o.key));
  const requests = picks.filter((k) => !optionKeys.has(k));
  const term = q.trim().toLowerCase();
  const found = term ? scout.requestable.filter((r) => !picks.includes(r.key) && `${r.codeLabel} ${r.label}`.toLowerCase().includes(term)).slice(0, 12) : scout.requestable.filter((r) => !picks.includes(r.key)).slice(0, 8);

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
  const answer = (next: Intent) => {
    const prev = intent;
    void run({ op: 'intent', intent: next }, () => setIntent(next), () => setIntent(prev));
  };
  const toggle = (key: string, on: boolean) => {
    const prev = picks;
    if (on && picks.length >= PLAN_PICK_CAP) {
      setError(`Pick up to ${PLAN_PICK_CAP} things. Untick one first.`);
      return;
    }
    void run(
      { op: 'pick', key, on },
      () => {
        setPicks(on ? [...prev, key] : prev.filter((k) => k !== key));
        if (on && intent == null) setIntent('coming');
      },
      () => setPicks(prev)
    );
  };
  const wordsOf = (key: string) => scout.words[key] ?? scout.requestable.find((r) => r.key === key) ?? { label: key, codeLabel: '' };

  return (
    <section className={styles.scout} aria-labelledby={`fw-${scout.personId}`}>
      <h2 id={`fw-${scout.personId}`} className={styles.name}>
        {scout.firstName}
      </h2>
      <div className={styles.seg} role="radiogroup" aria-label={`Is ${scout.firstName} coming?`}>
        {ANSWERS.map((a) => (
          <button key={a.intent} type="button" role="radio" aria-checked={intent === a.intent} className={styles.segBtn} disabled={readOnly || busy} onClick={() => answer(a.intent)}>
            {a.label}
          </button>
        ))}
      </div>
      {intent === 'not_coming' ? null : (
        <>
          <p className={styles.ask}>
            Pick two or three things to work on ({picks.length} of {PLAN_PICK_CAP}).
          </p>
          {week.options.length ? (
            <ul className={styles.options}>
              {week.options.map((o) => {
                const on = picks.includes(o.key);
                return (
                  <li key={o.key}>
                    <label className={on ? styles.optionOn : styles.option}>
                      <input type="checkbox" checked={on} disabled={readOnly || busy} onChange={(e) => toggle(o.key, e.target.checked)} />
                      <span className={styles.optionMain}>
                        <span className={styles.optionTitle}>{o.title}</span>
                        {o.items?.length ? (
                          <span className={styles.optionItems}>
                            {o.items.map((i) => (
                              <span key={i}>{i}</span>
                            ))}
                          </span>
                        ) : (
                          <span className={styles.optionSub}>{o.sub}</span>
                        )}
                        {o.teacher ? <span className={styles.optionSub}>with {o.teacher}</span> : null}
                      </span>
                      {suggested.has(o.key) ? <span className={styles.suggested}>Suggested for {scout.firstName}</span> : null}
                    </label>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {requests.length ? (
            <ul className={styles.options}>
              {requests.map((k) => {
                const w = wordsOf(k);
                return (
                  <li key={k}>
                    <label className={styles.optionOn}>
                      <input type="checkbox" checked disabled={readOnly || busy} onChange={() => toggle(k, false)} />
                      <span className={styles.optionMain}>
                        <span className={styles.optionTitle}>{w.label}</span>
                        <span className={styles.optionSub}>{[w.codeLabel, 'asked for'].filter(Boolean).join(' · ')}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {readOnly ? null : (
            <div className={styles.request}>
              <button type="button" className={styles.link} aria-expanded={asking} onClick={() => setAsking(!asking)}>
                {asking ? 'Close' : 'Request something else'}
              </button>
              {asking ? (
                <>
                  <input className={styles.search} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Requirement or merit badge…" aria-label={`Find something for ${scout.firstName}`} />
                  <ul className={styles.found}>
                    {found.length ? null : <li className={styles.optionSub}>Nothing matches.</li>}
                    {found.map((r) => (
                      <li key={r.key}>
                        <button type="button" className={styles.foundBtn} disabled={busy} onClick={() => toggle(r.key, true)}>
                          <span className={styles.optionTitle}>{r.label}</span>
                          <span className={styles.optionSub}>{r.codeLabel}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          )}
        </>
      )}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
