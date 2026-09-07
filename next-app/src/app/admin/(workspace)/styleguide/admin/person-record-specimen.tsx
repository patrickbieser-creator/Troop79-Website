'use client';

/**
 * Person Record Page specimens for /admin/styleguide/admin (Plans/Person-
 * Editor-Rethink.md, Phase 6). Reuses the record page's own client pieces
 * where they take plain props (SectionCard, the field kit, ImmediateBlock,
 * HistoryChip) and mirrors the class structure of the pieces that are wired
 * to server actions (Status read row, pending banner, Danger zone) — so the
 * page's real stylesheet is what paints every specimen. Display-only: every
 * handler is inert.
 */
import { Badge } from '../../_components/badge';
import { Notice } from '../../_components/notice';
import { Button } from '../../../_components/button';
import {
  Field,
  FieldGrid,
  ReadRow,
  ReadRows,
  SectionCard,
  SectionFormActions
} from '../../advancement/roster/[personId]/section-card';
import { ImmediateBlock } from '../../advancement/roster/[personId]/immediate';
import { HistoryChip } from '../../advancement/roster/[personId]/history-section';
import type { PersonHistoryEntry } from '../../advancement/roster/[personId]/record-types';
import pr from '../../advancement/roster/[personId]/person-record.module.css';

const noop = () => {};

const READ_FORM = { editing: false, stamped: false, flash: false, startEdit: noop, error: null };
const EDIT_FORM = { editing: true, stamped: false, flash: false, startEdit: noop, error: null };
const CLEAN_ACTIONS = {
  dirty: false,
  blockedReason: null,
  busy: false,
  phase: 'idle' as const,
  cancel: noop,
  submit: noop
};

/** A read-mode section: read rows, ONE Edit, at most one disclosure. */
export function SectionReadSpecimen() {
  return (
    <SectionCard
      title="Details"
      form={READ_FORM}
      help="Age and grade are derived from the birthdate and graduation year; the stored value is the class year."
    >
      <ReadRows>
        <ReadRow label="Birthdate">Jul 12, 2012</ReadRow>
        <ReadRow label="Age" derived>
          14
        </ReadRow>
        <ReadRow label="School">Milwaukee German Immersion</ReadRow>
        <ReadRow label="Health form">{null}</ReadRow>
      </ReadRows>
    </SectionCard>
  );
}

/** The same section in editing mode: Cancel + a dirty-gated Save that
 *  opens disabled ("No changes to save yet"). */
export function SectionEditingSpecimen() {
  return (
    <SectionCard title="Details" form={EDIT_FORM}>
      <FieldGrid>
        <Field label="First name" required>
          <input type="text" defaultValue="Dana" />
        </Field>
        <Field label="Last name" required>
          <input type="text" defaultValue="Whitlock" />
        </Field>
        <Field label="School" full>
          <input type="text" defaultValue="Milwaukee German Immersion" />
        </Field>
      </FieldGrid>
      <SectionFormActions form={CLEAN_ACTIONS} />
    </SectionCard>
  );
}

/** One-click actions live OUTSIDE any form, in a dashed block whose tag
 *  says so in words. */
export function ImmediateBlockSpecimen() {
  return (
    <ImmediateBlock title="Email addresses" state={{ error: null, notice: null }}>
      <ul className={pr.list}>
        <li>
          <span className={pr.grow}>
            dana@example.org <span className={pr.muted}>home</span>
          </span>
          <span className={pr.pills}>
            <Badge variant="info">primary</Badge> <Badge variant="success">verified</Badge>
          </span>
          <span className={pr.rowActions}>
            <Button size="sm" disabled title="Already primary">
              Make primary
            </Button>
            <Button size="sm" variant="danger" disabled title="Keep at least one address">
              Remove
            </Button>
          </span>
        </li>
        <li>
          <span className={pr.grow}>
            d.whitlock@work.example <span className={pr.muted}>work</span>
          </span>
          <span className={pr.pills}>
            <Badge variant="neutral">unverified</Badge>
          </span>
          <span className={pr.rowActions}>
            <Button size="sm">Make primary</Button>
            <Button size="sm" variant="danger">
              Remove
            </Button>
          </span>
        </li>
      </ul>
    </ImmediateBlock>
  );
}

