'use client';

/**
 * A leader's Review tab on a scout's menu (Phase 3): the one review note the
 * scout sees on their Plan tab (Decision 18 — replaced on save, blank clears
 * it), and Hide from the shelf for a shared menu (the take-down, tech-lead
 * review). The note follows the save-button standard: dirty-gated Save, "Saved"
 * when clean, Discard back to the last saved note. Hiding asks once.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/app/_components/button';
import { Field, TextArea } from '@/app/_components/form';
import { Notice } from '@/app/_components/notice';
import { MAX_REVIEW_NOTE } from '@/lib/menu-monster/menus';
import { hideMenuAction, setReviewNoteAction } from '../../../_tools/menu-monster/menu-actions';
import { SaveBar } from './save-bar';
import { ShareStatusLine, type ShareStatus } from './share-status';
import s from './workspace.module.css';

export function ReviewPanel({ menuId, note: initial, status, plannedBy }: { menuId: string; note: string; status: ShareStatus; plannedBy: string | null }) {
  const router = useRouter();
  const [saved, setSaved] = useState(initial);
  const [note, setNote] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [confirmHide, setConfirmHide] = useState(false);
  const [hiding, setHiding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = note.trim() !== saved.trim();

  async function save() {
    setSaving(true);
    setError(null);
    const res = await setReviewNoteAction(menuId, note);
    setSaving(false);
    if (!res.ok) return setError(res.error);
    setSaved(note.trim());
    setNote(note.trim());
    setJustSaved(true);
    router.refresh();
  }

  async function hide() {
    setError(null);
    setHiding(true);
    const res = await hideMenuAction(menuId);
    setHiding(false);
    setConfirmHide(false);
    if (!res.ok) return setError(res.error);
    router.refresh();
  }

  return (
    <section className={s.hubSection}>
      {error && (
        <Notice tone="error" className={s.notice}>
          {error}
        </Notice>
      )}
      <Field label="Note to the scout" hint="Shows at the top of their menu. Saving replaces any earlier note; leave it blank to remove it.">
        <TextArea
          rows={4}
          maxLength={MAX_REVIEW_NOTE}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            setJustSaved(false);
          }}
        />
      </Field>
      <SaveBar isNew={false} dirty={dirty} saving={saving} saved={justSaved} onSave={() => void save()} onDiscard={() => setNote(saved)} />

      <h2 className={s.heading}>Sharing</h2>
      <ShareStatusLine status={status} owner={false} />
      {status.sharedAt != null &&
        (confirmHide ? (
          <div className={s.noticeActions} role="group" aria-label="Hide from the shelf">
            <span>Hide this menu from the shelf? {plannedBy ?? 'The scout'} can share it again.</span>
            <Button variant="danger" onClick={() => void hide()} disabled={hiding}>
              {hiding ? 'Hiding…' : 'Hide it'}
            </Button>
            <Button variant="ghost" onClick={() => setConfirmHide(false)}>
              Keep it shared
            </Button>
          </div>
        ) : (
          <Button variant="danger" onClick={() => setConfirmHide(true)}>
            Hide from the shelf
          </Button>
        ))}
    </section>
  );
}
