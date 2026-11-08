'use client';

/**
 * The Emails screen (Plans/Meeting-Planner-III-Emails.md, E3), laid out as prototypes/meeting-plan-III/Emails.dc.html:
 *   - A header band: the title, the lede, who emails come from (the planner tabs are the way back), and the
 *     tabs (Scouts and families · Teachers · Coming? reminders · Sent log) with their counts.
 *   - The send bar: how many EMAILS are selected across all tabs (siblings with the same parents share one), the
 *     tab's counts (sent · opened · not sent yet · can't send), Select all not sent yet, Clear, Review and send.
 *   - The inline confirmation: every recipient as a pill, "one at a time", what answers do, Send N now / Cancel.
 *   - The list (rank-coloured name, what it's about, who it goes to, a status pill) beside a sticky preview (To with a
 *     tick per recipient, the subject, the body, the answer buttons, Edit this email) and the person's History.
 *   - The Sent log: one line per email, with Send again for one that failed, didn't report back, or bounced.
 * Nothing sends without a Send press (no schedule: Q5). Emails go out one at a time while the page is open; a send cut
 * short shows "N emails didn't finish sending · Send them now". "How this works" states every limit.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { fmtClock, fmtDateTime, fmtDay, fmtWhen } from '@/lib/format-date';
import { PLAN_MAX, PLAN_MAX_MIN } from '@/lib/family-week-shared';
import { peopleWords, planButtons, renderHouseholdEmail, TRACKING_LINE } from '@/lib/meeting-email-build';
import { renderTeacherEmail, TEACHER_EMAIL_BUTTON } from '@/lib/meeting-invite-email';
import type { EmailScreen, LogLine, QueueRequest, ScreenRecipient, ScreenRow } from '@/lib/meeting-email-screen';
import { answerTone } from '@/lib/meeting-email-log';
import { emailsQueueAction, emailsRequeueAction, emailsSendNextAction } from './actions';
import s from './emails.module.css';

type Tab = 'scouts' | 'teachers' | 'reminders' | 'log';
type Filter = 'all' | 'new' | 'sent';
type Tone = 'ok' | 'open' | 'muted' | 'bad' | 'new' | 'info';

/** One email the current selection makes: a recipient, the rows it covers, and its one-off wording. */
interface Planned {
  key: string;
  req: QueueRequest;
  toName: string;
  email: string;
  rows: ScreenRow[];
}

const TABS: { key: Tab; label: string }[] = [
  { key: 'scouts', label: 'Scouts and families' },
  { key: 'teachers', label: 'Teachers' },
  { key: 'reminders', label: 'Coming? reminders' },
  { key: 'log', label: 'Sent log' }
];
const HINTS: Record<Exclude<Tab, 'log'>, string> = {
  scouts: 'One email per scout, to their parents and to the scout if they’re 13 or older. Brothers and sisters share one email. It tells them the group and requirements already on the plan.',
  teachers: 'Adults asked to teach a group. Groups with no teacher yet come first; only people whose teaching skills fit are listed.',
  reminders: 'People who haven’t said whether they’re coming Sunday.'
};
const COLUMNS: Record<Exclude<Tab, 'log'>, [string, string]> = {
  scouts: ['Scout', 'Invited to'],
  teachers: ['Teacher', 'Asked to teach'],
  reminders: ['Who', 'About']
};
/** How often the Sent log refreshes while it's open. */
const LOG_REFRESH_MS = 30_000;
const KIND_WORD = { plan: 'Scout invite', teacher: 'Teacher invite', reminder: 'Reminder' } as const;

