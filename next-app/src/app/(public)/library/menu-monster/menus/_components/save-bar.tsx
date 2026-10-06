'use client';

/**
 * Save + Discard changes on the title line — the public save-button standard
 * (AGENTS.md): disabled until the draft differs from what is saved, the label
 * says the state ("Save changes" / "Saved"; a first save keeps its own verb),
 * a "Saving…" label while it works, and Discard changes beside it, greyed until
 * dirty. A brand-new menu has nothing saved to go back to, so it shows no
 * Discard. A polite live region announces "Saving…" and then "Saved." for
 * screen readers.
 *
 * `next` (the planner's one-primary rule: "Save while dirty, Next when clean"): once a saved menu is clean the
 * primary becomes a link to the next step and the Discard beside it goes — there is no pair left to grey.
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
  onDiscard,
  labels,
  next
}: {
  isNew: boolean;
  newLabel?: string;
  dirty: boolean;
  saving: boolean;
  /** True for a moment after a save landed — drives the live announcement only. */
  saved: boolean;
  onSave: () => void;
  onDiscard: () => void;
  /** A second bar on the same page (Shopping's "What you paid") needs names the first one doesn't have. */
  labels?: { save?: string; clean?: string; discard?: string };
  /** What the primary becomes when a saved menu is clean: the full label ("Next: Gear ›") and where it goes. */
  next?: { label: string; href: string };
}) {
  const label = saving ? 'Saving…' : isNew ? newLabel : dirty ? (labels?.save ?? 'Save changes') : (labels?.clean ?? 'Saved');
  const off = saving || (!isNew && !dirty);
  const goNext = next != null && !isNew && !dirty && !saving;
  return (
    <span className={s.actions}>
      {!isNew && !goNext && (
        <Button variant="ghost" onClick={onDiscard} disabled={saving || !dirty} title={dirty ? undefined : 'No changes to discard'}>
          {labels?.discard ?? 'Discard changes'}
        </Button>
      )}
      {goNext ? (
        <Button variant="primary" href={next.href}>
          {next.label}
        </Button>
      ) : (
        <Button variant="primary" onClick={onSave} disabled={off} title={off && !saving ? 'No changes to save yet' : undefined}>
          {label}
        </Button>
      )}
      <span className={s.srOnly} aria-live="polite">
        {saving ? 'Saving…' : saved ? 'Saved.' : ''}
      </span>
    </span>
  );
}
