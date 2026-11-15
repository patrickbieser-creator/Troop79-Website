'use client';

/**
 * The record bar's "More actions…" menu (Plans/Person-Record-One-Save.md): the record-level
 * actions that are not edits and so never join the draft — Move to adults (a scout who has
 * aged out), Merge with another person…, Mark / Unmark as test record, and Delete <name>…
 * last. Each opens a dialog that names the consequence; destructive ones are danger dialogs.
 * Replaces the Danger zone and the Test record card.
 */
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../../../../_components/button';
import { ActionsMenu, type ActionsMenuOption } from '../../../_components/actions-menu';
import { promoteScoutToAdult } from '../../lookups/actions';
import { deletePerson, mergePersonInto, searchPeople, setPersonIsTest } from '../person-actions';
import { ConfirmDialog, useImmediate, type ConfirmSpec } from './confirm-dialog';
import type { PersonKind, RosterTab, ScoutRecordRow } from './record-types';
import styles from './record.module.css';

const ROSTER = '/admin/advancement/roster';

type Hit = { id: number; display_name: string; primary_email: string | null };
type Pending =
  | { kind: 'merge-pick' }
  | { kind: 'merge'; survivor: Hit }
  | { kind: 'delete' }
  | { kind: 'promote' }
  | { kind: 'test'; next: boolean };

