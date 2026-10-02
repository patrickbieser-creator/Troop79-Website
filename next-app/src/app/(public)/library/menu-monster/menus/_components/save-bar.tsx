'use client';

/**
 * Save + Discard changes on the title line — the public save-button standard
 * (AGENTS.md): disabled until the draft differs from what is saved, the label
 * says the state ("Save changes" / "Saved"; a first save keeps its own verb),
 * a "Saving…" label while it works, and Discard changes beside it, greyed until
 * dirty. A brand-new menu has nothing saved to go back to, so it shows no
 * Discard. A polite live region announces "Saving…" and then "Saved." for
 * screen readers.
 */

import { Button } from '@/app/_components/button';
import s from './workspace.module.css';

export function SaveBar({
  isNew,
  newLabel = 'Save menu',
  dirty,
  saving,
  saved,
  onSave,
  onDiscard
}: {
  isNew: boolean;
  newLabel?: string;
  dirty: boolean;
  saving: boolean;
  /** True for a moment after a save landed — drives the live announcement only. */
  saved: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const label = saving ? 'Saving…' : isNew ? newLabel : dirty ? 'Save changes' : 'Saved';
  const off = saving || (!isNew && !dirty);
  return (
    <span className={s.actions}>
      {!isNew && (
        <Button variant="ghost" onClick={onDiscard} disabled={saving || !dirty} title={dirty ? undefined : 'No changes to discard'}>
          Discard changes
        </Button>
      )}
      <Button variant="primary" onClick={onSave} disabled={off} title={off && !saving ? 'No changes to save yet' : undefined}>
        {label}
      </Button>
      <span className={s.srOnly} aria-live="polite">
        {saving ? 'Saving…' : saved ? 'Saved.' : ''}
      </span>
    </span>
  );
}