/** The Status read row — a Badge plus its one-line consequence, and ONE
 *  Edit. No Save / Saved button exists here (the Marita bug). */
export function StatusRowSpecimen() {
  return (
    <section className={pr.card} aria-label="Status (specimen)">
      <div className={pr.cardHead}>
        <h2>Status</h2>
        <Button size="sm" onClick={noop}>
          Edit
        </Button>
      </div>
      <div className={pr.cardBody}>
        <dl className={pr.dl}>
          <dt>Status</dt>
          <dd>
            <Badge variant="success">Active</Badge>{' '}
            <span className={pr.sub}>On rosters, dashboards and the Fast Entry picker</span>
          </dd>
        </dl>
      </div>
    </section>
  );
}

/** A family's pending update, inside the section it touches: the shared
 *  warning Notice holding a Field / Current / Proposed table and the two
 *  whole-request decisions. */
export function PendingBannerSpecimen() {
  return (
    <Notice variant="warning" className={pr.pending}>
      <h3 className={pr.pendingHead}>Pending update from the family — awaiting your review</h3>
      <p className={pr.pendingCopy}>
        Submitted Sep 6, 2026, 8:14 PM by <strong>Priya Raman</strong> (verified sign-in) from /profile. Nothing
        below changes until you approve it.
      </p>
      <table className={pr.pendingTable}>
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">Current</th>
            <th scope="col">Proposed</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Phone</th>
            <td className={pr.muted}>(414) 555-0100</td>
            <td>
              <strong>(414) 555-0199</strong>
            </td>
          </tr>
        </tbody>
      </table>
      <div className={pr.actions}>
        <Button variant="danger" size="sm" onClick={noop}>
          Reject…
        </Button>
        <Button variant="primary" size="sm" onClick={noop}>
          Approve
        </Button>
      </div>
    </Notice>
  );
}

const HISTORY_ENTRY: PersonHistoryEntry = {
  id: 1,
  occurredAt: '2026-09-07T14:05:00Z',
  actorLabel: 'Patrick B.',
  actorPersonId: null,
  action: 'person.demographics.update',
  summary: 'Updated phone for Dana Whitlock',
  details: [{ field: 'Phone', from: '(414) 555-0100', to: '(414) 555-0199' }]
};

const SUMMARY_ONLY: PersonHistoryEntry = { ...HISTORY_ENTRY, id: 2, details: null };

/** The History chip: hover for "Field: old → new", click opens the dialog.
 *  A row logged before the cutover shows "summary only". */
export function HistoryChipSpecimen() {
  return (
    <ul className={pr.histList}>
      <li className={pr.histRow}>
        <span className={pr.histWhen}>Sep 7, 2026, 9:05 AM</span>
        <span className={pr.histWhat}>
          <span className={pr.histWho}>{HISTORY_ENTRY.actorLabel}</span> — {HISTORY_ENTRY.summary}{' '}
          <HistoryChip entry={HISTORY_ENTRY} onOpen={noop} />
        </span>
      </li>
      <li className={pr.histRow}>
        <span className={pr.histWhen}>Aug 30, 2026, 4:20 PM</span>
        <span className={pr.histWhat}>
          <span className={pr.histWho}>Family</span> — Change request approved{' '}
          <HistoryChip entry={SUMMARY_ONLY} onOpen={noop} />
        </span>
      </li>
    </ul>
  );
}

/** The Danger zone, collapsed by default: no standing prose — the
 *  consequences live in the confirm dialogs Merge and Delete both open. */
export function DangerZoneSpecimen() {
  return (
    <section className={`${pr.card} ${pr.dangerCard}`} aria-label="Danger zone (specimen)">
      <div className={pr.cardHead}>
        <h2>Danger zone</h2>
        <span className={pr.dangerMeta}>promote · merge · delete</span>
        <Button size="sm" aria-expanded={false} onClick={noop}>
          Show
        </Button>
      </div>
    </section>
  );
}
