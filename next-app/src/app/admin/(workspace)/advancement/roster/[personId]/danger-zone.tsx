'use client';

/**
 * Danger zone — a collapsed disclosure at the bottom of the main column
 * (Phase 3). No standing prose: the consequences live in the confirm
 * dialogs, which Merge and Delete BOTH get (Jenna's #4 — the old editor
 * merged on a single click).
 *
 *   Merge    search for the person to keep → confirm listing what moves
 *            (emails, relationships, roles, household, ledger) → on success
 *            the page navigates to the survivor's record.
 *   Delete   confirm; the button is greyed with the reason while a scout or
 *            leader record is attached (deletePerson's own blockers, known
 *            client-side). Anything it can only see server-side — an event
 *            signup, a library submission — comes back as its message inside
 *            the dialog.
 *   Promote  scouts only, while active: the scout editor's confirm copy.
 */
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../../../../_components/button';
import { Notice } from '../../../_components/notice';
import { promoteScoutToAdult } from '../../lookups/actions';
import { deletePerson, mergePersonInto, searchPeople } from '../person-actions';
import { ConfirmDialog, useImmediate, type ConfirmSpec } from './immediate';
import type { PersonKind, RosterTab, ScoutRecordRow } from './record-types';
import styles from './person-record.module.css';

const ROSTER = '/admin/advancement/roster';

type Hit = { id: number; display_name: string; primary_email: string | null };
type Pending = { kind: 'merge'; survivor: Hit } | { kind: 'delete' } | { kind: 'promote' };

