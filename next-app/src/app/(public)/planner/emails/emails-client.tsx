'use client';

/**
 * The Emails screen (Plans/Meeting-Planner-III-Emails.md, E3; prototypes/meeting-plan-III/Emails.dc.html). Tabs:
 * Scouts and families · Teachers · Coming? reminders · Sent log. Nothing is ticked at first. The selection counts
 * EMAILS (siblings with the same parents share one). The preview shows the To list (untick a parent to leave them
 * out), the subject, the body and the answer buttons, with "Edit this email" for a one-off wording. "Review and send"
 * opens an inline confirmation naming every recipient; Send queues them all, then sends one at a time here, each line
 * turning Sent or Failed as it lands. A send cut short (the page closed) shows a strip next time: Send them now.
 * "How this works" states every limit, from the same constants the server enforces.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/app/_components/button';
import { Notice } from '@/app/_components/notice';
import { fmtDateTime } from '@/lib/format-date';
import { SUGGESTION_CAP } from '@/lib/family-week-shared';
import { peopleWords, planButtons, renderHouseholdEmail, TRACKING_LINE } from '@/lib/meeting-email-build';
import { renderInviteDigest } from '@/lib/meeting-invite-email';
import type { EmailScreen, LogLine, ScreenRow } from '@/lib/meeting-email-screen';
import type { QueueRequest } from '@/lib/meeting-email-screen';
import { emailsQueueAction, emailsRequeueAction, emailsSendNextAction } from './actions';
import s from './emails.module.css';

type Tab = 'scouts' | 'teachers' | 'reminders' | 'log';
type Filter = 'all' | 'new' | 'sent';

/** One email the current selection makes: a recipient, the rows it covers, and its one-off wording. */
interface Planned {
  key: string;
  req: QueueRequest;
  toName: string;
  email: string;
  rows: ScreenRow[];
}

function statusText(r: ScreenRow): string {
  if (r.blocked) return `Can’t send · ${r.blocked}`;
  if (r.state === 'new') return 'Not sent yet';
  if (r.state === 'queued' || r.state === 'sending') return 'Sending…';
  if (r.state === 'failed') return `Failed · ${r.failure ?? 'didn’t go out'}`;
  if (r.state === 'unknown') return 'Unknown · check before sending again';
  if (r.delivery === 'bounced') return 'Failed · bounced';
  const parts = [r.openedAt ? `Opened ${fmtDateTime(r.openedAt)}` : `Sent ${r.sentAt ? fmtDateTime(r.sentAt) : ''} · not opened`];
  if (r.answer) parts.push(r.answer);
  if (r.changed) parts.push('Plan changed since sent');
  return parts.join(' · ');
}

function logResult(l: LogLine): string {
  if (l.status === 'queued' || l.status === 'sending') return 'Queued';
  if (l.status === 'failed') return `Failed · ${l.failure ?? ''}`;
  if (l.status === 'unknown') return 'Unknown · check before sending again';
  if (l.delivery === 'bounced' || l.delivery === 'complained') return `Failed · ${l.delivery}`;
  if (l.openedAt) return `Opened ${fmtDateTime(l.openedAt)}`;
  return l.delivery === 'delivered' ? 'Delivered' : 'Sent';
}

