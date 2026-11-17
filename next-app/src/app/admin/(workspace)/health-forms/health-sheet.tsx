'use client';

/**
 * The admin Health Forms record sheet (Plans/Admin-Health-Record-Sheet-Redesign.md, version B: two panes). Left: what
 * an adult needs at a glance, the family's note (always there; a leader can paste one in) and who to contact. Right: one card per form, with that form's
 * actions on its card (Change… opens replace / remove / add / Good until in place). The footer (HealthSheetFooter) carries the review, with an undo, and Close.
 *
 * Every write goes through `actions` and answers with the record as it now is; `onRecord` puts it on screen. Status
 * rules come from lib/health-records; nothing is re-derived here.
 */
import { useRef, useState, useTransition } from 'react';
import {
  HEALTH_KIND,
  HEALTH_KINDS,
  goodUntilSeed,
  kindStatus,
  nextPage,
  pageName,
  type HealthKind,
  type HealthPage,
  type HealthStatus
} from '@/lib/health-records';
import type { HealthContact, HealthRecordView } from '@/lib/health-store';
import { shrinkPhoto } from '@/lib/shrink-photo';
import { fmtDate } from '@/lib/format-date';
import { Button } from '../../_components/button';
import { AddButton } from '../_components/add-button';
import { Badge, type BadgeVariant } from '../_components/badge';
import { DatePickerField } from '../_components/date-picker-field';
import type { SheetResult } from './actions';
import styles from './health-sheet.module.css';

export interface SheetActions {
  upload: (fd: FormData) => Promise<SheetResult>;
  saveGoodUntil: (input: { personId: number; kind: string; goodUntil: string | null }) => Promise<SheetResult>;
  remove: (pageId: string, personId: number) => Promise<SheetResult>;
  setReviewed: (personId: number, on: boolean) => Promise<SheetResult>;
  setInBsaForm: (personId: number, on: boolean) => Promise<SheetResult>;
  saveNote: (personId: number, text: string) => Promise<SheetResult>;
  remind: (personId: number) => Promise<SheetResult>;
}

const FAILED = 'That didn’t save. Try again.';
const digits = (phone: string) => phone.replace(/[^\d+]/g, '');

/** Runs one write: busy while it works, the problem in place when it fails, the new record when it lands. */
function useSheetWrite(onRecord: (r: HealthRecordView) => void) {
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (work: () => Promise<SheetResult>, then?: () => void) =>
    start(async () => {
      setError(null);
      const res = await work().catch(() => ({ ok: false as const, error: FAILED }));
      if (!res.ok) setError(res.error);
      else {
        onRecord(res.record);
        then?.();
      }
    });
  return { busy, error, run };
}

