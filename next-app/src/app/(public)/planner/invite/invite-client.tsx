'use client';

/**
 * The Invite tab's client side (Plans/Build-A-Plan.md, B6). Three zones on a desktop:
 *   - left: the offerings, each with its readiness, a status line ("Maria L agreed · 5 likely · 2 asked · 1 yes") and
 *     how many are ticked;
 *   - centre: the selected offering, teachers first then scouts, each row a tick, the name, a reason line, a status
 *     chip and who gets the email; quiet controls (Tick all likely, Clear, Show all eligible (n), Said no (n)). A
 *     By offering | By person switch shows the same ticks one row per person instead;
 *   - right (sticky): the Review, grouped by family then recipient, with Preview email (a Dialog rendered by the real
 *     digest renderer) and the one primary, "Send N emails to M families".
 * Phone: one column; the list drills into the detail, and a sticky "Send N emails · Review" bar opens the Review in
 * the Drawer.
 *
 * Ticks are client state until Send (no reload per tick). Send goes through plannerSendInvitesAction within the
 * per-send caps (sendPlan): anything past a cap stays ticked, is marked in place and goes in the next send. After a
 * send the tab's data is read again (plannerInviteSheetAction), so the chips and blocks follow; only the invites that
 * now carry a fresh ask come off (ticksAfterSend), so a recipient the server skipped stays ticked too.
 *
 * Not ready warns, it doesn't block (Patrick): a Notice names the offerings with no teacher, whose teacher asks start
 * ticked. Viewers and the SPL see everything read-only; a past or closed meeting is read-only.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Button } from '@/app/_components/button';
import { Drawer } from '@/app/_components/drawer';
import { EmptyState } from '@/app/_components/empty-state';
import { Notice } from '@/app/_components/notice';
import { fmtDate, fmtDay } from '@/lib/format-date';
import { STATE_LABEL, type PlanRow } from '@/lib/build-plan';
import { renderMarkdownEmail } from '@/lib/email-markdown';
import { renderInviteDigest, type InviteTemplate } from '@/lib/meeting-invite-email';
import {
  byPerson,
  chipLabel,
  defaultTicks,
  digestPeople,
  offeringLine,
  reviewGroups,
  sendPlan,
  tickId,
  ticksAfterSend,
  type InviteKind,
  type InvitePerson,
  type InviteSection,
  type InviteTabData,
  type ReviewGroup
} from '@/lib/meeting-invite-digest';
import { plannerInviteSheetAction, plannerSendInvitesAction, type InviteSendResult } from '../build-actions';
import b from '../build/build.module.css';
import s from './invite.module.css';

const SEND_FAILED = 'That didn’t send. Check your connection and try again.';
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const STATE_CLASS = { ready: b.stateReady, 'needs-teacher': b.stateTeacher, 'needs-scouts': b.stateScouts } as const;

/** 'Tue' within the week, else 'Oct 14'. */
function askedDay(at: string): string {
  const days = (Date.now() - new Date(at).getTime()) / 86_400_000;
  return days < 6 ? fmtDay(at).split(',')[0] : fmtDate(at, { year: false });
}

type Sent = Extract<InviteSendResult, { ok: true }>;

