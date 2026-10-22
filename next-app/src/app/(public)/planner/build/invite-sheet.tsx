'use client';

/**
 * Build a Plan's "Invite…" review sheet (Plans/Build-A-Plan.md B3, Decision 2), in the shared Drawer. One section per
 * offering (or just the row a per-row Invite opened it for): the teachers to ask (qualified adults, counselors labelled;
 * ticked only when nobody teaches it yet) and the scouts to offer it to (likely fits ticked, the rest behind "Also show
 * others"), each with a one-line reason. Someone who can't be invited is listed, greyed, with why. Nothing sends until
 * "Send N emails", where N is the number of digest emails the ticks make (one per recipient, digestEmails).
 */
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Button } from '@/app/_components/button';
import { Drawer } from '@/app/_components/drawer';
import type { PlanRow } from '@/lib/build-plan';
import { defaultTicks, digestEmails, selection, tickId, type InviteKind, type InvitePerson, type InviteSection } from '@/lib/meeting-invite-digest';
import { plannerInviteSheetAction, plannerSendInvitesAction, type InviteSendResult } from '../build-actions';
import s from './build.module.css';

const SEND_FAILED = 'That didn’t send. Check your connection and try again.';
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function InviteSheet({
  entryId,
  rows,
  only,
  onSent,
  onClose
}: {
  entryId: number;
  rows: readonly PlanRow[];
  /** A per-row Invite: just this offering. */
  only: string | null;
  onSent: (res: Extract<InviteSendResult, { ok: true }>) => void;
  onClose: () => void;
}) {
  const [sections, setSections] = useState<InviteSection[] | null | 'failed'>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [ticks, setTicks] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Extract<InviteSendResult, { ok: true }> | null>(null);
  const inFlight = useRef(false);
  const summary = useRef<HTMLDivElement>(null);
  const byKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows]);

  useEffect(() => {
    let live = true;
    plannerInviteSheetAction(only ? { entryId, key: only } : { entryId })
      .then((res) => {
        if (!live) return;
        if (!res.ok) {
          setSections('failed');
          setProblem(res.error);
          return;
        }
        setSections(res.sections);
        setTicks(defaultTicks(res.sections, (k) => (byKey.get(k)?.teachers.length ?? 0) > 0));
      })
      .catch(() => live && setSections('failed'));
    return () => {
      live = false;
    };
    // The rows only seed the first proposal; a refresh behind the sheet doesn't reset the ticks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId, only]);

  const list = Array.isArray(sections) ? sections : [];
  const emails = digestEmails(list, ticks);
  const toggle = (id: string) =>
    setTicks((t) => {
      const next = new Set(t);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const send = async () => {
    if (inFlight.current || !emails) return;
    inFlight.current = true;
    setBusy(true);
    setProblem(null);
    const res = await plannerSendInvitesAction({ entryId, ...selection(list, ticks) }).catch(() => ({ ok: false as const, error: SEND_FAILED }));
    inFlight.current = false;
    setBusy(false);
    if (!res.ok) return setProblem(res.error);
    setDone(res);
    onSent(res);
  };
  // Send swaps to Close and the list to the summary: focus follows to the summary (qa-lead B3 #2).
  useEffect(() => {
    if (done) summary.current?.focus();
  }, [done]);

  const title = only ? (byKey.get(only)?.title ?? 'Invite') : 'Invite';
  const footer = done ? (
    <Button variant="secondary" onClick={onClose}>
      Close
    </Button>
  ) : (
    <>
      {problem && sections !== 'failed' ? (
        <p className={s.problem} role="alert">
          {problem}
        </p>
      ) : null}
      <Button variant="primary" onClick={send} disabled={!emails} aria-disabled={busy || undefined} title={emails ? undefined : 'Tick someone to invite'}>
        {busy ? 'Sending…' : `Send ${plural(emails, 'email')}`}
      </Button>
    </>
  );

  return (
    <Drawer eyebrow={only ? 'Invite' : undefined} title={title} sub={only ? byKey.get(only)?.codeLabel : undefined} onClose={onClose} footer={footer}>
      {/* One live region, in the sheet from the start; its text changes as the sheet loads and sends (qa-lead B3 #2). */}
      <p className={sections === null && !done ? s.pickMeta : s.srOnly} role="status">
        {done ? sentLine(done) : sections === null ? 'Finding who to invite…' : ''}
      </p>
      {done ? (
        <SentSummary res={done} focusRef={summary} />
      ) : (
        <>
          {sections === 'failed' ? <p className={s.problem}>{problem ?? 'The list didn’t load. Close and try again.'}</p> : null}
          {Array.isArray(sections) && !sections.some((x) => x.teachers.length || x.scouts.length) ? <p className={s.pickMeta}>Nobody to invite for this yet.</p> : null}
          {list.map((sec) =>
            sec.teachers.length || sec.scouts.length ? (
              <SheetSection key={sec.key} sec={sec} row={byKey.get(sec.key)} showHead={!only} ticks={ticks} onToggle={toggle} />
            ) : null
          )}
        </>
      )}
    </Drawer>
  );
}

function SheetSection({ sec, row, showHead, ticks, onToggle }: { sec: InviteSection; row: PlanRow | undefined; showHead: boolean; ticks: ReadonlySet<string>; onToggle: (id: string) => void }) {
  const ticked = (kind: InviteKind, list: InvitePerson[]) => list.filter((p) => !p.blocked && ticks.has(tickId(kind, sec.key, p.personId))).length;
  const likely = sec.scouts.filter((p) => p.likely);
  const others = sec.scouts.filter((p) => !p.likely);
  const people = (kind: InviteKind, list: InvitePerson[]) => (
    <ul className={s.pickList}>
      {list.map((p) => {
        const id = tickId(kind, sec.key, p.personId);
        const on = !p.blocked && ticks.has(id);
        return (
          <li key={p.personId}>
            <button type="button" className={on ? s.tickOn : s.tick} aria-pressed={on} aria-disabled={p.blocked ? true : undefined} onClick={() => !p.blocked && onToggle(id)}>
              <span className={s.tickBox} aria-hidden="true">
                {on ? '✓' : ''}
              </span>
              <span>
                <span className={s.pickTitle}>{p.name}</span>
                <span className={s.pickMeta}>{[p.reason, p.blocked].filter(Boolean).join(' · ')}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
  const headId = `invite-${sec.key}`;
  return (
    <section className={s.editSection} aria-labelledby={showHead ? headId : undefined}>
      {showHead ? (
        <h3 id={headId} className={s.sheetHead}>
          {row?.codeLabel ? <span className={s.code}>{row.codeLabel}</span> : null}
          {row?.title ?? sec.key}
        </h3>
      ) : null}
      {sec.teachers.length ? (
        <>
          <p className={s.editLabel}>
            Teachers <span className={s.sheetCount}>{ticked('teach', sec.teachers)} of {sec.teachers.length}</span>
          </p>
          {people('teach', sec.teachers)}
        </>
      ) : null}
      {sec.scouts.length ? (
        <>
          <p className={s.editLabel}>
            Scouts <span className={s.sheetCount}>{ticked('pick', sec.scouts)} of {sec.scouts.length}</span>
          </p>
          {likely.length ? people('pick', likely) : null}
          {others.length ? (
            <details className={s.others}>
              <summary>Also show others ({others.length})</summary>
              {people('pick', others)}
            </details>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

const sentLine = (res: Extract<InviteSendResult, { ok: true }>) => (res.emails ? `Sent ${plural(res.emails, 'email')}.` : 'Nothing went out.');

/** What the send did. Announced through the sheet's live region; focused when it appears. */
function SentSummary({ res, focusRef }: { res: Extract<InviteSendResult, { ok: true }>; focusRef: RefObject<HTMLDivElement | null> }) {
  return (
    <div className={s.editSection} ref={focusRef} tabIndex={-1}>
      <p className={s.editLabel}>{sentLine(res)}</p>
      {res.sent.length ? <p className={s.pickMeta}>Invited {res.sent.join(', ')}.</p> : null}
      {res.skipped.length ? (
        <>
          <p className={s.editLabel}>Not sent</p>
          <ul className={s.pickList}>
            {res.skipped.map((x, i) => (
              <li key={`${x.name}-${i}`} className={s.pickMeta}>
                {x.name}: {x.reason}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
