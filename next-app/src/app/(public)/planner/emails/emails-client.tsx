'use client';

/**
 * The Emails screen (Plans/Meeting-Planner-III-Emails.md, E3), laid out as prototypes/meeting-plan-III/Emails.dc.html:
 *   - A header band: "Meeting plan › Emails", the title, the lede, who emails come from, ← Back to the plan, and the
 *     tabs (Scouts and families · Teachers · Coming? reminders · Sent log) with their counts.
 *   - The send bar: how many EMAILS are selected across all tabs (siblings with the same parents share one), the
 *     tab's counts (sent · opened · not sent yet · can't send), Select all not sent yet, Clear, Review and send.
 *   - The inline confirmation: every recipient as a pill, "one at a time", what answers do, Send N now / Cancel.
 *   - The list (rank-coloured name, what it's about, who it goes to, a status pill) beside a sticky preview (To with a
 *     tick per recipient, the subject, the body, the answer buttons, Edit this email) and the person's History.
 *   - The Sent log: one line per email, with Send again for one that failed or didn't report back.
 * Nothing sends without a Send press (no schedule: Q5). Emails go out one at a time while the page is open; a send cut
 * short shows "N emails didn't finish sending · Send them now". "How this works" states every limit.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { fmtDateTime } from '@/lib/format-date';
import { SUGGESTION_CAP } from '@/lib/family-week-shared';
import { peopleWords, planButtons, renderHouseholdEmail, TRACKING_LINE } from '@/lib/meeting-email-build';
import { renderInviteDigest } from '@/lib/meeting-invite-email';
import type { EmailScreen, LogLine, QueueRequest, ScreenRecipient, ScreenRow } from '@/lib/meeting-email-screen';
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
const KIND_WORD = { plan: 'Scout invite', teacher: 'Teacher invite', reminder: 'Reminder' } as const;

function status(r: ScreenRow): { label: string; tone: Tone; k: 'new' | 'sent' | 'blocked'; opened: boolean } {
  if (r.blocked) return { label: `Can’t send · ${r.blocked}`, tone: 'bad', k: 'blocked', opened: false };
  if (r.answer === 'Answered yes') return { label: 'Answered yes', tone: 'ok', k: 'sent', opened: true };
  if (r.answer === 'Said not this week') return { label: 'Said not this week', tone: 'muted', k: 'sent', opened: true };
  if (r.state === 'new') return { label: 'Not sent yet', tone: 'new', k: 'new', opened: false };
  if (r.state === 'queued' || r.state === 'sending') return { label: 'Sending…', tone: 'info', k: 'sent', opened: false };
  if (r.state === 'failed' || r.delivery === 'bounced') return { label: `Failed · ${r.delivery === 'bounced' ? 'address bounced' : (r.failure ?? 'didn’t go out')}`, tone: 'bad', k: 'sent', opened: false };
  if (r.state === 'unknown') return { label: 'Unknown · check before sending again', tone: 'bad', k: 'sent', opened: false };
  if (r.changed) return { label: 'Plan changed since sent', tone: 'bad', k: 'sent', opened: !!r.openedAt };
  if (r.openedAt) return { label: `Opened ${fmtDateTime(r.openedAt)}`, tone: 'open', k: 'sent', opened: true };
  return { label: `Sent ${r.sentAt ? fmtDateTime(r.sentAt) : ''} · not opened`, tone: 'ok', k: 'sent', opened: false };
}

function logResult(l: LogLine): { label: string; tone: Tone } {
  if (l.status === 'queued' || l.status === 'sending') return { label: 'Queued', tone: 'info' };
  if (l.status === 'failed') return { label: `Failed · ${l.failure ?? ''}`, tone: 'bad' };
  if (l.status === 'unknown') return { label: 'Unknown · check before sending again', tone: 'bad' };
  if (l.status === 'retried') return { label: 'Sent again', tone: 'muted' };
  if (l.delivery === 'bounced' || l.delivery === 'complained') return { label: `Failed · ${l.delivery === 'bounced' ? 'address bounced' : 'marked as spam'}`, tone: 'bad' };
  if (l.openedAt) return { label: `Opened · ${fmtDateTime(l.openedAt)}`, tone: 'open' };
  return { label: l.delivery === 'delivered' ? 'Delivered · not opened' : 'Sent · not opened', tone: 'info' };
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

export function EmailsClient({ screen, day, backHref }: { screen: EmailScreen; day: string; backHref: string }) {
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
            <div className={s.crumb}>
              <Link href={backHref}>Meeting plan</Link> › Emails
            </div>
            <h1 className={s.title}>Emails for {day}</h1>
            <p className={s.lede}>Nothing goes out until you send it. Tick the emails you want, check the preview, then send. Every email is logged with who it went to and when.</p>
          </div>
          <div className={s.bandSide}>
            <span className={s.from}>
              From <strong>Troop 79 Bugler</strong> · replies go to leaders, not this address
            </span>
            <Link href={backHref} className={s.backBtn}>
              ← Back to the plan
            </Link>
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
                        <span className={s.to}>{active.length ? active.map((x) => x.name).join(', ') : r.recipients.length ? 'No one ticked' : ''}</span>
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
            <li>Families can suggest up to {SUGGESTION_CAP} things per scout. Suggestions only flag the scout for the planners.</li>
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
  const greet = listOf(active.map((r) => screen.firstNames[r.personId] ?? r.name.split(' ')[0]));
  const shares = planned.find((p) => p.rows.some((r) => r.id === row.id) && p.rows.length > 1);
  let subject = '';
  let body = '';
  let buttons: string[] = [];
  if (row.kind === 'teacher') {
    const g = screen.groupWords[row.group ?? ''];
    const t = override != null ? { ...screen.templates.teacher, body: override } : screen.templates.teacher;
    const r = renderInviteDigest(t, { name: greet, people: 'you', day }, [{ kind: 'teach', inviteeName: row.name, aboutRecipient: true, code: g?.codes ?? '', topic: g?.name ?? '', minutes: '', url: '' }]);
    subject = r.subject;
    body = plain(r.md);
    buttons = ['Choose what you’ll teach'];
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

function SentLog({ log, busy, onSendAgain }: { log: LogLine[]; busy: boolean; onSendAgain: (ids: number[]) => void }) {
  return (
    <section aria-label="Sent log" className={s.listCard}>
      <div className={s.listHead}>
        <span className={s.hint}>Every email about this meeting: one line per person it went to, updated as it&rsquo;s delivered, opened and answered.</span>
      </div>
      {log.length ? (
        <div className={s.scroll}>
          <table className={s.log}>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">To</th>
                <th scope="col">About</th>
                <th scope="col">Kind</th>
                <th scope="col">Sent by</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {log.map((l) => {
                const r = logResult(l);
                return (
                  <tr key={l.id}>
                    <td className={s.nowrap}>{fmtDateTime(l.at)}</td>
                    <td className={s.strong}>{l.toName}</td>
                    <td>{l.about}</td>
                    <td>{KIND_WORD[l.kind]}</td>
                    <td>{l.by}</td>
                    <td>
                      <span className={`${s.status} ${s[`tone-${r.tone}`]}`}>{r.label}</span>
                      {l.status === 'failed' || l.status === 'unknown' ? (
                        <button type="button" className={s.againBtn} disabled={busy} onClick={() => onSendAgain([l.id])} aria-label={`Send again to ${l.toName}`}>
                          Send again
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={s.empty}>Nothing sent for this meeting yet.</div>
      )}
    </section>
  );
}
