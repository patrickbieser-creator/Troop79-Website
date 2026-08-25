'use client';

/**
 * Lookups & Admin → Email templates (Plans/Signup-Confirmation-Email.md): the
 * site-wide library, grouped by KIND from the registry in lib/email-templates
 * (an open-ended string, not an enum — a new kind is one registry entry).
 * Each row opens the shared message editor; a template in use is retired,
 * never deleted, so existing signups keep it.
 */
import { useEffect, useRef, useState, useTransition } from 'react';
import { TEMPLATE_KINDS } from '@/lib/email-templates';
import type { ConfirmationContext } from '@/lib/signup-confirmation';
import type { EmailTemplateRow } from './email-template-actions';
import { MessageEditorDialog } from '../../_components/message-editor-dialog';
import { AddButton } from '../../_components/add-button';
import { Badge } from '../../_components/badge';
import { Notice } from '../../_components/notice';
import { Button } from '../../../_components/button';
import styles from './lookups.module.css';

type ActionResult = { ok: boolean; error?: string };

interface Props {
  rows: EmailTemplateRow[];
  previewCtx: ConfirmationContext;
  onCreate: (fd: FormData) => Promise<ActionResult>;
  onUpdate: (fd: FormData) => Promise<ActionResult>;
  onRetire: (fd: FormData) => Promise<ActionResult>;
  onRestore: (fd: FormData) => Promise<ActionResult>;
}

type Editing = { kind: string; row: EmailTemplateRow | null };

export function EmailTemplatesEditor({ rows, previewCtx, onCreate, onUpdate, onRetire, onRestore }: Props) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (editing) dialogRef.current?.showModal();
  }, [editing]);

  function rowAction(row: EmailTemplateRow, fn: (fd: FormData) => Promise<ActionResult>) {
    setBusyId(row.id);
    setErr(null);
    const fd = new FormData();
    fd.set('id', String(row.id));
    startTransition(async () => {
      const res = await fn(fd);
      setBusyId(null);
      if (!res.ok) setErr(res.error ?? 'That did not save.');
    });
  }

  return (
    <>
      {err && <Notice>{err}</Notice>}
      {TEMPLATE_KINDS.map((k) => {
        const group = rows.filter((r) => r.kind === k.kind);
        return (
          <section key={k.kind} aria-label={k.label}>
            <div className={styles.cardToolbar}>
              <h4 className={styles.groupTitle}>{k.label}</h4>
              <AddButton onClick={() => setEditing({ kind: k.kind, row: null })}>+ New template</AddButton>
            </div>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Subject</th>
                  <th>Status</th>
                  <th className={styles.cellRight}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {group.length === 0 ? (
                  <tr>
                    <td colSpan={4} className={styles.muted}>
                      None yet — the built-in wording is used until one is added.
                    </td>
                  </tr>
                ) : (
                  group.map((row) => (
                    <tr key={row.id}>
                      <td>{row.name}</td>
                      <td>{row.subject}</td>
                      <td>{row.retired_at ? <Badge variant="muted">Retired</Badge> : null}</td>
                      <td className={styles.cellRight}>
                        <Button variant="secondary" size="sm" disabled={busyId === row.id} onClick={() => setEditing({ kind: k.kind, row })}>
                          Edit message…
                        </Button>
                        {row.retired_at ? (
                          <Button variant="secondary" size="sm" className={styles.gapLeft} disabled={busyId === row.id} onClick={() => rowAction(row, onRestore)}>
                            Restore
                          </Button>
                        ) : (
                          <Button variant="danger" size="sm" className={styles.gapLeft} disabled={busyId === row.id || isPending} onClick={() => rowAction(row, onRetire)}>
                            Retire
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>
        );
      })}

      {editing && (
        <MessageEditorDialog
          key={editing.row?.id ?? `new-${editing.kind}`}
          ref={dialogRef}
          kind={editing.kind}
          nameField
          title={editing.row ? `Edit “${editing.row.name}”` : 'New template'}
          initial={{ name: editing.row?.name ?? '', subject: editing.row?.subject ?? '', body: editing.row?.body ?? '' }}
          previewCtx={previewCtx}
          onSave={async (subject, body, name) => {
            const fd = new FormData();
            fd.set('name', name);
            fd.set('kind', editing.kind);
            fd.set('subject', subject);
            fd.set('body', body);
            if (editing.row) {
              fd.set('id', String(editing.row.id));
              return onUpdate(fd);
            }
            return onCreate(fd);
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