export function InviteView({
  entryId,
  rows,
  data: initialData,
  canEmail,
  readOnly,
  buildHref,
  initialKey,
  template,
  day,
  heading
}: {
  entryId: number;
  /** The plan's offerings (Build's rows). */
  rows: PlanRow[];
  /** Who to invite per offering; null when it failed to load. */
  data: InviteTabData | null;
  /** An adult editor: sends. Everyone else sees the tab read-only. */
  canEmail: boolean;
  /** A past or closed meeting. */
  readOnly: 'past' | 'closed' | null;
  buildHref: string;
  /** ?offering=<key>: open on that offering's detail. */
  initialKey?: string | null;
  /** The digest's copy (Preview renders with it). */
  template: InviteTemplate;
  /** 'Sunday, October 25, 2026': the digest's [day]. */
  day: string;
  heading: ReactNode;
}) {
  const [data, setData] = useState(initialData);
  const sections = useMemo(() => data?.sections ?? [], [data]);
  const recipients = useMemo(() => data?.recipients ?? {}, [data]);
  const byKey = useMemo(() => new Map(sections.map((x) => [x.key, x])), [sections]);
  const rowOf = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows]);
  const [ticks, setTicks] = useState<Set<string>>(() => defaultTicks(initialData?.sections ?? [], (k) => (rows.find((r) => r.key === k)?.teachers.length ?? 0) > 0));
  const [selected, setSelected] = useState<string>(initialKey ?? rows[0]?.key ?? '');
  /** Phone: the list, or the selected offering's detail. */
  const [drill, setDrill] = useState<'list' | 'detail'>(initialKey ? 'detail' : 'list');
  const [view, setView] = useState<'offering' | 'person'>('offering');
  const [reviewSheet, setReviewSheet] = useState(false);
  const [preview, setPreview] = useState<{ recipientId: number; group: ReviewGroup } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);
  const inFlight = useRef(false);
  /** Phone drill-down focus (qa-lead B6 #2): where focus goes once the list or the detail has rendered. */
  const focusNext = useRef<'detail' | string | null>(null);
  const listRef = useRef<HTMLElement | null>(null);
  const previewOpener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const target = focusNext.current;
    if (target == null) return;
    focusNext.current = null;
    if (target === 'detail') document.getElementById('invite-detail-title')?.focus();
    else document.getElementById(offeringButtonId(target))?.focus();
  }, [drill, selected]);

  const canSend = canEmail && !readOnly;
  const plan = useMemo(() => sendPlan(sections, ticks, recipients), [sections, ticks, recipients]);
  const groups = useMemo(() => reviewGroups(sections, plan, recipients), [sections, plan, recipients]);
  const notReady = rows.filter((r) => r.state === 'needs-teacher');
  const invited = useMemo(() => new Set(sections.flatMap((x) => [...x.teachers, ...x.scouts].filter((p) => p.chip && p.chip !== 'picked').map((p) => p.personId))).size, [sections]);
  const yes = sections.reduce((n, x) => n + [...x.teachers, ...x.scouts].filter((p) => p.chip === 'yes').length, 0);

  const toggle = (id: string) =>
    setTicks((t) => {
      const next = new Set(t);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const setMany = (ids: string[], on: boolean) =>
    setTicks((t) => {
      const next = new Set(t);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  const send = async () => {
    if (inFlight.current || !plan.emails || !canSend) return;
    inFlight.current = true;
    setBusy(true);
    setProblem(null);
    const res = await plannerSendInvitesAction({ entryId, teach: plan.teach, pick: plan.pick }).catch(() => ({ ok: false as const, error: SEND_FAILED }));
    if (!res.ok) {
      inFlight.current = false;
      setBusy(false);
      setProblem(res.error);
      return;
    }
    setSent(res);
    // Only what now carries a fresh ask comes off; a skipped recipient and the overflow stay ticked (qa-lead B6 #1).
    // If the refresh fails, the ticks stay: the server's 24-hour dedupe keeps a second send from emailing anyone twice.
    const fresh = await plannerInviteSheetAction({ entryId }).catch(() => null);
    if (fresh?.ok) {
      setData({ sections: fresh.sections, recipients: fresh.recipients });
      setTicks((t) => ticksAfterSend(t, fresh.sections));
    }
    inFlight.current = false;
    setBusy(false);
  };

  if (!rows.length) {
    return (
      <>
        {heading}
        <div className={s.solo}>
          <EmptyState action={<Link href={buildHref}>Build a Plan</Link>}>Nothing on the plan yet, so there’s nobody to invite.</EmptyState>
        </div>
      </>
    );
  }

  const sendLabel = `Send ${plural(plan.emails, 'email')} to ${plural(plan.families, 'family', 'families')}`;
  const sendWhy = readOnly ? null : canEmail ? null : 'Only adults send email';
  const sendButton = (
    <Button variant="primary" onClick={send} disabled={!canSend || !plan.emails} aria-disabled={busy || undefined} title={canSend && !plan.emails ? 'Tick someone to invite' : undefined}>
      {busy ? 'Sending…' : sendLabel}
    </Button>
  );
  const review = (headingId: string) => (
    <Review
      headingId={headingId}
      groups={groups}
      rowOf={rowOf}
      overflow={plan.overflow.size}
      onPreview={(group, recipientId, opener) => {
        previewOpener.current = opener;
        setPreview({ group, recipientId });
      }}
      foot={
        readOnly ? null : (
          <>
            {problem ? (
              <p className={b.problem} role="alert">
                {problem}
              </p>
            ) : null}
            {sendWhy ? <p className={s.why}>{sendWhy}</p> : null}
            {sendButton}
          </>
        )
      }
    />
  );

  const current = byKey.get(selected);
  const currentRow = rowOf.get(selected);
  const chipDay = (p: InvitePerson) => chipLabel(p.chip, p.askedAt, askedDay);

  return (
    <>
      {heading}
      <div className={b.rail}>
        <p className={b.railText}>
          {plural(rows.length, 'offering')} · {invited} invited · {yes} yes
        </p>
      </div>
      <div className={s.notices}>
        {readOnly ? <Notice tone="info">{readOnly === 'past' ? 'This meeting has passed, so its invites are read-only.' : 'This meeting takes no sign-ups, so its invites are read-only.'}</Notice> : null}
        {!readOnly && notReady.length ? (
          <Notice tone="warning">
            No teacher yet: {notReady.map((r) => r.codeLabel || r.title).join(', ')}. Their teacher asks start ticked.
          </Notice>
        ) : null}
        {data === null ? <Notice tone="error">Who to invite didn’t load. Refresh the page to try again.</Notice> : null}
        <p className={sent ? s.sent : b.srOnly} role="status">
          {sent ? sentLine(sent, plan.overflow.size) : ''}
        </p>
        {sent?.skipped.length ? (
          <details className={b.others}>
            <summary>Not sent ({sent.skipped.length})</summary>
            <ul className={b.pickList}>
              {sent.skipped.map((x, i) => (
                <li key={`${x.name}-${i}`} className={b.pickMeta}>
                  {x.name}: {x.reason}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
      <div className={s.switch}>
        <span className={s.seg} role="radiogroup" aria-label="View">
          {(
            [
              ['offering', 'By offering'],
              ['person', 'By person']
            ] as const
          ).map(([v, label]) => (
            <label key={v} className={v === view ? s.segOn : s.segOption}>
              <input type="radio" className={s.segInput} name="invite-view" value={v} checked={v === view} onChange={() => setView(v)} />
              {label}
            </label>
          ))}
        </span>
      </div>
      <div className={s.layout} data-drill={view === 'offering' ? drill : 'detail'}>
        {view === 'offering' ? (
          <nav className={s.list} aria-label="Offerings" ref={listRef}>
            <ul className={s.offerings}>
              {rows.map((r) => {
                const sec = byKey.get(r.key);
                const n = sec ? [...sec.teachers.map((p) => tickId('teach', r.key, p.personId)), ...sec.scouts.map((p) => tickId('pick', r.key, p.personId))].filter((id) => ticks.has(id)).length : 0;
                const line = offeringLine(r.teachers, sec);
                return (
                  <li key={r.key}>
                    <button
                      type="button"
                      className={r.key === selected ? s.offeringOn : s.offering}
                      aria-current={r.key === selected ? 'true' : undefined}
                      id={offeringButtonId(r.key)}
                      onClick={() => {
                        setSelected(r.key);
                        setDrill('detail');
                        // On a phone the list goes away under the finger: take focus to what replaced it. On a desktop
                        // the list stays (offsetParent set), so focus stays on the offering.
                        if (!listRef.current?.offsetParent) focusNext.current = 'detail';
                      }}
                    >
                      <span className={s.offeringTitle}>
                        {r.codeLabel ? <span className={b.code}>{r.codeLabel}</span> : null}
                        {r.title}
                      </span>
                      <span className={STATE_CLASS[r.state]}>{STATE_LABEL[r.state]}</span>
                      {line ? <span className={s.meta}>{line}</span> : null}
                      {n ? <span className={s.meta}>{n} ticked</span> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        ) : null}
        <section className={s.detail} aria-label={view === 'offering' ? (currentRow?.title ?? 'Offering') : 'By person'}>
          {view === 'offering' ? (
            <>
              <button
                type="button"
                className={s.back}
                onClick={() => {
                  focusNext.current = selected;
                  setDrill('list');
                }}
              >
                ← Offerings
              </button>
              {current && currentRow ? (
                <OfferingDetail
                  key={currentRow.key}
                  row={currentRow}
                  sec={current}
                  ticks={ticks}
                  overflow={plan.overflow}
                  readOnly={!canSend}
                  onToggle={toggle}
                  onMany={setMany}
                  chip={chipDay}
                />
              ) : (
                <p className={b.empty}>{data === null ? '' : 'Nobody to invite for this yet.'}</p>
              )}
            </>
          ) : (
            <PeopleView sections={sections} rowOf={rowOf} ticks={ticks} overflow={plan.overflow} readOnly={!canSend} onToggle={toggle} chip={chipDay} />
          )}
        </section>
        <aside className={s.review} aria-labelledby="invite-review">
          {review('invite-review')}
        </aside>
      </div>
      {readOnly ? null : (
        <div className={s.phoneBar}>
          <Button variant="primary" onClick={() => setReviewSheet(true)} aria-haspopup="dialog">
            {canSend ? `Send ${plural(plan.emails, 'email')} · Review` : 'Review'}
          </Button>
        </div>
      )}
      {reviewSheet ? (
        <Drawer title="Review" onClose={() => setReviewSheet(false)}>
          {review('invite-review-sheet')}
        </Drawer>
      ) : null}
      {preview ? (
        <PreviewDialog
          group={preview.group}
          recipientId={preview.recipientId}
          recipients={recipients}
          rowOf={rowOf}
          template={template}
          day={day}
          onClose={() => {
            setPreview(null);
            // Back to the Preview that opened it (qa-lead B6 #3).
            previewOpener.current?.focus();
          }}
        />
      ) : null}
    </>
  );
}

const offeringButtonId = (key: string) => `invite-offering-${key.replace(/[^a-z0-9-]/gi, '_')}`;

const sentLine = (res: Sent, overflow: number) =>
  `${res.emails ? `Sent ${plural(res.emails, 'email')}.` : 'Nothing went out.'}${overflow ? ` ${plural(overflow, 'more invite')} ticked past this send’s limit: send again.` : ''}`;

type ChipFn = (p: InvitePerson) => string;

/** One person's line: a tick (or a locked line), the name, a reason line, a chip and who gets the email. */
function PersonTick({
  id,
  p,
  on,
  over,
  readOnly,
  onToggle,
  chip,
  label
}: {
  id: string;
  p: InvitePerson;
  on: boolean;
  over: boolean;
  readOnly: boolean;
  onToggle: (id: string) => void;
  chip: ChipFn;
  /** By person: the offering this tick is for, in place of the name. */
  label?: ReactNode;
}) {
  const locked = p.tier === 'assigned';
  const blocked = locked || p.blocked != null;
  const ticked = on && !blocked;
  const meta = [p.reason, p.to ? `Email: ${p.to}` : null].filter(Boolean).join(' · ');
  return (
    <li>
      <button
        type="button"
        className={`${ticked ? b.tickOn : b.tick} ${over && ticked ? s.over : ''}`}
        aria-pressed={ticked}
        aria-disabled={blocked || readOnly ? true : undefined}
        onClick={() => !blocked && !readOnly && onToggle(id)}
      >
        <span className={b.tickBox} aria-hidden="true">
          {ticked ? '✓' : ''}
        </span>
        <span>
          <span className={s.who}>
            <span className={b.pickTitle}>{label ?? p.name}</span>
            <span className={p.chip === 'yes' ? s.chipYes : p.chip === 'cant' ? s.chipNo : s.chip}>{locked ? 'Teaching' : chip(p)}</span>
          </span>
          {meta ? <span className={b.pickMeta}>{meta}</span> : null}
          {blocked && !locked ? <span className={b.pickMeta}>{p.blocked}</span> : null}
          {over && ticked ? <span className={s.overNote}>Over this send’s limit: send again</span> : null}
        </span>
      </button>
    </li>
  );
}

function OfferingDetail({
  row,
  sec,
  ticks,
  overflow,
  readOnly,
  onToggle,
  onMany,
  chip
}: {
  row: PlanRow;
  sec: InviteSection;
  ticks: ReadonlySet<string>;
  overflow: ReadonlySet<string>;
  readOnly: boolean;
  onToggle: (id: string) => void;
  onMany: (ids: string[], on: boolean) => void;
  chip: ChipFn;
}) {
  // Keyed on the offering by its caller, so these start closed for each one.
  const [allTeachers, setAllTeachers] = useState(false);
  const [allScouts, setAllScouts] = useState(false);
  const said = (p: InvitePerson) => p.chip === 'cant';
  const shownTeachers = sec.teachers.filter((p) => !said(p) && (p.tier === 'assigned' || p.tier === 'pending' || p.tier === 'top'));
  const moreTeachers = sec.teachers.filter((p) => !said(p) && (p.tier === 'more' || p.tier === 'scout'));
  const likely = sec.scouts.filter((p) => p.likely && !said(p));
  const rest = sec.scouts.filter((p) => !p.likely && !said(p));
  const saidNo = [...sec.teachers.filter(said).map((p) => ['teach', p] as const), ...sec.scouts.filter(said).map((p) => ['pick', p] as const)];
  const item = (kind: InviteKind, p: InvitePerson) => {
    const id = tickId(kind, sec.key, p.personId);
    return <PersonTick key={`${kind}-${p.personId}`} id={id} p={p} on={ticks.has(id)} over={overflow.has(id)} readOnly={readOnly} onToggle={onToggle} chip={chip} />;
  };
  const tickable = (kind: InviteKind, list: InvitePerson[]) => list.filter((p) => !p.blocked && p.tier !== 'assigned').map((p) => tickId(kind, sec.key, p.personId));
  return (
    <div className={s.detailBody}>
      <h2 id="invite-detail-title" className={s.detailTitle} tabIndex={-1}>
        {row.codeLabel ? <span className={b.code}>{row.codeLabel}</span> : null}
        {row.title}
      </h2>
      {readOnly ? null : (
        <p className={s.controls}>
          <button type="button" className={s.quiet} onClick={() => onMany(tickable('pick', likely.filter((p) => p.chip !== 'yes' && p.chip !== 'picked')), true)}>
            Tick all likely
          </button>
          <button type="button" className={s.quiet} onClick={() => onMany([...tickable('teach', sec.teachers), ...tickable('pick', sec.scouts)], false)}>
            Clear
          </button>
        </p>
      )}
      <h3 className={b.editLabel}>Teachers</h3>
      {shownTeachers.length || moreTeachers.length ? (
        <ul className={b.pickList}>
          {shownTeachers.map((p) => item('teach', p))}
          {allTeachers ? moreTeachers.map((p) => item('teach', p)) : null}
        </ul>
      ) : (
        <p className={b.pickMeta}>Nobody listed can teach it yet.</p>
      )}
      {moreTeachers.length && !allTeachers ? (
        <button type="button" className={s.quiet} onClick={() => setAllTeachers(true)}>
          Show everyone who could teach ({moreTeachers.length})
        </button>
      ) : null}
      <h3 className={b.editLabel}>Scouts</h3>
      {likely.length || (allScouts && rest.length) ? (
        <ul className={b.pickList}>
          {likely.map((p) => item('pick', p))}
          {allScouts ? rest.map((p) => item('pick', p)) : null}
        </ul>
      ) : (
        <p className={b.pickMeta}>No likely scouts.</p>
      )}
      {rest.length && !allScouts ? (
        <button type="button" className={s.quiet} onClick={() => setAllScouts(true)}>
          Show all eligible ({rest.length})
        </button>
      ) : null}
      {saidNo.length ? (
        <details className={b.others}>
          <summary>Said no ({saidNo.length})</summary>
          <ul className={b.pickList}>{saidNo.map(([kind, p]) => item(kind, p))}</ul>
        </details>
      ) : null}
    </div>
  );
}

/** By person: one row per scout or adult, every offering they could be asked about, the same ticks. */
function PeopleView({
  sections,
  rowOf,
  ticks,
  overflow,
  readOnly,
  onToggle,
  chip
}: {
  sections: readonly InviteSection[];
  rowOf: ReadonlyMap<string, PlanRow>;
  ticks: ReadonlySet<string>;
  overflow: ReadonlySet<string>;
  readOnly: boolean;
  onToggle: (id: string) => void;
  chip: ChipFn;
}) {
  const people = byPerson(sections);
  if (!people.length) return <p className={b.empty}>Nobody to invite yet.</p>;
  return (
    <ul className={s.people}>
      {people.map((row) => (
        <li key={`${row.kind}-${row.personId}`} className={s.person}>
          <p className={s.personName}>
            {row.name} <span className={s.meta}>{row.kind === 'teach' ? 'to teach' : 'to take'}</span>
          </p>
          <ul className={b.pickList}>
            {row.entries.map(({ key, person }) => {
              const id = tickId(row.kind, key, person.personId);
              const r = rowOf.get(key);
              return <PersonTick key={key} id={id} p={person} on={ticks.has(id)} over={overflow.has(id)} readOnly={readOnly} onToggle={onToggle} chip={chip} label={r ? [r.codeLabel, r.title].filter(Boolean).join(' ') : key} />;
            })}
          </ul>
        </li>
      ))}
    </ul>
  );
}

function Review({
  headingId,
  groups,
  rowOf,
  overflow,
  onPreview,
  foot
}: {
  /** Unique per copy: the sticky Review and the phone Drawer's can both be in the page. */
  headingId: string;
  groups: ReviewGroup[];
  rowOf: ReadonlyMap<string, PlanRow>;
  overflow: number;
  onPreview: (group: ReviewGroup, recipientId: number, opener: HTMLElement) => void;
  foot: ReactNode;
}) {
  const code = (key: string) => rowOf.get(key)?.codeLabel || rowOf.get(key)?.title || key;
  return (
    <div className={s.reviewBody}>
      <h2 id={headingId} className={b.editLabel}>
        Review
      </h2>
      {groups.length ? (
        <ul className={s.groups}>
          {groups.map((g) => (
            <li key={g.family} className={s.group}>
              <p className={s.groupLine}>
                <span className={b.pickTitle}>{g.label}:</span> {g.about.map((a) => `${a.name} (${a.keys.map(code).join(', ')})`).join(', ')}
              </p>
              {g.recipients.map((r) => (
                <button key={r.recipientId} type="button" className={s.quiet} onClick={(e) => onPreview(g, r.recipientId, e.currentTarget)} aria-haspopup="dialog">
                  Preview email{g.recipients.length > 1 ? ` to ${r.name}` : ''}
                </button>
              ))}
            </li>
          ))}
        </ul>
      ) : (
        <p className={b.pickMeta}>Tick someone to invite.</p>
      )}
      {overflow ? <p className={s.overNote}>{plural(overflow, 'more invite')} past this send’s limit: send again after this one.</p> : null}
      <div className={s.reviewFoot}>{foot}</div>
    </div>
  );
}

/** The email as it would go out, rendered by the real digest renderer (renderInviteDigest + renderMarkdownEmail). */
function PreviewDialog({
  group,
  recipientId,
  recipients,
  rowOf,
  template,
  day,
  onClose
}: {
  group: ReviewGroup;
  recipientId: number;
  recipients: InviteTabData['recipients'];
  rowOf: ReadonlyMap<string, PlanRow>;
  template: InviteTemplate;
  day: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    const dlg = ref.current;
    if (dlg && typeof dlg.showModal === 'function' && !dlg.open) dlg.showModal();
    else dlg?.setAttribute('open', '');
  }, []);
  const rec = group.recipients.find((r) => r.recipientId === recipientId);
  const info = recipients[recipientId];
  const isScout = info?.isScout ?? false;
  const items = (rec?.items ?? []).map((i) => ({
    kind: i.kind,
    inviteeName: i.inviteeName,
    aboutRecipient: i.kind === 'teach' || isScout,
    code: rowOf.get(i.key)?.codeLabel || 'Focus',
    topic: rowOf.get(i.key)?.title ?? i.key,
    minutes: '',
    url: '#preview'
  }));
  const about = [
    ...(rec?.items ?? []).filter((i) => i.kind === 'pick').map((i) => ({ personId: i.inviteeId, name: i.inviteeName })),
    ...((rec?.items ?? []).some((i) => i.kind === 'teach') ? [{ personId: recipientId, name: '' }] : [])
  ];
  const { subject, md } = renderInviteDigest(template, { name: info?.first ?? rec?.name ?? '', people: digestPeople(recipientId, isScout, about), day }, items);
  const { html } = renderMarkdownEmail({ md });
  return (
    <dialog
      ref={ref}
      className={s.preview}
      aria-labelledby="invite-preview-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <h2 id="invite-preview-title" className={b.confirmTitle}>
        Email to {rec?.name ?? 'them'}
      </h2>
      <p className={b.pickMeta}>Subject: {subject}</p>
      {/* renderMarkdownEmail escapes everything; only its own markup makes tags. */}
      <div className={s.previewBody} dangerouslySetInnerHTML={{ __html: html }} />
      <div className={b.confirmActions}>
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </dialog>
  );
}
