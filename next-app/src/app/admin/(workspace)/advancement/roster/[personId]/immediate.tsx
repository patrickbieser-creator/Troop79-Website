'use client';

/**
 * Shared pieces for the "Takes effect immediately" blocks (Plans/Person-
 * Editor-Rethink.md, Phase 3). Emails, relationships and roles commit on
 * click, so they never sit inside a draft form: each block is a dashed
 * `ImmediateBlock` with a text label (never colour-only), a `useImmediate`
 * runner that turns one server action into busy → refetch → success line
 * (or an error Notice), and a `ConfirmDialog` for the steps that must say
 * their consequence before anything is written (removing a verified
 * address, ending a role, merge, delete, promote).
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from '../../../../_components/button';
import { Notice } from '../../../_components/notice';
import { Dialog, DialogActions, DialogBody, DialogHeader } from '../../../_components/dialog';
import styles from './person-record.module.css';

export interface ActionOutcome {
  ok: boolean;
  error?: string;
}

export interface Immediate {
  busy: boolean;
  error: string | null;
  notice: string | null;
  /** Run `fn`; on ok run `after` (the refetch) and show `okMessage`.
   *  Resolves true when everything landed. */
  run: <T extends ActionOutcome>(
    fn: () => Promise<T>,
    after: (res: T) => Promise<void> | void,
    okMessage: string | ((res: T) => string)
  ) => Promise<boolean>;
  fail: (message: string) => void;
  clear: () => void;
}

export function useImmediate(): Immediate {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function run<T extends ActionOutcome>(
    fn: () => Promise<T>,
    after: (res: T) => Promise<void> | void,
    okMessage: string | ((res: T) => string)
  ): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fn();
      if (!res.ok) {
        setError(res.error ?? 'Something went wrong.');
        return false;
      }
      await after(res);
      setNotice(typeof okMessage === 'function' ? okMessage(res) : okMessage);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  return {
    busy,
    error,
    notice,
    run,
    fail: (message) => {
      setNotice(null);
      setError(message);
    },
    clear: () => {
      setError(null);
      setNotice(null);
    }
  };
}

/** The dashed block: heading, the "Takes effect immediately" tag, then the
 *  block's own error / success lines above its list. A landmark (section +
 *  h3) so tests and screen readers can address it by name. */
export function ImmediateBlock({
  title,
  state,
  children
}: {
  title: string;
  state: Pick<Immediate, 'error' | 'notice'>;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section className={styles.imm} aria-labelledby={headingId}>
      <div className={styles.immHead}>
        <h3 id={headingId}>{title}</h3>
        <span className={styles.immTag}>Takes effect immediately</span>
      </div>
      {state.error && <Notice>{state.error}</Notice>}
      {state.notice && <Notice variant="success">{state.notice}</Notice>}
      {children}
    </section>
  );
}

export interface ConfirmSpec {
  title: string;
  body: ReactNode;
  okLabel: string;
  /** Destructive: danger header band + solid danger confirm. */
  danger?: boolean;
  /** Keep the confirm greyed, with this reason as its title. */
  okDisabledReason?: string | null;
}

/**
 * Mounted only while a confirm is pending, so its copy never lingers in
 * the DOM; showModal() once it exists. Every close path (Esc, backdrop,
 * Cancel) lands on `onCancel`; the confirm button runs `onConfirm` and the
 * caller decides whether to unmount (success) or keep it open with `error`.
 */
export function ConfirmDialog({
  spec,
  busy,
  error,
  onConfirm,
  onCancel
}: {
  spec: ConfirmSpec;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dlg = ref.current;
    if (dlg && !dlg.open) dlg.showModal();
  }, []);

  const offReason = spec.okDisabledReason ?? null;
  return (
    <Dialog ref={ref} danger={spec.danger} aria-labelledby={titleId} onClose={onCancel}>
      <DialogHeader title={<span id={titleId}>{spec.title}</span>} />
      <DialogBody>
        {spec.body}
        {error && <Notice>{error}</Notice>}
      </DialogBody>
      <DialogActions>
        <Button onClick={() => ref.current?.close()} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant={spec.danger ? 'dangerSolid' : 'primary'}
          disabled={busy || offReason != null}
          title={offReason ?? undefined}
          onClick={onConfirm}
        >
          {busy ? 'Working…' : spec.okLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
