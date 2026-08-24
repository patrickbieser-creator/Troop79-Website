'use client';

/**
 * Live demo of the Save standard (_components/save-state) on
 * /admin/styleguide/admin. Static specimens can't show the part that matters:
 * the button switching Saved → Save changes as you type, and the
 * Saving… → Done feedback when you click.
 */
import { useState } from 'react';
import sg from './styleguide.module.css';
import { SaveButton, SaveFeedback, useSavedSnapshot, useSavePhase } from '../../_components/save-state';

export function SaveDemo() {
  const [title, setTitle] = useState('Fall Camporee');
  const { dirty, markSaved } = useSavedSnapshot(title);
  const feedback = useSavePhase();
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <input
        aria-label="Demo title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        style={{ minWidth: '14em' }}
      />
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