function status(r: ScreenRow): { label: string; tone: Tone; k: 'new' | 'sent' | 'blocked'; opened: boolean } {
  if (r.blocked) return { label: `Can’t send · ${r.blocked}`, tone: 'bad', k: 'blocked', opened: false };
  if (r.answer === 'Answered yes') return { label: 'Answered yes', tone: 'ok', k: 'sent', opened: true };
  if (r.answer === 'Said not this week') return { label: 'Said not this week', tone: 'muted', k: 'sent', opened: true };
  if (r.answer === 'Changed since yes') return { label: 'Plan changed since they said yes', tone: 'bad', k: 'sent', opened: true };
  if (r.state === 'new') return { label: 'Not sent yet', tone: 'new', k: 'new', opened: false };
  if (r.state === 'queued' || r.state === 'sending') return { label: 'Sending…', tone: 'info', k: 'sent', opened: false };
  if (r.state === 'failed' || r.delivery === 'bounced') return { label: `Failed · ${r.delivery === 'bounced' ? 'address bounced' : (r.failure ?? 'didn’t go out')}`, tone: 'bad', k: 'sent', opened: false };
  if (r.state === 'unknown') return { label: 'Unknown · check before sending again', tone: 'bad', k: 'sent', opened: false };
  if (r.changed) return { label: 'Plan changed since sent', tone: 'bad', k: 'sent', opened: !!r.openedAt };
  if (r.openedAt) return { label: `Opened ${fmtDateTime(r.openedAt)}`, tone: 'open', k: 'sent', opened: true };
  return { label: `Sent ${r.sentAt ? fmtDateTime(r.sentAt) : ''} · not opened`, tone: 'ok', k: 'sent', opened: false };
}

/** A bounce reason, short: the receiving server's words without Resend's prefix ('Permanent · General: smtp; …'). */
function shortReason(reason: string): string {
  const words = reason.replace(/^(Permanent|Transient|Undetermined)[^:]*:\s*/i, '').replace(/^smtp;\s*/i, '');
  return words.length > 90 ? `${words.slice(0, 89)}…` : words;
}

function logResult(l: LogLine): { label: string; tone: Tone; title?: string } {
  if (l.status === 'queued' || l.status === 'sending') return { label: 'Queued', tone: 'info' };
  if (l.status === 'failed') return { label: `Failed · ${l.failure ?? ''}`, tone: 'bad' };
  if (l.status === 'unknown') return { label: 'Unknown · check before sending again', tone: 'bad' };
  if (l.status === 'retried') return { label: 'Sent again', tone: 'muted' };
  if (l.delivery === 'bounced' && l.bounceReason) return { label: `Failed · bounced: ${shortReason(l.bounceReason)}`, tone: 'bad', title: l.bounceReason };
  if (l.delivery === 'bounced' || l.delivery === 'complained') return { label: `Failed · ${l.delivery === 'bounced' ? 'address bounced' : 'marked as spam'}`, tone: 'bad' };
  const landed = l.delivery === 'delivered' ? `Delivered ${fmtClock(l.deliveredAt ?? l.sentAt)}` : `Sent ${fmtClock(l.sentAt)}`;
  if (!l.openedAt) return { label: `${landed} · not opened`, tone: 'info' };
  // The open's day only when it isn't the day it went.
  const opened = fmtDay(l.openedAt) === fmtDay(l.sentAt ?? l.at) ? fmtClock(l.openedAt) : fmtWhen(l.openedAt);
  return { label: `${landed} · Opened ${opened}`, tone: 'open' };
}

/** The preview reads as the email reads: bold marks dropped, a link shown as its words, and the template's own
 *  button line left out (the answer buttons sit under the body). */
const plain = (md: string) =>
  md
    .replace(/^\*\*\[[^\]]*\]\([^)]*\)\*\*\s*$/gm, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const roleOf = (row: ScreenRow, r: ScreenRecipient) => (r.isScout ? 'Scout · 13 or older' : row.isScout ? 'Parent' : 'Adult leader');
