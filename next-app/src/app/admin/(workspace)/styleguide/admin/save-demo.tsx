'use client';

/**
 * Live demo of the Save standard (_components/save-state) on
 * /admin/styleguide/admin. Static specimens can't show the part that matters:
 * the button switching Saved → Save changes as you type, and the
 * Saving… → Done feedback when you click.
 */
import { useState } from 'react';
import sg from './styleguide.module.css';
import { DiscardButton, SaveButton, SaveFeedback, SaveProblem, useDraftSnapshot, useSavePhase } from '../../_components/save-state';
import marks from '../../_components/save-state.module.css';
import { SegmentedControl } from '../../_components/segmented-control';

export function SaveDemo() {
  const [title, setTitle] = useState('Fall Camporee');
  const { dirty, markSaved, saved } = useDraftSnapshot(title);
  const feedback = useSavePhase();
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <input
        aria-label="Demo title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        style={{ minWidth: '14em' }}
      />
      <DiscardButton dirty={dirty} onClick={() => setTitle(saved)} />
      <SaveButton
        className={sg.demoBtn}
        dirty={dirty}
        pending={feedback.phase === 'saving'}
        onClick={() => {
          feedback.start();
          setTimeout(() => {
            markSaved();
            feedback.done();
          }, 700);
        }}
      />
      <SaveFeedback phase={feedback.phase} />
    </div>
  );
}

/**
 * The blocked-save standard (2026-10-05): clear the title and click Save. The button stays enabled; the
 * click saves nothing, marks the field, focuses it and says why beside the button.
 */
export function BlockedSaveDemo() {
  const [title, setTitle] = useState('Fall Camporee');
  const [attempted, setAttempted] = useState(false);
  const { dirty, markSaved, saved } = useDraftSnapshot(title);
  const feedback = useSavePhase();
  const blocker = title.trim() ? null : 'Give it a title.';
  const bad = attempted && blocker != null;
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <input
        id="sg-blocked-title"
        aria-label="Demo title (clear it)"
        aria-invalid={bad || undefined}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className={bad ? marks.bad : undefined}
        style={{ minWidth: '14em' }}
      />
      {bad && <p className={marks.badNote}>Title is required.</p>}
      <DiscardButton
        dirty={dirty}
        onClick={() => {
          setTitle(saved);
          setAttempted(false);
        }}
      />
      <SaveButton
        className={sg.demoBtn}
        dirty={dirty}
        pending={feedback.phase === 'saving'}
        blocked={blocker != null}
        onBlocked={() => {
          setAttempted(true);
          document.getElementById('sg-blocked-title')?.focus();
        }}
        onClick={() => {
          feedback.start();
          setTimeout(() => {
            markSaved();
            setAttempted(false);
            feedback.done();
          }, 700);
        }}
      />
      <SaveFeedback phase={feedback.phase} />
      {bad && blocker && <SaveProblem reason={blocker} />}
    </div>
  );
}

export function SegmentedDemo() {
  const [state, setState] = useState<'substituted' | 'nothing' | 'unsuitable'>('substituted');
  return (
    <SegmentedControl
      name="sg-seg"
      label="What gluten-free scouts get"
      value={state}
      options={[
        { value: 'substituted', label: 'Substitute' },
        { value: 'nothing', label: 'Nothing to change' },
        { value: 'unsuitable', label: 'Not suitable' }
      ]}
      onChange={setState}
    />
  );
}
