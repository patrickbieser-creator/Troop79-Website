'use client';

/**
 * Person Record Page specimens for /admin/styleguide/admin (Plans/Person-Record-One-Save.md,
 * 2026-11-15: one form, one Save). Mirrors the class structure of the record page's own
 * pieces — the sticky record bar, a FormSection's fields (unsaved = navy outline, problem =
 * red outline + note), a Family row, the To finish rail card — so the page's real stylesheet
 * (record.module.css) paints every specimen. The pending banner and History chip reuse the
 * page's components. Display-only: every handler is inert.
 */
import { Notice } from '../../_components/notice';
import { Button } from '../../../_components/button';
import { FormSection } from '../../../_components/form-panel';
import { ActionsMenu } from '../../_components/actions-menu';
import { SaveProblem } from '../../_components/save-state';
import { EditBar } from '../../_components/edit-bar';
import { HistoryChip } from '../../advancement/roster/[personId]/history-rows';
import type { PersonHistoryEntry } from '../../advancement/roster/[personId]/record-types';
import pr from '../../advancement/roster/[personId]/person-record.module.css';
import rs from '../../advancement/roster/[personId]/record.module.css';

const noop = () => {};

/** The ONE sticky record bar: Save + Discard + the status line left, actions right. */
export function RecordBarSpecimen({ dirty }: { dirty: boolean }) {
  return (
    <EditBar
      specimen
      ariaLabel="Record actions (specimen)"
      dirty={dirty}
      pending={false}
      onSave={noop}
      onDiscard={noop}
      status={
        dirty ? (
          <>
            <strong>2 unsaved changes:</strong> Patrol, Swim class
            <span className={rs.also}>Saving will also link Jenna Scarpace as parent of Hadley Baquero.</span>
          </>
        ) : (
          <>
            Last change Nov 15, 2026 by Patrick Bieser ·{' '}
            <button type="button" className={rs.linkBtn} onClick={noop}>
              History (5)
            </button>
          </>
        )
      }
      right={
        <>
          <Button size="sm" onClick={noop}>
            Send sign-in link
          </Button>
          <ActionsMenu
            ariaLabel="More actions (specimen)"
            placeholder="More actions…"
            options={[
              { value: 'merge', label: 'Merge with another person…' },
              { value: 'test', label: 'Mark as test record…' },
              { value: 'd', label: '──────────', disabled: true },
              { value: 'delete', label: 'Delete Dana Whitlock…' }
            ]}
            onAction={noop}
          />
        </>
      }
    />
  );
}

/** A blocked save: the button stays enabled, the reason sits beside it. */
export function RecordBarBlockedSpecimen() {
  return (
    <EditBar
      specimen
      ariaLabel="Blocked save (specimen)"
      dirty
      pending={false}
      blocked
      onBlocked={noop}
      onSave={noop}
      onDiscard={noop}
      status={<SaveProblem reason="Pick why the scout is inactive" more={1} />}
    />
  );
}

/** The default status line any screen gets: a count while dirty, the screen's own clean line otherwise. */
export function EditBarCountSpecimen({ dirty }: { dirty: boolean }) {
  return (
    <EditBar
      specimen
      ariaLabel={dirty ? 'Unsaved changes (specimen)' : 'Saved (specimen)'}
      dirty={dirty}
      pending={false}
      saveLabel="Save patrol assignments"
      onSave={noop}
      onDiscard={noop}
      changes={3}
      cleanStatus="4 scouts still unassigned"
    />
  );
}

/** Fields in a numbered section: always editable; an unsaved change gets the navy outline,
 *  a problem the red outline and a note under the field. */
export function RecordFieldsSpecimen() {
  return (
    <FormSection num={1} title="Name & troop">
      <div className={rs.grid}>
        <div className={rs.field}>
          <label className={rs.label} htmlFor="sg-pr-first">
            First name
          </label>
          <input id="sg-pr-first" defaultValue="Hadley" />
        </div>
        <div className={`${rs.field} ${rs.changed}`}>
          <label className={rs.label} htmlFor="sg-pr-patrol">
            Patrol
          </label>
          <input id="sg-pr-patrol" defaultValue="Flaming Arrows" />
          <p className={rs.hint}>Changed, not saved yet.</p>
        </div>
        <div className={`${rs.field} ${rs.full}`}>
          <label className={rs.label} htmlFor="sg-pr-reason">
            Why inactive?
          </label>
          <select id="sg-pr-reason" aria-invalid defaultValue="">
            <option value="">Pick a reason…</option>
          </select>
          <p className={rs.problem}>Pick why the scout is inactive</p>
        </div>
      </div>
    </FormSection>
  );
}

/** The Family section's ONE list: every household member (and anyone linked from outside
 *  it) with a relationship select; a quiet add row last. */
export function FamilyListSpecimen() {
  return (
    <>
      <ul className={rs.list} aria-label="Family (specimen)">
        <li className={rs.row}>
          <span className={rs.rowName}>
            <a href="#sg-family">Jenna Scarpace</a> <span className={rs.rowMeta}>Adult</span>
          </span>
          <span className={rs.rowCtl}>
            <span className={rs.rowMeta}>No relationship</span>
          </span>
        </li>
        <li className={`${rs.row} ${rs.rowChanged}`}>
          <span className={rs.rowName}>
            <a href="#sg-family">Hadley Baquero</a> <span className={rs.rowMeta}>Scout</span>
          </span>
          <span className={rs.rowCtl}>
            <select aria-label="How Adrian and Hadley are related" defaultValue="p">
              <option value="p">Adrian is parent</option>
              <option value="g">Adrian is guardian</option>
              <option value="">No relationship</option>
            </select>
          </span>
        </li>
      </ul>
      <div className={rs.addRow}>
        <Button size="sm" variant="quiet" onClick={noop}>
          + Person to household
        </Button>
      </div>
    </>
  );
}

/** The rail's To finish card: derived from the record; each item focuses its field. */
export function ToFinishSpecimen() {
  return (
    <section className={rs.railCard}>
      <h2>To finish</h2>
      <ul className={rs.todo}>
        <li>
          <button type="button" onClick={noop}>
            YPT expired
          </button>
        </li>
        <li>
          <button type="button" onClick={noop}>
            Health form missing
          </button>
        </li>
        <li>
          <button type="button" onClick={noop}>
            No role<span className={rs.muted}> (optional)</span>
          </button>
        </li>
      </ul>
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
