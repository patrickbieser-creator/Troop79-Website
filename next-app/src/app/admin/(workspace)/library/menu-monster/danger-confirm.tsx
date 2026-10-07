'use client';

/**
 * A destructive control's confirm (D-332): a danger Dialog that names the consequence, with a quiet way out.
 * Mount it only while it is open; closing (Esc, the backdrop, "Keep it") calls onCancel.
 */

import { useEffect, useRef } from 'react';
import { Button } from '../../../_components/button';
import { Dialog, DialogActions, DialogBody, DialogHeader } from '../../_components/dialog';

export function DangerConfirm({
  title,
  sub,
  confirmLabel,
  keepLabel = 'Keep it',
  onConfirm,
  onCancel
}: {
  title: string;
  sub: string;
  confirmLabel: string;
  keepLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <Dialog ref={ref} danger aria-label={title} onClose={onCancel}>
      <DialogHeader title={title} sub={sub} />
      <DialogBody>{null}</DialogBody>
      <DialogActions>
        <Button variant="secondary" size="sm" onClick={onCancel}>
          {keepLabel}
        </Button>
        <Button variant="dangerSolid" size="sm" onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