const KIND_WORD = { plan: 'Plan', teacher: 'Teacher invite', reminder: 'Reminder' } as const;

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
  const [message, setMessage] = useState<string | null>(null);
  const [retry, setRetry] = useState<Set<number>>(new Set());

  const tabs: { key: Tab; label: string; rows: ScreenRow[] }[] = [
    { key: 'scouts', label: 'Scouts and families', rows: screen.scouts },
    { key: 'teachers', label: 'Teachers', rows: screen.teachers },
    { key: 'reminders', label: 'Coming? reminders', rows: screen.reminders }
  ];
  const allRows = useMemo(() => [...screen.scouts, ...screen.teachers, ...screen.reminders], [screen]);
  const rowsOf = (t: Tab) => tabs.find((x) => x.key === t)?.rows ?? [];
  const shown = rowsOf(tab).filter((r) => (filter === 'new' ? r.state === 'new' : filter === 'sent' ? r.state !== 'new' : true));

  // The selection, as emails: one per recipient per kind (per group for a teacher).
  const planned: Planned[] = useMemo(() => {
    const byKey = new Map<string, Planned>();
    for (const r of allRows) {
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
        byKey.set(key, p);
      }
    }
    return [...byKey.values()];
  }, [allRows, ticked, left, overrides]);
  const over = Math.max(0, planned.length - screen.cap);

  const toggle = (id: string) => setTicked((t) => (t.has(id) ? new Set([...t].filter((x) => x !== id)) : new Set([...t, id])));
  const selectNew = () => setTicked((t) => new Set([...t, ...rowsOf(tab).filter((r) => r.state === 'new' && !r.blocked).map((r) => r.id)]));
  const clear = () => setTicked((t) => new Set([...t].filter((id) => !rowsOf(tab).some((r) => r.id === id))));

  async function drain(batchId: string, total: number) {
    let done = 0;
    let failed = 0;
    setProgress({ done, total, failed });
    for (;;) {
      const res = await emailsSendNextAction({ entryId: screen.entryId, batchId }).catch(() => null);
      if (!res || !res.ok) {
        setMessage(res && !res.ok ? res.error : 'The connection dropped. The rest stay queued: Send them now picks up where this stopped.');
        break;
      }
      if (res.done) break;
      done++;
      if (res.status !== 'sent') failed++;
      setProgress({ done, total, failed });
    }
    setProgress(null);
    router.refresh();
  }

  async function send() {
    setConfirming(false);
    setMessage(null);
    const res = await emailsQueueAction({ entryId: screen.entryId, emails: planned.slice(0, screen.cap).map((p) => p.req) });
    if (!res.ok) return setMessage(res.error);
    setTicked(new Set());
    const notes = [res.overflow ? `${res.overflow} over the ${screen.cap} limit weren’t queued.` : '', res.refused.length ? `Not sent: ${res.refused.join('; ')}.` : ''].filter(Boolean).join(' ');
    if (notes) setMessage(notes);
    await drain(res.batchId, res.queued);
  }

  async function sendAgain() {
    const res = await emailsRequeueAction({ entryId: screen.entryId, ids: [...retry] });
    if (!res.ok) return setMessage(res.error);
    setRetry(new Set());
    await drain(res.batchId, res.queued);
  }

  const focus = allRows.find((r) => r.id === focusId) ?? null;
  const counts = (t: Tab) => (t === 'log' ? screen.log.length : rowsOf(t).length);

  return (
    <div className={s.wrap}>
      <header className={s.head}>
        <p className={s.kicker}>Meeting Planner · Emails</p>
        <h1 className={s.title}>
          {day} · {screen.focus || 'No focus yet'}
        </h1>
        <p className={s.lede}>Nothing sends until you press Send. Every email is listed here, with what happened to it.</p>
      </header>

      {screen.unfinished.length && !progress ? (
        <Notice tone="warning">
          {screen.unfinished.reduce((n, u) => n + u.queued, 0)} emails didn&rsquo;t finish sending.{' '}
          <button type="button" className={s.link} onClick={() => void Promise.all(screen.unfinished.map((u) => drain(u.batchId, u.queued)))}>
            Send them now
          </button>
        </Notice>
      ) : null}
      {message ? <Notice tone="info">{message}</Notice> : null}
      {progress ? (
        <p className={s.progress} role="status">
          Sending {progress.done} of {progress.total}
          {progress.failed ? ` · ${progress.failed} didn’t go` : ''}… Keep this page open.
        </p>
      ) : null}

      <div className={s.tabs} role="tablist" aria-label="Emails">
        {[...tabs.map((t) => ({ key: t.key, label: t.label })), { key: 'log' as const, label: 'Sent log' }].map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={tab === t.key ? s.tabOn : s.tab} onClick={() => setTab(t.key)}>
            {t.label} <span className={s.count}>{counts(t.key)}</span>
          </button>
        ))}
      </div>

      {tab === 'log' ? (
        <SentLog log={screen.log} retry={retry} setRetry={setRetry} onSendAgain={() => void sendAgain()} busy={!!progress} />
      ) : (
        <div className={s.grid}>
          <section className={s.list} aria-label={tabs.find((t) => t.key === tab)?.label}>
            <div className={s.toolbar}>
              <button type="button" className={s.link} onClick={selectNew}>
                Select all not sent yet
              </button>
              <button type="button" className={s.link} onClick={clear}>
                Clear
              </button>
              <span className={s.spacer} />
              <div className={s.filters} role="radiogroup" aria-label="Show">
                {(
                  [
                    ['all', 'Everyone'],
                    ['new', 'Not sent yet'],
                    ['sent', 'Sent']
                  ] as const
                ).map(([k, label]) => (
                  <button key={k} type="button" role="radio" aria-checked={filter === k} className={filter === k ? s.filterOn : s.filter} onClick={() => setFilter(k)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {shown.length ? null : <p className={s.muted}>Nobody here.</p>}
            <ul className={s.rows}>
              {shown.map((r) => (
                <li key={r.id} className={focusId === r.id ? s.rowOn : s.row}>
                  <input type="checkbox" checked={ticked.has(r.id)} disabled={!!r.blocked || !!progress} onChange={() => toggle(r.id)} aria-label={`Send to ${r.name}`} />
                  <button type="button" className={s.rowMain} onClick={() => setFocusId(r.id)}>
                    <span className={s.rowName}>{r.name}</span>
                    <span className={s.rowAbout}>{r.about}</span>
                    <span className={s.rowTo}>{r.recipients.length ? `To ${r.recipients.map((x) => x.name).join(', ')}` : ''}</span>
                  </button>
                  <span className={r.blocked || r.state === 'failed' || r.state === 'unknown' ? s.statusBad : r.state === 'new' ? s.status : s.statusDone}>{statusText(r)}</span>
                </li>
              ))}
            </ul>
            <div className={s.sendBar}>
              <Button variant="primary" disabled={!planned.length || !!progress} onClick={() => setConfirming(true)}>
                Review and send {planned.length} email{planned.length === 1 ? '' : 's'}
              </Button>
            </div>
            {confirming ? (
              <div className={s.confirm} role="region" aria-label="Review and send">
                <p className={s.confirmHead}>
                  Send {Math.min(planned.length, screen.cap)} email{planned.length === 1 ? '' : 's'} now ({Math.min(planned.length, screen.cap)} of a {screen.cap} limit)
                </p>
                <ul className={s.confirmList}>
                  {planned.slice(0, screen.cap).map((p) => (
                    <li key={p.key}>
                      {p.toName} &lt;{p.email}&gt; · {KIND_WORD[p.req.kind]}
                      {p.rows.length > 1 ? ` · covers ${p.rows.map((r) => r.name).join(' and ')}` : ''}
                    </li>
                  ))}
                </ul>
                {over ? <p className={s.statusBad}>{over} more are over the limit and won&rsquo;t be sent. Send them next.</p> : null}
                <p className={s.muted}>Sending doesn&rsquo;t change the plan. Answers do: &ldquo;Not this week&rdquo; takes a scout out of their group, and a teacher&rsquo;s yes fills the slot.</p>
                <div className={s.confirmActions}>
                  <Button variant="primary" onClick={() => void send()}>
                    Send now
                  </Button>
                  <Button variant="secondary" onClick={() => setConfirming(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}
          </section>
          <Preview
            row={focus}
            screen={screen}
            day={day}
            planned={planned}
            left={focus ? (left[focus.id] ?? []) : []}
            setLeft={(ids) => focus && setLeft((l) => ({ ...l, [focus.id]: ids }))}
            override={focus ? (overrides[focus.id] ?? null) : null}
            setOverride={(v) => focus && setOverrides((o) => (v == null ? Object.fromEntries(Object.entries(o).filter(([k]) => k !== focus.id)) : { ...o, [focus.id]: v }))}
            editing={editing}
            setEditing={setEditing}
          />
        </div>
      )}

      <details className={s.how}>
        <summary>How this works</summary>
        <ul>
          <li>Nothing sends until an adult presses Send, and nothing is ticked to start with.</li>
          <li>One Send reaches at most {screen.cap} emails. Anything over that is listed and left unsent.</li>
          <li>Emails go out one at a time while this page is open. If it closes partway, the rest wait here until someone presses Send them now.</li>
          <li>A send that doesn&rsquo;t report back reads Unknown: it may still have arrived, so check before sending it again.</li>
          <li>Brothers and sisters with the same parents get one email. Scouts 13 and older with a verified address get their own copy.</li>
          <li>Sending never changes the plan. Answers do: Can&rsquo;t make it takes a scout out of their group, a family&rsquo;s changes come off the plan, and a teacher&rsquo;s yes adds them to the group.</li>
          <li>Families can suggest up to {SUGGESTION_CAP} things per scout. Suggestions only flag the scout for the planners.</li>
          <li>Each family link works until 6:00 PM on the meeting day. Only the newest email&rsquo;s link works: sending again closes the older one.</li>
          <li>Troop 79 can see when an email is opened, and every email says so. Some phones open emails on their own, so Opened is a hint, not proof.</li>
        </ul>
      </details>
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
  row: ScreenRow | null;
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
  if (!row) return <aside className={s.preview}>Pick a row to see its email.</aside>;
  const to = row.recipients[0];
  const greet = to ? (screen.firstNames[to.personId] ?? to.name) : '';
  const shares = planned.find((p) => p.rows.some((r) => r.id === row.id) && p.rows.length > 1);
  let subject = '';
  let body = '';
  let buttons: string[] = [];
  if (row.kind === 'teacher') {
    const g = screen.groupWords[row.group ?? ''];
    const r = renderInviteDigest(override ? { ...screen.templates.teacher, body: override } : screen.templates.teacher, { name: greet, people: 'you', day }, [
      { kind: 'teach', inviteeName: row.name, aboutRecipient: true, code: g?.codes ?? '', topic: g?.name ?? '', minutes: '', url: '…' }
    ]);
    subject = r.subject;
    body = r.md;
    buttons = ['Choose what you’ll teach →'];
  } else {
    const scouts = row.isScout ? (shares?.rows ?? [row]).map((r) => screen.plans[String(r.personId)]).filter(Boolean) : [];
    const t = row.kind === 'reminder' ? screen.templates.reminder : screen.templates.plan;
    const r = renderHouseholdEmail(t, { name: greet, people: scouts.length ? peopleWords(scouts, !!to?.isScout) : 'you', day, focus: screen.focus || 'still being planned' }, scouts, override, { reminder: row.kind === 'reminder' });
    subject = r.subject;
    body = r.md;
    buttons = row.kind === 'reminder' ? ['Answer now'] : planButtons(scouts).map((b) => b.label);
  }
  const history = screen.log.filter((l) => l.people.includes(row.personId));
  return (
    <aside className={s.preview} aria-label="Preview">
      <p className={s.previewFor}>{row.name}</p>
      <fieldset className={s.toList}>
        <legend>To</legend>
        {row.recipients.length ? null : <span className={s.muted}>Nobody can be emailed.</span>}
        {row.recipients.map((r) => (
          <label key={r.personId} className={s.toOne}>
            <input type="checkbox" checked={!left.includes(r.personId)} onChange={(e) => setLeft(e.target.checked ? left.filter((x) => x !== r.personId) : [...left, r.personId])} />
            {r.name} <span className={s.muted}>&lt;{r.email}&gt;</span>
          </label>
        ))}
      </fieldset>
      {shares ? <p className={s.muted}>One email covers {shares.rows.map((r) => r.name).join(' and ')}: same parents, so they get one message.</p> : null}
      <p className={s.subject}>{subject}</p>
      {editing ? (
        <textarea className={s.editBox} rows={8} value={override ?? body} onChange={(e) => setOverride(e.target.value)} aria-label="This email’s wording" />
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
      <p className={s.muted}>{TRACKING_LINE}</p>
      <div className={s.editRow}>
        <button type="button" className={s.link} onClick={() => setEditing(!editing)}>
          {editing ? 'Done editing' : 'Edit this email'}
        </button>
        {override != null ? (
          <>
            <span className={s.edited}>Edited for this email only</span>
            <button type="button" className={s.link} onClick={() => setOverride(null)}>
              Use the standard wording
            </button>
          </>
        ) : null}
        <Link className={s.link} href="/admin/advancement/lookups?card=email-templates">
          Edit the template for everyone
        </Link>
      </div>
      <div className={s.history}>
        <p className={s.historyHead}>History</p>
        {history.length ? null : <p className={s.muted}>No emails about this meeting yet.</p>}
        <ul>
          {history.map((l) => (
            <li key={l.id}>
              {fmtDateTime(l.at)} · {KIND_WORD[l.kind]} to {l.toName} · {logResult(l)}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

function SentLog({ log, retry, setRetry, onSendAgain, busy }: { log: LogLine[]; retry: Set<number>; setRetry: (s: Set<number>) => void; onSendAgain: () => void; busy: boolean }) {
  if (!log.length) return <p className={s.muted}>Nothing sent for this meeting yet.</p>;
  return (
    <section aria-label="Sent log">
      <table className={s.log}>
        <thead>
          <tr>
            <th scope="col">
              <span className={s.srOnly}>Send again</span>
            </th>
            <th scope="col">When</th>
            <th scope="col">To</th>
            <th scope="col">About</th>
            <th scope="col">Kind</th>
            <th scope="col">Sent by</th>
            <th scope="col">Result</th>
          </tr>
        </thead>
        <tbody>
          {log.map((l) => (
            <tr key={l.id}>
              <td>
                {l.status === 'failed' || l.status === 'unknown' ? (
                  <input type="checkbox" checked={retry.has(l.id)} onChange={() => setRetry(retry.has(l.id) ? new Set([...retry].filter((x) => x !== l.id)) : new Set([...retry, l.id]))} aria-label={`Send again to ${l.toName}`} />
                ) : null}
              </td>
              <td>{fmtDateTime(l.at)}</td>
              <td>
                {l.toName} <span className={s.muted}>{l.to}</span>
              </td>
              <td>{l.about}</td>
              <td>{KIND_WORD[l.kind]}</td>
              <td>{l.by}</td>
              <td className={l.status === 'failed' || l.status === 'unknown' ? s.statusBad : undefined}>{logResult(l)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {retry.size ? (
        <div className={s.sendBar}>
          <Button variant="secondary" disabled={busy} onClick={onSendAgain}>
            Send {retry.size} again
          </Button>
        </div>
      ) : null}
    </section>
  );
}
