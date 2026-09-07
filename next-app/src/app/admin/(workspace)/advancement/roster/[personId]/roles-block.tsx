'use client';

/**
 * Roles — the whole section is one "Takes effect immediately" block
 * (Phase 3; replaces Phase 1's greyed placeholder). Current roles with
 * their start date and a "leader tab" tag on the ones that put a person on
 * the Leaders tab; End… confirms and NAMES the tab move when it is the last
 * such role (Jenna's #6); ended roles stay as history with a Delete for one
 * entered by mistake; a grant row at the bottom. Granting or ending a role
 * that changes the roster tab is announced by the page shell's "now appears
 * under …" notice, fed by the refetched detail's tab.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { fmtDate } from '@/lib/format-date';
import { Button } from '../../../../_components/button';
import { Badge } from '../../../_components/badge';
import { addRole, deleteRole, endRole, getPersonDetail, type GrantableRole, type PersonDetail } from '../person-actions';
import { ConfirmDialog, ImmediateBlock, useImmediate, type ConfirmSpec } from './immediate';
import { GRANTABLE_ROLES, LEADER_ROLES, ROLE_LABEL } from './record-types';
import styles from './person-record.module.css';

export type RoleRow = PersonDetail['roles'][number];

type Pending = { kind: 'end'; role: RoleRow } | { kind: 'delete'; role: RoleRow };

export function RolesBlock({
  personId,
  name,
  roles,
  today,
  onChanged
}: {
  personId: number;
  name: string;
  roles: RoleRow[];
  today: string;
  onChanged: (detail: PersonDetail) => void;
}) {
  const router = useRouter();
  const imm = useImmediate();
  const [newRole, setNewRole] = useState<GrantableRole>('adult_leader');
  const [pending, setPending] = useState<Pending | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const current = roles.filter((r) => !r.end_date);
  const ended = roles.filter((r) => r.end_date);
  const label = (role: string) => ROLE_LABEL[role] ?? role;

  async function refresh() {
    onChanged(await getPersonDetail(personId));
    router.refresh();
  }

  function grant() {
    void imm.run(() => addRole(personId, newRole), refresh, `Granted ${label(newRole)}.`);
  }

  function confirmPending() {
    if (!pending) return;
    const p = pending;
    const fn = p.kind === 'end' ? () => endRole(p.role.id) : () => deleteRole(p.role.id);
    const ok = p.kind === 'end' ? `Ended ${label(p.role.role)}.` : 'Role record deleted.';
    void imm.run(fn, refresh, ok).then((done) => {
      if (done) setPending(null);
      else setDialogError('Nothing changed — see the message above.');
    });
  }

  function specFor(p: Pending): ConfirmSpec {
    if (p.kind === 'delete') {
      return {
        title: `Delete the ended ${label(p.role.role)} record?`,
        body: (
          <p className={styles.panelCopy}>
            This erases it from their history rather than marking it ended. Use only for a role entered by mistake.
          </p>
        ),
        okLabel: 'Delete record',
        danger: true
      };
    }
    const otherLeaderRoles = current.filter((r) => r.id !== p.role.id && LEADER_ROLES.has(r.role));
    const isLeaderRole = LEADER_ROLES.has(p.role.role);
    const moves = isLeaderRole && otherLeaderRoles.length === 0;
    return {
      title: `End ${label(p.role.role)} for ${name}?`,
      body: (
        <ul className={styles.consequences}>
          <li>
            Recorded as held {fmtDate(p.role.start_date)} – {fmtDate(today)}; it stays in their history
          </li>
          {moves ? (
            <li>
              <strong>They move from Leaders to Adults</strong> — still a parent, still in their household, still
              offered at signup
            </li>
          ) : otherLeaderRoles.length > 0 ? (
            <li>They stay on the Leaders tab (other leader roles continue)</li>
          ) : (
            <li>Their roster tab does not change</li>
          )}
          <li>Sign-off initials and past sign-offs are untouched</li>
        </ul>
      ),
      okLabel: 'End role'
    };
  }

  return (
    <ImmediateBlock title="Current roles" state={imm}>
      {current.length ? (
        <ul className={styles.list}>
          {current.map((r) => (
            <li key={r.id}>
              <span className={styles.grow}>
                {label(r.role)} <span className={styles.muted}>since {fmtDate(r.start_date)}</span>
              </span>
              <span className={styles.pills}>{LEADER_ROLES.has(r.role) ? <Badge variant="info">leader tab</Badge> : null}</span>
              <span className={styles.rowActions}>
                <Button
                  size="sm"
                  variant="quiet"
                  disabled={imm.busy}
                  onClick={() => {
                    setDialogError(null);
                    setPending({ kind: 'end', role: r });
                  }}
                >
                  End…
                </Button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.empty}>No current role — listed under Adults.</p>
      )}

      {ended.length > 0 && (
        <div>
          <p className={styles.listHead}>Previously held</p>
          <ul className={styles.list}>
            {ended.map((r) => (
              <li key={r.id}>
                <span className={`${styles.grow} ${styles.muted}`}>
                  {label(r.role)} · {fmtDate(r.start_date)} – {fmtDate(r.end_date)}
                </span>
                <span className={styles.rowActions}>
                  <Button
                    size="sm"
                    variant="quiet"
                    disabled={imm.busy}
                    onClick={() => {
                      setDialogError(null);
                      setPending({ kind: 'delete', role: r });
                    }}
                  >
                    Delete
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={styles.addRow}>
        <select
          aria-label="Role to grant"
          value={newRole}
          disabled={imm.busy}
          onChange={(e) => setNewRole(e.target.value as GrantableRole)}
        >
          {GRANTABLE_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
        <Button size="sm" disabled={imm.busy} onClick={grant}>
          Grant role
        </Button>
      </div>

      {pending && (
        <ConfirmDialog
          spec={specFor(pending)}
          busy={imm.busy}
          error={dialogError}
          onConfirm={confirmPending}
          onCancel={() => setPending(null)}
        />
      )}
    </ImmediateBlock>
  );
}