export function MoreActions({
  personId,
  name,
  kind,
  from,
  active,
  scout,
  leaderCode,
  isTest,
  counts,
  householdLabel,
  disabled,
  onNotice
}: {
  personId: number;
  name: string;
  kind: PersonKind;
  from: RosterTab;
  active: boolean;
  scout: ScoutRecordRow | null;
  leaderCode: string | null;
  isTest: boolean;
  counts: { emails: number; relationships: number; roles: number };
  householdLabel: string | null;
  /** While the draft is dirty: these act on the SAVED record, so Save or Discard first. */
  disabled?: boolean;
  onNotice: (n: { variant: 'success' | 'error'; message: string }) => void;
}) {
  const router = useRouter();
  const imm = useImmediate();
  const [pending, setPending] = useState<Pending | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const seq = useRef(0);

  const isScout = kind === 'scout' && scout != null;
  const blockers: string[] = [];
  if (scout) blockers.push(`a scout record (${scout.id})`);
  if (leaderCode) blockers.push(`sign-off initials (${leaderCode})`);
  const deleteReason = blockers.length ? `Still attached: ${blockers.join(', ')}` : null;

  const options: ActionsMenuOption[] = [
    ...(isScout && active && !scout?.is_webelos ? [{ value: 'promote', label: 'Move to adults (aged out)…' }] : []),
    { value: 'merge', label: 'Merge with another person…' },
    { value: 'test', label: isTest ? 'Unmark as test record…' : 'Mark as test record…' },
    { value: 'divider', label: '──────────', disabled: true },
    { value: 'delete', label: `Delete ${name}…` }
  ];

  function open(value: string) {
    setDialogError(null);
    if (value === 'promote') setPending({ kind: 'promote' });
    else if (value === 'merge') {
      setQ('');
      setHits([]);
      setPending({ kind: 'merge-pick' });
    } else if (value === 'test') setPending({ kind: 'test', next: !isTest });
    else if (value === 'delete') setPending({ kind: 'delete' });
  }

  function search(value: string) {
    setQ(value);
    if (value.trim().length < 2) {
      setHits([]);
      return;
    }
    const mine = ++seq.current;
    void searchPeople(value).then((rows) => {
      if (seq.current === mine) setHits(rows.filter((r) => r.id !== personId));
    });
  }

  function finish(ok: boolean, failMessage: string) {
    if (ok) setPending(null);
    else setDialogError(imm.error ?? failMessage);
  }

  function confirm() {
    if (!pending) return;
    const p = pending;
    if (p.kind === 'merge') {
      void imm
        .run(
          () => mergePersonInto(personId, p.survivor.id),
          () => router.push(`${ROSTER}/${p.survivor.id}?from=${from}`),
          `Merged. Everything from ${name} moved onto ${p.survivor.display_name}.`
        )
        .then((ok) => finish(ok, 'Nothing was merged.'));
    } else if (p.kind === 'delete') {
      void imm
        .run(() => deletePerson(personId), () => router.push(`${ROSTER}?tab=${from}`), `Deleted ${name}.`)
        .then((ok) => finish(ok, 'Nothing was deleted.'));
    } else if (p.kind === 'promote') {
      const fd = new FormData();
      fd.set('scout_id', scout?.id ?? '');
      void imm
        .run(
          () => promoteScoutToAdult(fd),
          () => {
            onNotice({ variant: 'success', message: `${name} is now an adult on the roster (scout record: Aged out).` });
            router.refresh();
          },
          'Moved to adults.'
        )
        .then((ok) => finish(ok, 'Nothing changed.'));
    } else if (p.kind === 'test') {
      void imm
        .run(
          () => setPersonIsTest(personId, p.next),
          () => {
            onNotice({ variant: 'success', message: p.next ? `${name} is marked as a test record.` : `${name} is no longer a test record.` });
            router.refresh();
          },
          'Saved.'
        )
        .then((ok) => finish(ok, 'Nothing changed.'));
    }
  }

  function spec(p: Exclude<Pending, { kind: 'merge-pick' }>): ConfirmSpec {
    if (p.kind === 'merge') {
      const s = p.survivor.display_name;
      return {
        title: `Merge ${name} into ${s}?`,
        body: (
          <>
            <p className={styles.copy}>
              <strong>{s}</strong> is kept. Moving onto them from {name}:
            </p>
            <ul className={styles.consequences}>
              <li>
                {counts.emails} email address{counts.emails === 1 ? '' : 'es'}, {counts.relationships} relationship
                {counts.relationships === 1 ? '' : 's'}, {counts.roles} role record{counts.roles === 1 ? '' : 's'}
              </li>
              <li>Household: {householdLabel ? `${householdLabel}, if ${s} has none` : 'none to move'}</li>
              <li>Ledger history and event sign-ups follow</li>
              <li>Blank fields on {s} are filled from {name}; where both have a value, {s}&rsquo;s is kept</li>
              <li>
                {name}&rsquo;s record is flagged as merged, not erased. <strong>Undoing a merge is a manual job.</strong>
              </li>
            </ul>
          </>
        ),
        okLabel: `Merge into ${s}`,
        danger: true
      };
    }
    if (p.kind === 'delete') {
      return {
        title: `Delete ${name} permanently?`,
        body: (
          <ul className={styles.consequences}>
            <li>Their record, email addresses and household membership are erased. This can&rsquo;t be undone.</li>
            {deleteReason ? (
              <li>
                <strong>Can&rsquo;t delete:</strong> {blockers.join(' and ')} still attached. Merge instead, which keeps
                everything.
              </li>
            ) : null}
          </ul>
        ),
        okLabel: 'Delete permanently',
        danger: true,
        okDisabledReason: deleteReason
      };
    }
    if (p.kind === 'promote') {
      return {
        title: `Move ${name} to adults?`,
        body: (
          <ul className={styles.consequences}>
            <li>Their scout record becomes Inactive (Aged out). Ledger history and clipboard are kept.</li>
            <li>Their sign-off initials become an adult leader&rsquo;s (created if they have none).</li>
            <li>They leave scout rosters, Fast Entry and meeting plan suggestions.</li>
            <li>
              Record any outstanding sign-offs (an Eagle board of review, say) <strong>before</strong> moving them.
            </li>
          </ul>
        ),
        okLabel: 'Move to adults'
      };
    }
    return {
      title: p.next ? `Mark ${name} as a test record?` : `Unmark ${name} as a test record?`,
      body: (
        <p className={styles.copy}>
          {p.next
            ? 'A test record is left out of the EmailOctopus sync and the BSA roster check.'
            : 'They go back into the EmailOctopus sync and the BSA roster check.'}
        </p>
      ),
      okLabel: p.next ? 'Mark as test record' : 'Unmark'
    };
  }

  return (
    <>
      <span title={disabled ? 'Save or discard your changes first' : undefined}>
        <ActionsMenu
          options={options}
          onAction={open}
          ariaLabel={`More actions for ${name}`}
          placeholder="More actions…"
          disabled={disabled || imm.busy}
        />
      </span>

      {pending?.kind === 'merge-pick' && (
        <ConfirmDialog
          spec={{
            title: `Merge ${name} with another person`,
            body: (
              <>
                <p className={styles.copy}>
                  Pick the person to keep. Everything on {name}&rsquo;s record moves to them.
                </p>
                <input
                  type="search"
                  className={styles.input}
                  aria-label="Person to keep"
                  placeholder="Search by name…"
                  value={q}
                  onChange={(e) => search(e.target.value)}
                  autoFocus
                />
                {q.trim().length >= 2 && hits.length === 0 && <p className={styles.hint}>No one matches.</p>}
                {hits.length > 0 && (
                  <ul className={styles.results}>
                    {hits.map((h) => (
                      <li key={h.id}>
                        <Button size="sm" variant="quiet" onClick={() => setPending({ kind: 'merge', survivor: h })}>
                          {h.display_name}
                          {h.primary_email ? <span className={styles.muted}> · {h.primary_email}</span> : null}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ),
            okLabel: 'Pick a person above',
            okDisabledReason: 'Pick the person to keep'
          }}
          busy={false}
          error={null}
          onConfirm={() => undefined}
          onCancel={() => setPending(null)}
        />
      )}
      {pending && pending.kind !== 'merge-pick' && (
        <ConfirmDialog
          key={pending.kind}
          spec={spec(pending)}
          busy={imm.busy}
          error={dialogError}
          onConfirm={confirm}
          onCancel={() => setPending(null)}
        />
      )}
    </>
  );
}