export function HealthSheet({ record, today, actions, onRecord }: { record: HealthRecordView; today: string; actions: SheetActions; onRecord: (r: HealthRecordView) => void }) {
  return (
    <div className={styles.split}>
      <div className={styles.left}>
        <FamilyNote record={record} actions={actions} onRecord={onRecord} />
        <section aria-labelledby={`contacts-${record.personId}`}>
          <h3 id={`contacts-${record.personId}`} className={styles.paneHead}>
            Who to contact
          </h3>
          {record.contacts.length === 0 ? (
            <p className={styles.muted}>No parent or guardian on file.</p>
          ) : (
            <ul className={styles.contacts}>
              {record.contacts.map((c) => (
                <Contact key={c.personId} c={c} />
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className={styles.forms} aria-labelledby={`forms-${record.personId}`}>
        <h3 id={`forms-${record.personId}`} className={styles.paneHead}>
          Forms on file
        </h3>
        <ul className={styles.cards}>
          {HEALTH_KINDS.map((k) => (
            <FormCard key={k} kind={k} record={record} today={today} actions={actions} onRecord={onRecord} />
          ))}
        </ul>
      </section>
    </div>
  );
}

/** A note this long shows its first lines, with Show more. */
const NOTE_LINES = 4;
const NOTE_CHARS = 280;

/** "From the family": always shown, even empty. A leader pastes in what a family sent by email (Patrick, 2026-11-17). */
function FamilyNote({ record, actions, onRecord }: { record: HealthRecordView; actions: SheetActions; onRecord: (r: HealthRecordView) => void }) {
  const { busy, error, run } = useSheetWrite(onRecord);
  const [draft, setDraft] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const text = record.told;
  const long = !!text && (text.length > NOTE_CHARS || text.split('\n').length > NOTE_LINES);
  const saved = text ?? '';
  const titleId = `note-${record.personId}`;

  return (
    <section className={styles.familyNote} aria-labelledby={titleId}>
      <h3 id={titleId} className={styles.noteTitle}>
        From the family
      </h3>
      {draft != null ? (
        <>
          <label className={styles.noteLabel}>
            <span>Things we should know</span>
            <textarea className={styles.noteBox} rows={8} value={draft} onChange={(e) => setDraft(e.target.value)} disabled={busy} autoFocus />
          </label>
          <div className={styles.noteActs}>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy || draft.trim() === saved}
              title={draft.trim() === saved ? 'No changes to save yet' : undefined}
              onClick={() => run(() => actions.saveNote(record.personId, draft), () => setDraft(null))}
            >
              {draft.trim() === saved ? 'Saved' : 'Save note'}
            </Button>
            <Button variant="quiet" size="sm" disabled={busy} onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <>
          {text ? (
            <p className={`${styles.noteText} ${long && !more ? styles.noteClamped : ''}`}>{text}</p>
          ) : (
            <p className={styles.hint}>Nothing from the family yet.</p>
          )}
          <div className={styles.noteActs}>
            {long && (
              <Button variant="quiet" size="sm" onClick={() => setMore((v) => !v)} aria-expanded={more}>
                {more ? 'Show less' : 'Show more…'}
              </Button>
            )}
            <Button variant="quiet" size="sm" onClick={() => setDraft(saved)}>
              {text ? 'Edit note' : 'Add a note'}
            </Button>
          </div>
          {text && <p className={styles.hint}>Typed by the family or a leader, not read from the form.</p>}
        </>
      )}
      {busy && (
        <p role="status" className={styles.muted}>
          Saving…
        </p>
      )}
      {error && (
        <p role="alert" className={styles.problem}>
          {error}
        </p>
      )}
    </section>
  );
}

function Contact({ c }: { c: HealthContact }) {
  return (
    <li>
      <span className={styles.contactName}>{c.name}</span>
      {c.phone ? <a href={`tel:${digits(c.phone)}`}>{c.phone}</a> : <span className={styles.muted}>No phone on file</span>}
      {c.email && <a href={`mailto:${c.email}`}>{c.email}</a>}
    </li>
  );
}

const STATUS_BADGE: Record<HealthStatus, { variant: BadgeVariant; label: string }> = {
  on_file: { variant: 'success', label: 'On file' },
  expires_soon: { variant: 'warning', label: 'Expires soon' },
  expired: { variant: 'danger', label: 'Expired' },
  missing: { variant: 'danger', label: 'Missing' }
};

/** "Reminder emailed to Dana Kowalski on Nov 16, 2026": contact names where an address is theirs. */
function reminderLine(record: HealthRecordView): string | null {
  const r = record.lastReminder;
  if (!r) return null;
  const nameOf = new Map(record.contacts.filter((c) => c.email).map((c) => [c.email!.toLowerCase(), c.name]));
  const who = [...new Set(r.to.map((e) => nameOf.get(e) ?? e))];
  const list = who.length <= 2 ? who.join(' and ') : `${who.slice(0, -1).join(', ')} and ${who.at(-1)}`;
  return `✓ Reminder emailed to ${list} on ${fmtDate(r.at)}`;
}

function FormCard({ kind, record, today, actions, onRecord }: { kind: HealthKind; record: HealthRecordView; today: string; actions: SheetActions; onRecord: (r: HealthRecordView) => void }) {
  const def = HEALTH_KIND[kind];
  const pages = record.pages.filter((p) => p.kind === kind);
  const status = kindStatus(kind, pages, today);
  const expires = pages.map((p) => p.expiresOn).filter((d): d is string => !!d).sort()[0] ?? null;
  const { busy, error, run } = useSheetWrite(onRecord);
  const [editing, setEditing] = useState(false);

  // The immunization record is always needed (Patrick, 2026-11-17): filled in on Part C (a leader's mark), attached,
  // or missing.
  const isImm = kind === 'immunization';
  const onPartC = isImm && pages.length === 0 && !!record.inBsaForm;
  const partCOnFile = record.pages.some((p) => p.kind === 'bsa_c');
  // A form missing or run out is what the leader came for: full width, red, with its next steps. Part C too: the
  // reviewers know which trips need it.
  const needs = !onPartC && (status === 'missing' || status === 'expired');
  const badge = onPartC
    ? { variant: 'success' as const, label: 'On Part C' }
    : isImm && status === 'on_file'
      ? { variant: 'success' as const, label: 'Attached' }
      : STATUS_BADGE[status];

  const cls = [styles.card, needs ? styles.cardNeeds : ''].filter(Boolean).join(' ');
  const canEmail = record.contacts.some((c) => c.email);

  return (
    <li className={cls}>
      <div className={styles.cardHead}>
        <span className={styles.cardName}>
          {def.label}
        </span>
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </div>

      {pages.length > 0 && (
        <p className={styles.cardMeta}>
          {def.pageNames
            ? def.pageNames.filter((_, i) => pages.some((p) => p.page === i + 1)).join(' and ') + (pages.length < def.pageNames.length ? ' only' : '')
            : `${pages.length} page${pages.length === 1 ? '' : 's'}`}
          {expires && ` · Good until ${fmtDate(expires)}`}
        </p>
      )}

      {onPartC && record.inBsaForm && (
        <>
          <p className={styles.cardMeta}>
            Filled in on Part C. Marked by {record.inBsaForm.byName} on {fmtDate(record.inBsaForm.at)}.
          </p>
          <div className={styles.cardActs}>
            <Button variant="quiet" size="sm" disabled={busy} onClick={() => run(() => actions.setInBsaForm(record.personId, false))}>
              Not on Part C
            </Button>
            {!editing && (
              <Button variant="quiet" size="sm" disabled={busy} onClick={() => setEditing(true)} aria-label={`Upload ${def.label}`}>
                Upload…
              </Button>
            )}
          </div>
        </>
      )}

      {needs && (
        <>
          <p className={styles.cardMeta}>{reminderLine(record) ?? (canEmail ? 'No reminder sent yet.' : 'No email on file for this family. Call them instead.')}</p>
          <div className={styles.cardActs}>
            {canEmail && (
              <AddButton disabled={busy} onClick={() => run(() => actions.remind(record.personId))}>
                {record.lastReminder ? 'Email again' : 'Email reminder'}
              </AddButton>
            )}
            <Button variant="secondary" disabled={busy} onClick={() => setEditing((v) => !v)} aria-expanded={editing}>
              Upload for family
            </Button>
            {isImm && partCOnFile && (
              <Button variant="quiet" disabled={busy} onClick={() => run(() => actions.setInBsaForm(record.personId, true))}>
                It’s on Part C
              </Button>
            )}
          </div>
        </>
      )}

      {pages.length > 0 && !editing && (
        <div className={styles.cardActs}>
          {pages.map((p) => (
            <PageLinks key={p.id} kind={kind} page={p} many={pages.length > 1} />
          ))}
          {!needs && (
            <Button variant="quiet" size="sm" disabled={busy} onClick={() => setEditing(true)} aria-label={`Change ${def.label}`}>
              Change…
            </Button>
          )}
        </div>
      )}
      {pages.length === 0 && !needs && !onPartC && !editing && (
        <div className={styles.cardActs}>
          <Button variant="quiet" size="sm" disabled={busy} onClick={() => setEditing(true)} aria-label={`Upload ${def.label}`}>
            Upload…
          </Button>
        </div>
      )}

      {busy && (
        <p role="status" className={styles.muted}>
          Saving…
        </p>
      )}
      {error && (
        <p role="alert" className={styles.problem}>
          {error}
        </p>
      )}

      {editing && <PagesEditor kind={kind} record={record} pages={pages} expires={expires} today={today} actions={actions} onRecord={onRecord} onDone={() => setEditing(false)} />}
    </li>
  );
}

/** View (in a new tab) and Download for one page; an insurance card's sides are photos, so View is enough. */
function PageLinks({ kind, page, many }: { kind: HealthKind; page: HealthPage; many: boolean }) {
  const href = `/api/health-files/${page.id}`;
  const name = HEALTH_KIND[kind].pageNames ? pageName(kind, page.page).toLowerCase() : many ? pageName(kind, page.page).toLowerCase() : '';
  const pdf = page.contentType === 'application/pdf';
  return (
    <>
      <Button variant="secondary" size="sm" href={href} target="_blank" rel="noopener noreferrer">
        {name ? `View ${name}` : 'View'}
      </Button>
      {(pdf || !HEALTH_KIND[kind].pageNames) && (
        <Button variant="secondary" size="sm" href={`${href}?download=1`}>
          {name ? `Download ${name}` : 'Download'}
        </Button>
      )}
    </>
  );
}

/**
 * Upload for family / Replace or remove pages: every page with Replace and Remove (asked first), the add buttons, and
 * the Good until date. Opens inside its card; Done closes it.
 */
function PagesEditor({
  kind,
  record,
  pages,
  expires,
  today,
  actions,
  onRecord,
  onDone
}: {
  kind: HealthKind;
  record: HealthRecordView;
  pages: HealthPage[];
  expires: string | null;
  today: string;
  actions: SheetActions;
  onRecord: (r: HealthRecordView) => void;
  onDone: () => void;
}) {
  const def = HEALTH_KIND[kind];
  const { busy, error, run } = useSheetWrite(onRecord);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [goodUntil, setGoodUntil] = useState(() => goodUntilSeed(expires, today));
  const picker = useRef<HTMLInputElement>(null);
  const target = useRef<number | null>(null);
  const free = nextPage(kind, pages);

  const choose = (page: number) => {
    target.current = page;
    picker.current?.click();
  };
  const onFile = (file: File | undefined) => {
    const page = target.current;
    if (!file || page == null) return;
    run(async () => {
      const small = await shrinkPhoto(file);
      if (!small) return { ok: false, error: 'That photo couldn’t be read. Try another, or choose a PDF.' };
      const fd = new FormData();
      fd.set('personId', String(record.personId));
      fd.set('kind', kind);
      fd.set('page', String(page));
      fd.set('file', small);
      if (def.dated && goodUntil) fd.set('goodUntil', goodUntil);
      return actions.upload(fd);
    });
  };

  return (
    <div className={styles.editor}>
      {pages.length > 0 && (
        <ul className={styles.pageList}>
          {pages.map((p) => (
            <li key={p.id} className={styles.pageRow}>
              <span>
                {pageName(kind, p.page)} <span className={styles.muted}>added {fmtDate(p.uploadedAt)}</span>
              </span>
              {confirming === p.id ? (
                <span className={styles.pageActs}>
                  <span>Remove this page? It is deleted for good.</span>
                  <Button variant="danger" size="sm" disabled={busy} onClick={() => run(() => actions.remove(p.id, record.personId), () => setConfirming(null))}>
                    Remove
                  </Button>
                  <Button variant="quiet" size="sm" disabled={busy} onClick={() => setConfirming(null)}>
                    Keep
                  </Button>
                </span>
              ) : (
                <span className={styles.pageActs}>
                  <Button variant="quiet" size="sm" disabled={busy} onClick={() => choose(p.page)} aria-label={`Replace ${pageName(kind, p.page)} of ${def.label}`}>
                    Replace…
                  </Button>
                  <Button variant="quiet" size="sm" disabled={busy} onClick={() => setConfirming(p.id)} aria-label={`Remove ${pageName(kind, p.page)} of ${def.label}`}>
                    Remove…
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className={styles.cardActs}>
        {def.pageNames
          ? def.pageNames.map((name, i) =>
              pages.some((p) => p.page === i + 1) ? null : (
                <Button key={name} variant="secondary" size="sm" disabled={busy} onClick={() => choose(i + 1)}>
                  + {name}
                </Button>
              )
            )
          : free != null && (
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => choose(free)}>
                {pages.length === 0 ? '+ Add a photo or PDF' : '+ Add another page'}
              </Button>
            )}
      </div>

      {def.dated && (
        <div className={styles.dateRow}>
          <label className={styles.dateLabel}>
            <span>Good until</span>
            <DatePickerField value={goodUntil} onChange={setGoodUntil} compact />
          </label>
          {pages.length > 0 && (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy || goodUntil === expires}
              title={goodUntil === expires ? 'No change to save yet' : undefined}
              onClick={() => run(() => actions.saveGoodUntil({ personId: record.personId, kind, goodUntil: goodUntil || null }))}
            >
              {goodUntil === expires ? 'Saved' : 'Save date'}
            </Button>
          )}
          <span className={styles.muted}>{pages.length === 0 ? 'A year from today unless you change it.' : 'For every page of this form.'}</span>
        </div>
      )}

      <div className={styles.editorFoot}>
        <Button variant="secondary" size="sm" disabled={busy} onClick={onDone}>
          Done
        </Button>
      </div>
      {busy && (
        <p role="status" className={styles.muted}>
          Saving…
        </p>
      )}
      {error && (
        <p role="alert" className={styles.problem}>
          {error}
        </p>
      )}
      <input
        ref={picker}
        type="file"
        accept="image/*,application/pdf"
        className={styles.picker}
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}

/** The footer: the review state (with Undo), "Viewing is logged.", and Close. */
export function HealthSheetFooter({ record, actions, onRecord, onClose }: { record: HealthRecordView; actions: SheetActions; onRecord: (r: HealthRecordView) => void; onClose: () => void }) {
  const { busy, error, run } = useSheetWrite(onRecord);
  // "Review undone" only while it is the latest thing: an upload since then clears the review, and the footer reads
  // plain "Not reviewed" (decision 15).
  const change = record.reviewChange;
  const undone = !record.review && change?.action === 'unreview' && (!record.lastUpload || change.at > record.lastUpload) ? change : null;
  return (
    <div className={styles.foot}>
      <div className={styles.footState}>
        {record.review ? (
          <>
            <Badge variant="success">✓ Reviewed</Badge>
            <span>
              by {record.review.byName} on {fmtDate(record.review.at)}
            </span>
          </>
        ) : (
          <>
            <Badge variant="neutral">Not reviewed</Badge>
            {undone && (
              <span>
                Review undone by {undone.byName} on {fmtDate(undone.at)}
              </span>
            )}
          </>
        )}
        <span className={styles.muted}>Viewing is logged.</span>
        {error && (
          <span role="alert" className={styles.footProblem}>
            {error}
          </span>
        )}
      </div>
      <div className={styles.footActs}>
        {record.review ? (
          <>
            <Button variant="secondary" disabled={busy} onClick={() => run(() => actions.setReviewed(record.personId, false))}>
              Undo review
            </Button>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            <Button variant="primary" disabled={busy} onClick={() => run(() => actions.setReviewed(record.personId, true))}>
              Mark reviewed
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
