'use client';

/**
 * Edit pins (Plans/Completed/Admin-Portal-Nav.md phase 3): the person's pinned items in order, dragged or moved with the
 * arrows, removed, or added from what they can open. One draft and one Save in the sticky EditBar.
 */
import { useState, useTransition } from 'react';
import { SortableList, type SortableItem } from '../_components/sortable-list';
import { EditBar } from '../_components/edit-bar';
import { Notice } from '../_components/notice';
import { savePinsAction } from '../_components/pin-actions';

export interface PinOption extends SortableItem {
  label: string;
}

export function PinsEditor({ saved, options, max }: { saved: PinOption[]; options: PinOption[]; max: number }) {
  const [draft, setDraft] = useState<PinOption[]>(saved);
  const [baseline, setBaseline] = useState<PinOption[]>(saved);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const keys = draft.map((p) => p.key);
  const savedKeys = baseline.map((p) => p.key);
  const dirty = keys.join('|') !== savedKeys.join('|');
  const available = options.filter((o) => !keys.includes(o.key));

  function save() {
    setError(null);
    start(async () => {
      const res = await savePinsAction(keys);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // The action revalidates the layout: the rail's pins update with its response.
      setBaseline(draft);
    });
  }

  return (
    <>
      <EditBar
        dirty={dirty}
        pending={pending}
        saveLabel="Save pins"
        onSave={save}
        onDiscard={() => {
          setDraft(baseline);
          setError(null);
        }}
        status={dirty ? 'Your pins have unsaved changes — Save to keep them' : undefined}
        cleanStatus={draft.length === 0 ? 'No pins yet' : `${draft.length} of ${max} pins`}
      />
      {error ? <Notice variant="error">{error}</Notice> : null}
      <SortableList
        items={draft}
        onChange={(next) => setDraft(next.slice(0, max))}
        available={draft.length < max ? available : []}
        addLabel="Pin an item"
        emptyLabel="Nothing pinned. Add an item below, or choose + Pin in any menu."
      />
    </>
  );
}