const listOf = (names: readonly string[]) => (names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

export function EmailsClient({ screen, day }: { screen: EmailScreen; day: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('scouts');
  const [filter, setFilter] = useState<Filter>('all');
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  // Recipients a planner unticked in the preview, by row id.
  const [left, setLeft] = useState<Record<string, number[]>>({});
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [focusId, setFocusId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; failed: number } | null>(null);
  // The Sent log keeps itself current (deliveries, opens, answers) while it's open: a refresh every 30 s, never during
  // a send and never in a hidden tab (Patrick, 2026-11-01: "it's not being updated").
  useEffect(() => {
    if (tab !== 'log' || progress) return;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, LOG_REFRESH_MS);
    return () => clearInterval(t);
  }, [tab, progress, router]);
  const [flash, setFlash] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const rowsOf = (t: Tab): ScreenRow[] => (t === 'scouts' ? screen.scouts : t === 'teachers' ? screen.teachers : t === 'reminders' ? screen.reminders : []);
  const all = rowsOf(tab);
  const shown = all.filter((r) => (filter === 'new' ? status(r).k === 'new' : filter === 'sent' ? status(r).k === 'sent' : true));
  const counts = { sent: 0, opened: 0, new: 0, blocked: 0 };
  for (const r of all) {
    const x = status(r);
    counts[x.k]++;
    if (x.opened) counts.opened++;
  }

  // The selection across every tab, as emails: one per recipient per kind (per group for a teacher).
  const planned: Planned[] = useMemo(() => {
    const byKey = new Map<string, Planned>();
    for (const r of [...screen.scouts, ...screen.teachers, ...screen.reminders]) {
      if (!ticked.has(r.id) || r.blocked) continue;
      for (const to of r.recipients) {
        if ((left[r.id] ?? []).includes(to.personId)) continue;
        const key = `${r.kind}|${to.personId}|${r.kind === 'teacher' ? r.group : ''}`;
        const p = byKey.get(key) ?? {
          key,
          req: { kind: r.kind, recipientId: to.personId, ...(r.kind === 'teacher' ? { group: r.group ?? undefined } : { scoutIds: [] }) },
          toName: to.name,
          email: to.email,
          rows: []
        };
        if (r.isScout && r.kind !== 'teacher') p.req.scoutIds = [...(p.req.scoutIds ?? []), r.personId];
        p.rows.push(r);
        p.req.override = p.rows.map((x) => overrides[x.id]).find(Boolean) ?? null;
        // A row already emailed, ticked again, is a deliberate resend.
        if (p.rows.some((x) => x.state !== 'new')) p.req.resend = true;
        byKey.set(key, p);
      }
    }
    return [...byKey.values()];
  }, [screen, ticked, left, overrides]);
  const n = Math.min(planned.length, screen.cap);
  const over = planned.length - n;

  const toggle = (id: string) => {
    setConfirming(false);
    setFlash(null);
    setTicked((t) => (t.has(id) ? new Set([...t].filter((x) => x !== id)) : new Set([...t, id])));
  };

  async function drain(batchId: string, total: number) {
    let done = 0;
    let failed = 0;
    setProgress({ done, total, failed });
    for (;;) {
      const res = await emailsSendNextAction({ entryId: screen.entryId, batchId }).catch(() => null);
      if (!res || !res.ok) {
        setProblem(res && !res.ok ? res.error : 'The connection dropped. The rest stay queued: Send them now picks up where this stopped.');
        break;
      }
      if (res.done) break;
      done++;
      if (res.status !== 'sent') failed++;
      setProgress({ done, total, failed });
    }
    setProgress(null);
    setFlash(`✓ Sent ${done - failed} email${done - failed === 1 ? '' : 's'}${failed ? `; ${failed} didn’t go (see the Sent log)` : ''}. Each email is in the Sent log.`);
    router.refresh();
  }

  async function send() {
    setConfirming(false);
    setProblem(null);
    const res = await emailsQueueAction({ entryId: screen.entryId, emails: planned.slice(0, screen.cap).map((p) => p.req) });
    if (!res.ok) return setProblem(res.error);
    setTicked(new Set());
    const notes = [res.overflow ? `${res.overflow} over the ${screen.cap} limit weren’t queued.` : '', res.refused.length ? `Not sent: ${res.refused.join('; ')}.` : ''].filter(Boolean).join(' ');
    if (notes) setProblem(notes);
    await drain(res.batchId, res.queued);
  }

  async function sendAgain(ids: number[]) {
    setProblem(null);
    const res = await emailsRequeueAction({ entryId: screen.entryId, ids });
    if (!res.ok) return setProblem(res.error);
    await drain(res.batchId, res.queued);
  }

  const focus = all.find((r) => r.id === focusId) ?? all.find((r) => !r.blocked) ?? all[0] ?? null;
  const [colWho, colWhat] = tab === 'log' ? ['', ''] : COLUMNS[tab];
  const unfinished = screen.unfinished.reduce((x, u) => x + u.queued, 0);

  return (
    <div className={s.screen}>
      <header className={s.band}>
        <div className={s.bandTop}>
          <div className={s.bandText}>
            <h1 className={s.title}>Emails for {day}</h1>
            <p className={s.lede}>Nothing goes out until you send it. Tick the emails you want, check the preview, then send. Every email is logged with who it went to and when.</p>
          </div>
          <div className={s.bandSide}>
            <span className={s.from}>
              From <strong>Troop 79 Bugler</strong> · replies go to leaders, not this address
            </span>
          </div>
        </div>
        <div className={s.tabs} role="tablist" aria-label="Email kinds">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={tab === t.key ? s.tabOn : s.tab}
              onClick={() => {
                setTab(t.key);
                setFocusId(null);
                setEditing(false);
                setFilter('all');
              }}
            >
              {t.label} <span className={s.tabCount}>{t.key === 'log' ? screen.log.length : rowsOf(t.key).length}</span>
            </button>
          ))}
        </div>
      </header>

      <main className={s.main}>
        {unfinished && !progress ? (
          <div className={s.strip} role="status">
            {unfinished} email{unfinished === 1 ? '' : 's'} didn&rsquo;t finish sending.{' '}
            <button type="button" className={s.link} onClick={() => void Promise.all(screen.unfinished.map((u) => drain(u.batchId, u.queued)))}>
              Send them now
            </button>
          </div>
        ) : null}

        <section aria-label="Send" className={s.sendBar}>
          <div className={s.selected}>
            <span className={s.selNum}>{planned.length}</span>
            <span>{planned.length === 1 ? 'email selected' : 'emails selected · across all tabs'}</span>
          </div>
          {tab !== 'log' ? (
            <div className={s.counts}>
              <span>
                <strong className={s.cOk}>{counts.sent}</strong>{' '}
                sent
              </span>
              <span>
                <strong className={s.cOpen}>{counts.opened}</strong>{' '}
                opened
              </span>
              <span>
                <strong className={s.cNew}>{counts.new}</strong>{' '}
                not sent yet
              </span>
              <span>
                <strong className={s.cBad}>{counts.blocked}</strong>{' '}
                can&rsquo;t send
              </span>
            </div>
          ) : null}
          <div className={s.sendActions}>
            {tab !== 'log' ? (
              <>
                <button type="button" className={s.link} onClick={() => setTicked((t) => new Set([...t, ...all.filter((r) => status(r).k === 'new').map((r) => r.id)]))}>
                  Select all not sent yet
                </button>
                <button
                  type="button"
                  className={s.link}
                  onClick={() => {
                    setTicked(new Set());
                    setConfirming(false);
                  }}
                >
                  Clear
                </button>
              </>
            ) : null}
            <button type="button" className={s.primary} disabled={!planned.length || !!progress} onClick={() => setConfirming(true)}>
              {planned.length ? `Review and send ${planned.length} email${planned.length === 1 ? '' : 's'}` : 'Select emails to send'}
            </button>
          </div>
        </section>

        {confirming ? (
          <section className={s.confirm} role="region" aria-labelledby="confirm-h">
            <h2 id="confirm-h" className={s.confirmTitle}>
              Send {n} email{n === 1 ? '' : 's'} to these people?
            </h2>
            <div className={s.pills}>
              {planned.slice(0, screen.cap).map((p) => (
                <span key={p.key} className={s.pill} title={p.email}>
                  {p.toName}
                  {p.rows.length > 1 ? ` (${listOf(p.rows.map((r) => r.name))})` : ''}
                </span>
              ))}
            </div>
            <p className={s.fine}>
              Emails go out one at a time. Each one shows in the Sent log as it lands, or as failed with the reason. {n} of a {screen.cap}-email limit per send.
            </p>
            {over ? <p className={s.overNote}>{over} more are over the limit and won&rsquo;t be sent this time. Send them next.</p> : null}
            <div className={s.groupNote}>
              Sending doesn&rsquo;t change the plan. Answers do: &ldquo;Not this week&rdquo; takes a scout out of their group, &ldquo;Pick something else&rdquo; opens their plan to change, and a
              teacher&rsquo;s yes fills the group&rsquo;s teacher slot.
            </div>
            <div className={s.confirmActions}>
              <button type="button" className={s.primary} onClick={() => void send()}>
                Send {n} now
              </button>
              <button type="button" className={s.secondary} onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </div>
          </section>
        ) : null}

        {progress ? (
          <div className={s.flash} role="status">
            Sending {progress.done} of {progress.total}
            {progress.failed ? ` · ${progress.failed} didn’t go` : ''}… Keep this page open.
          </div>
        ) : flash ? (
          <div className={s.flash} role="status">
            {flash}
          </div>
        ) : null}
        {problem ? (
          <div className={s.problem} role="alert">
            {problem}
          </div>
        ) : null}

        {tab === 'log' ? (
          <SentLog log={screen.log} busy={!!progress} onSendAgain={(ids) => void sendAgain(ids)} />
        ) : (
          <div className={s.columns}>
            <section aria-label={TABS.find((t) => t.key === tab)?.label} className={s.listCard}>
              <div className={s.listHead}>
                <span className={s.hint}>{HINTS[tab]}</span>
                <div role="group" aria-label="Show" className={s.seg}>
                  {(
                    [
                      ['all', 'Everyone'],
                      ['new', 'Not sent yet'],
                      ['sent', 'Sent']
                    ] as const
                  ).map(([k, label]) => (
                    <button key={k} type="button" aria-pressed={filter === k} className={filter === k ? s.segOn : s.segBtn} onClick={() => setFilter(k)}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className={s.scroll}>
                <div className={s.table}>
                  <div className={s.gridHead}>
                    <span />
                    <span>{colWho}</span>
                    <span>{colWhat}</span>
                    <span>Goes to</span>
                    <span>Status</span>
                  </div>
                  {shown.map((r) => {
                    const st = status(r);
                    const on = ticked.has(r.id);
                    const active = r.recipients.filter((x) => !(left[r.id] ?? []).includes(x.personId));
                    return (
                      <div key={r.id} className={`${s.gridRow} ${focus?.id === r.id ? s.rowFocus : on ? s.rowOn : ''}`}>
                        <span className={s.checkCell}>
                          <input type="checkbox" checked={on} disabled={!!r.blocked || !!progress} onChange={() => toggle(r.id)} aria-label={`Include the email about ${r.name}`} />
                        </span>
                        <button
                          type="button"
                          className={s.nameBtn}
                          aria-pressed={focus?.id === r.id}
                          onClick={() => {
                            setFocusId(r.id);
                            setEditing(false);
                          }}
                        >
                          <span className={`${s.chip} ${r.isScout ? (s[`rank-${r.rank ?? 'new'}`] ?? '') : s.adult}`}>{r.name}</span>
                        </button>
                        <span className={s.what}>{r.about}</span>
                        <span className={s.to}>
                          {active.length ? active.map((x) => x.name).join(', ') : r.recipients.length ? 'No one ticked' : ''}
                          {active.length && r.copies?.length ? ` · copies ${listOf(r.copies.map((c) => c.name))}` : ''}
                        </span>
                        <span className={`${s.status} ${s[`tone-${st.tone}`]}`}>{st.label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              {shown.length ? null : <div className={s.empty}>No one matches this filter.</div>}
            </section>

            {focus ? (
              <Preview
                row={focus}
                screen={screen}
                day={day}
                planned={planned}
                left={left[focus.id] ?? []}
                setLeft={(ids) => setLeft((l) => ({ ...l, [focus.id]: ids }))}
                override={overrides[focus.id] ?? null}
                setOverride={(v) => setOverrides((o) => (v == null ? Object.fromEntries(Object.entries(o).filter(([k]) => k !== focus.id)) : { ...o, [focus.id]: v }))}
                editing={editing}
                setEditing={setEditing}
              />
            ) : null}
          </div>
        )}

        <details className={s.how}>
          <summary>How this works</summary>
          <ul>
            <li>Nothing sends until an adult presses Send, and nothing is ticked to start with.</li>
            <li>One Send reaches at most {screen.cap} emails. Anything over that is listed and left unsent.</li>
            <li>Emails go out one at a time while this page is open. If it closes partway, the rest wait here until someone presses Send them now.</li>
            <li>A send that doesn&rsquo;t report back reads Unknown: it may still have arrived, so check before sending it again.</li>
            <li>Someone already emailed isn&rsquo;t emailed again unless you tick their row again on purpose.</li>
            <li>Brothers and sisters with the same parents get one email. Scouts 13 and older with a verified address get their own copy.</li>
            <li>Sending never changes the plan. Answers do: Can&rsquo;t make it takes a scout out of their group, a family&rsquo;s changes come off the plan, and a teacher&rsquo;s yes adds them to the group.</li>
            <li>
              A scout&rsquo;s plan holds up to {PLAN_MAX} things and {PLAN_MAX_MIN} minutes. Requests only flag the scout for the planners.
            </li>
            <li>Each family link works until 6:00 PM on the meeting day. Only the newest email&rsquo;s link works: sending again closes the older one.</li>
            <li>Troop 79 can see when an email is opened, and every email says so. Some phones open emails on their own, so Opened is a hint, not proof.</li>
          </ul>
        </details>
      </main>
    </div>
  );
}

function Preview({
  row,
  screen,
  day,
  planned,
  left,
  setLeft,
  override,
  setOverride,
  editing,
  setEditing
}: {
  row: ScreenRow;
  screen: EmailScreen;
  day: string;
  planned: Planned[];
  left: number[];
  setLeft: (ids: number[]) => void;
  override: string | null;
  setOverride: (v: string | null) => void;
  editing: boolean;
  setEditing: (v: boolean) => void;
}) {
  const active = row.recipients.filter((r) => !left.includes(r.personId));
  // Nobody ticked still reads as the people it would go to: the preview is what each of them would get.
  const greet = listOf((active.length ? active : row.recipients).map((r) => screen.firstNames[r.personId] ?? r.name.split(' ')[0]));
  const shares = planned.find((p) => p.rows.some((r) => r.id === row.id) && p.rows.length > 1);
  let subject = '';
  let body = '';
  let buttons: string[] = [];
  if (row.kind === 'teacher') {
    const g = screen.groupWords[row.group ?? ''];
    // A planned teacher's email asks them to confirm (Confirmations C-D1); anyone else is asked whether they can.
    const base = row.planned ? screen.templates.teacherPlanned : screen.templates.teacher;
    const t = override != null ? { ...base, body: override } : base;
    // The same renderer the send uses (lib/meeting-email-prepare), so the preview is the email.
    const r = renderTeacherEmail(t, { name: greet, day }, { title: g?.title ?? '', codes: g?.codes ?? '', minutes: g?.minutes ?? '', scouts: g?.scouts ?? [] }, { planned: !!row.planned });
    subject = r.subject;
    body = plain(r.md);
    buttons = [TEACHER_EMAIL_BUTTON];
  } else {
    const scouts = row.isScout ? (shares?.rows ?? [row]).map((r) => screen.plans[String(r.personId)]).filter(Boolean) : [];
    const t = row.kind === 'reminder' ? screen.templates.reminder : screen.templates.plan;
    const r = renderHouseholdEmail(t, { name: greet, people: scouts.length ? peopleWords(scouts, !!active[0]?.isScout) : 'you', day, focus: screen.focus || 'still being planned' }, scouts, override, {
      reminder: row.kind === 'reminder'
    });
    subject = r.subject;
    body = plain(r.md);
    buttons = row.kind === 'reminder' ? ['Answer now'] : planButtons(scouts).map((b) => b.label);
  }
  const history = screen.log.filter((l) => l.people.includes(row.personId) || row.recipients.some((r) => l.people.includes(r.personId)));
  return (
    <aside aria-label="Email preview" className={s.aside}>
      <section className={s.card}>
        <div className={s.cardHead}>
          <h2 className={s.cardTitle}>Preview</h2>
          <span className={s.cardSub}>
            {KIND_WORD[row.kind]} · {row.name}
          </span>
          {override != null ? <span className={s.editedPill}>Edited for this email only</span> : null}
        </div>
        <div className={s.toBlock}>
          <div className={s.label}>To</div>
          {row.recipients.length ? null : <div className={s.cardSub}>Nobody can be emailed.</div>}
          {row.recipients.map((r) => (
            <label key={r.personId} className={s.toOne}>
              <input type="checkbox" checked={!left.includes(r.personId)} onChange={(e) => setLeft(e.target.checked ? left.filter((x) => x !== r.personId) : [...left, r.personId])} />
              <strong>{r.name}</strong>
              <span className={s.cardSub}>{roleOf(row, r)}</span>
            </label>
          ))}
          {row.copies?.length ? (
            <div className={s.cardSub}>
              Copies {listOf(row.copies.map((c) => c.name))}: a scout is never emailed alone (Youth Protection).
            </div>
          ) : null}
          {shares ? <div className={s.sibNote}>One email covers {listOf(shares.rows.map((r) => r.name))}: same parents, so they get one message, not two.</div> : null}
        </div>
        <div className={s.mail}>
          <div className={s.label}>Subject</div>
          <div className={s.subject}>{subject}</div>
          {editing ? (
            <label className={s.editLabel}>
              Message for this email only
              <textarea rows={10} className={s.editBox} value={override ?? body} onChange={(e) => setOverride(e.target.value)} />
            </label>
          ) : (
            <div className={s.body}>{body}</div>
          )}
          <div className={s.fakeButtons} aria-hidden="true">
            {buttons.map((b) => (
              <span key={b} className={s.fakeButton}>
                {b}
              </span>
            ))}
          </div>
          <div className={s.fine}>The answer buttons are added to every email automatically and can&rsquo;t be removed by an edit. Links work until 6:00 PM on {day}. {TRACKING_LINE}</div>
        </div>
        <div className={s.cardFoot}>
          <button
            type="button"
            className={s.secondarySm}
            onClick={() => {
              if (!editing && override == null) setOverride(body);
              setEditing(!editing);
            }}
          >
            {editing ? 'Done editing' : 'Edit this email'}
          </button>
          {override != null ? (
            <button
              type="button"
              className={s.link}
              onClick={() => {
                setOverride(null);
                setEditing(false);
              }}
            >
              Use the standard wording
            </button>
          ) : null}
          <Link className={s.templateLink} href="/admin/advancement/lookups?card=email-templates">
            Edit the template for everyone
          </Link>
        </div>
      </section>
      <section className={s.card}>
        <div className={s.history}>
          <h3 className={s.historyTitle}>History for {row.name}</h3>
          {history.length ? null : <div className={s.cardSub}>No emails about this meeting yet.</div>}
          {history.map((l) => (
            <div key={l.id} className={s.historyLine}>
              <span className={s.cardSub}>{fmtDateTime(l.at)}</span>
              <span>
                {KIND_WORD[l.kind]} to {l.toName} · {logResult(l).label}
              </span>
            </div>
          ))}
        </div>
      </section>
    </aside>
  );
}

const LOG_PAGE = 100;
/** The Answer column's pill, by answerTone: a yes green, mixed yellow, Not this week grey, the rest outlined. */
const ANSWER_TONE = { yes: 'tone-ok', mixed: 'tone-warn', no: 'tone-muted', other: 'tone-info' } as const;
type LogFilter = 'all' | 'unopened' | 'unanswered';
const unopened = (l: LogLine) => l.status === 'sent' && !l.openedAt && l.delivery !== 'bounced' && l.delivery !== 'complained';

/**
 * The Sent log (Patrick, 2026-11-01): one compact line per email. When · the sender's initials | To (who they are and the
 * address on hover) | what the email was | how it landed | what they've answered since. All · Not opened · No answer,
 * and 100 lines a page.
 */
export function SentLog({ log, busy, onSendAgain }: { log: LogLine[]; busy: boolean; onSendAgain: (ids: number[]) => void }) {
  const [filter, setFilter] = useState<LogFilter>('all');
  const [page, setPage] = useState(0);
  const keep = (l: LogLine) => (filter === 'unopened' ? unopened(l) : filter === 'unanswered' ? !l.answered : true);
  const shown = log.filter(keep);
  const pages = Math.max(1, Math.ceil(shown.length / LOG_PAGE));
  const at = Math.min(page, pages - 1);
  const slice = shown.slice(at * LOG_PAGE, (at + 1) * LOG_PAGE);
  const choose = (f: LogFilter) => {
    setFilter(f);
    setPage(0);
  };
  return (
    <section aria-label="Sent log" className={`${s.listCard} ${s.logCard}`}>
      <div className={s.listHead}>
        <span className={s.hint}>Every email about this meeting, newest first. Hover a name for who they are and the address.</span>
        <div role="group" aria-label="Show" className={s.seg}>
          {(
            [
              ['all', 'All', log.length],
              ['unopened', 'Not opened', log.filter(unopened).length],
              ['unanswered', 'No answer', log.filter((l) => !l.answered).length]
            ] as const
          ).map(([k, label, n]) => (
            <button key={k} type="button" aria-pressed={filter === k} className={filter === k ? s.segOn : s.segBtn} onClick={() => choose(k)}>
              {label} {n}
            </button>
          ))}
        </div>
      </div>
      {shown.length ? (
        <div className={s.scroll}>
          <table className={s.log}>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">To</th>
                <th scope="col">Email</th>
                <th scope="col">Result</th>
                <th scope="col">Answer</th>
              </tr>
            </thead>
            <tbody>
              {slice.map((l) => {
                const r = logResult(l);
                return (
                  <tr key={l.id}>
                    <td>
                      {fmtWhen(l.at)}
                      {l.byInitials ? (
                        <>
                          {' · '}
                          <span className={s.muted} title={`Sent by ${l.by}`}>
                            {l.byInitials}
                          </span>
                        </>
                      ) : null}
                    </td>
                    <td>
                      <span className={s.strong} title={l.toHint}>
                        {l.toName}
                      </span>
                    </td>
                    <td>{l.email}</td>
                    <td>
                      <span className={`${s.status} ${s[`tone-${r.tone}`]}`} title={r.title}>
                        {r.label}
                      </span>
                      {l.status === 'failed' || l.status === 'unknown' || (l.status === 'sent' && l.delivery === 'bounced') ? (
                        <button type="button" className={s.againBtn} disabled={busy} onClick={() => onSendAgain([l.id])} aria-label={`Send again to ${l.toName}`}>
                          Send again
                        </button>
                      ) : null}
                    </td>
                    <td>
                      {answerTone(l.answer) ? <span className={`${s.status} ${s[ANSWER_TONE[answerTone(l.answer)!]]}`}>{l.answer}</span> : <span className={s.muted}>{l.answer}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={s.empty}>{log.length ? 'Nothing here with this filter.' : 'Nothing sent for this meeting yet.'}</div>
      )}
      {shown.length > LOG_PAGE ? (
        <div className={s.pager}>
          <span>
            {at * LOG_PAGE + 1}–{Math.min((at + 1) * LOG_PAGE, shown.length)} of {shown.length}
          </span>
          <button type="button" className={s.againBtn} aria-label="Previous page" disabled={at === 0} onClick={() => setPage(at - 1)}>
            ‹ Previous
          </button>
          <button type="button" className={s.againBtn} aria-label="Next page" disabled={at >= pages - 1} onClick={() => setPage(at + 1)}>
            Next ›
          </button>
        </div>
      ) : null}
    </section>
  );
}