export function DangerZone({
  personId,
  name,
  kind,
  from,
  active,
  scout,
  leader,
  emailCount,
  relationshipCount,
  roleCount,
  householdLabel,
  onPromoted
}: {
  personId: number;
  name: string;
  kind: PersonKind;
  from: RosterTab;
  active: boolean;
  scout: ScoutRecordRow | null;
  leader: { code: string } | null;
  emailCount: number;
  relationshipCount: number;
  roleCount: number;
  householdLabel: string | null;
  onPromoted: () => void;
}) {
  const router = useRouter();
  const imm = useImmediate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [searching, setSearching] = useState(false);
  const seqRef = useRef(0);
  const [pending, setPending] = useState<Pending | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  // deletePerson refuses to orphan these; say so before the click.
  const blockers: string[] = [];
  if (scout) blockers.push(`a scout record (${scout.id})`);
  if (leader) blockers.push(`a leader record (${leader.code})`);
  const deleteReason = blockers.length ? `Still attached: ${blockers.join(', ')}` : null;

  function search(value: string) {
    setQ(value);
    if (value.trim().length < 2) {
      setHits([]);
      setSearching(false);
      return;
    }
    const mine = seqRef.current + 1;
    seqRef.current = mine;
    setSearching(true);
    void searchPeople(value)
      .then((rows) => {
        if (seqRef.current !== mine) return;
        setHits(rows.filter((r) => r.id !== personId));
        setSearching(false);
      })
      .catch(() => {
        if (seqRef.current === mine) setSearching(false);
      });
  }

  function start(p: Pending) {
    setDialogError(null);
    setPending(p);
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
        .then((ok) => {
          if (ok) setPending(null);
          else setDialogError('Nothing was merged — see the message above.');
        });
      return;
    }
    if (p.kind === 'delete') {
      void imm
        .run(
          () => deletePerson(personId),
          () => router.push(`${ROSTER}?tab=${from}`),
          `Deleted ${name}.`
        )
        .then((ok) => {
          if (ok) setPending(null);
          else setDialogError('Nothing was deleted — see the message above.');
        });
      return;
    }
    const fd = new FormData();
    fd.set('scout_id', scout?.id ?? '');
    void imm
      .run(
        () => promoteScoutToAdult(fd),
        () => {
          onPromoted();
          router.refresh();
        },
        `Promoted. ${name} is now an inactive scout (Aged out) and an adult on the roster.`
      )
      .then((ok) => {
        if (ok) setPending(null);
        else setDialogError('Nothing changed — see the message above.');
      });
  }

  function specFor(p: Pending): ConfirmSpec {
    if (p.kind === 'merge') {
      const s = p.survivor.display_name;
      return {
        title: `Merge ${name} into ${s}?`,
        body: (
          <>
            <p className={styles.panelCopy}>
              <strong>{s}</strong> is kept. Moving onto them from {name}:
            </p>
            <ul className={styles.consequences}>
              <li>
                {emailCount} email address{emailCount === 1 ? '' : 'es'}
                {emailCount ? ' (added as non-primary)' : ''}
              </li>
              <li>
                {relationshipCount} relationship{relationshipCount === 1 ? '' : 's'}, {roleCount} role record
                {roleCount === 1 ? '' : 's'}
              </li>
              <li>Household: {householdLabel ? `${householdLabel}, if ${s} has none` : 'none to move'}</li>
              <li>Ledger history and event signups follow, so nothing is re-entered</li>
              <li>
                Blank fields on {s} are filled from {name}; conflicting values keep {s}&rsquo;s
              </li>
              <li>
                {name}&rsquo;s record is flagged as merged, not destroyed. <strong>Undoing a merge is a manual job.</strong>
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
            <li>Their record, email addresses and household membership are erased</li>
            <li>This cannot be undone</li>
            {deleteReason ? (
              <li>
                <strong>Refused:</strong> {blockers.join(' and ')} still attached. Remove it first — or merge, which
                keeps everything.
              </li>
            ) : null}
          </ul>
        ),
        okLabel: 'Delete permanently',
        danger: true,
        okDisabledReason: deleteReason
      };
    }
    return {
      title: `Promote ${name} to adult (turned 18)?`,
      body: (
        <ul className={styles.consequences}>
          <li>Scout record becomes Inactive (Aged out) — ledger history and clipboard are preserved</li>
          <li>Their sign-off initials become an ADULT leader (created if they have none)</li>
          <li>They leave scout rosters, Fast Entry and Meeting Plan suggestions</li>
          <li>
            Record any outstanding sign-offs (e.g. Eagle BoR) <strong>before</strong> promoting
          </li>
        </ul>
      ),
      okLabel: 'Promote to adult'
    };
  }

  const isScout = kind === 'scout' && scout != null;

  return (
    <section className={`${styles.card} ${styles.dangerCard}`} aria-label="Danger zone">
      <div className={styles.cardHead}>
        <h2>Danger zone</h2>
        <span className={styles.dangerMeta}>
          {isScout ? 'promote · ' : ''}merge · delete
        </span>
        <Button size="sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide' : 'Show'}
        </Button>
      </div>
      {open && (
        <div className={styles.cardBody}>
          {imm.error && <Notice>{imm.error}</Notice>}
          {imm.notice && <Notice variant="success">{imm.notice}</Notice>}

          {isScout && active && (
            <div className={styles.dangerRow}>
              <Button disabled={imm.busy} onClick={() => start({ kind: 'promote' })}>
                Promote to adult (18+)…
              </Button>
              <span className={styles.hint}>
                Scout record goes Inactive (Aged out); ledger and clipboard are kept; they become an adult on the
                roster.
              </span>
            </div>
          )}

          <div>
            <div className={styles.dangerRow}>
              <strong>Merge into another person</strong>
              <span className={styles.hint}>
                Almost always the right choice for a duplicate. Everything moves to the person you keep; this record is
                flagged, not destroyed.
              </span>
            </div>
            <div className={styles.addRow}>
              <input
                type="search"
                aria-label="Merge into"
                placeholder="Search for the person to keep (2+ letters)"
                value={q}
                disabled={imm.busy}
                onChange={(e) => search(e.target.value)}
              />
            </div>
            {searching && <p className={styles.hint}>Searching…</p>}
            {!searching && q.trim().length >= 2 && hits.length === 0 && <p className={styles.hint}>No one matches.</p>}
            {hits.length > 0 && (
              <ul className={styles.results}>
                {hits.map((h) => (
                  <li key={h.id}>
                    <Button
                      size="sm"
                      variant="quiet"
                      className={styles.resultBtn}
                      disabled={imm.busy}
                      onClick={() => start({ kind: 'merge', survivor: h })}
                    >
                      {h.display_name}
                      {h.primary_email ? <span className={styles.muted}> · {h.primary_email}</span> : null}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={styles.dangerRow}>
            <Button
              variant="danger"
              disabled={imm.busy || deleteReason != null}
              title={deleteReason ?? undefined}
              onClick={() => start({ kind: 'delete' })}
            >
              Delete this person…
            </Button>
            <span className={styles.hint}>
              {deleteReason
                ? `Refused while anything is attached — ${blockers.join(', ')}. Merge instead, which moves everything across.`
                : 'Nothing is attached, so deletion is possible. It cannot be undone.'}
            </span>
          </div>
        </div>
      )}

      {pending && (
        <ConfirmDialog
          spec={specFor(pending)}
          busy={imm.busy}
          error={dialogError}
          onConfirm={confirm}
          onCancel={() => setPending(null)}
        />
      )}
    </section>
  );
}
