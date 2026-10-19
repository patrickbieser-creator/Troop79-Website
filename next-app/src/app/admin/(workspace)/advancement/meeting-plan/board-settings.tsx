'use client';

/**
 * This Sunday › Board (Phase 3a of Plans/Meeting-Requests-And-Teaching-Offers.md; prototype
 * prototypes/meeting-board/admin-setup.html): the leader sets the meeting's board. Rank with 1, 2 or 3 teaching blocks
 * (3 only on purpose), merit badge with its badge (stations and rotations are Phase 3b), or closed. A dirty-gated Save
 * + Discard changes (the house edit-form standard): a mode change is a decision, not a tap, because it changes what
 * every family sees. Picks are never lost: on a merit badge or closed week they carry to the next rank board.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { SegmentedControl } from '../../_components/segmented-control';
import { DiscardButton, SaveButton, SaveFeedback, SaveProblem, useDraftSnapshot, useSavePhase } from '../../_components/save-state';
import { FormPanel } from '../../../_components/form-panel';
import type { BoardMode } from '@/lib/meeting-board-shared';
import { setMeetingBoardAction } from './actions';
import styles from './meeting-plan.module.css';

export interface BoardSettingsValue {
  mode: BoardMode;
  mbId: string;
  blockCount: number;
}

const MODES = [
  { value: 'rank', label: 'Rank' },
  { value: 'merit_badge', label: 'Merit badge' },
  { value: 'closed', label: 'Closed' }
] as const;
const BLOCKS = [
  { value: '1', label: '1' },
  { value: '2', label: '2' },
  { value: '3', label: '3 (on purpose)' }
] as const;
const MODE_NOTE: Record<BoardMode, string> = {
  rank: 'Scouts pick up to 5 things; the matcher builds sessions. A scout gets at most 2 topics, even with 3 blocks.',
  merit_badge: 'One badge, run as stations. Every scout who comes is put in a rotation; no picks.',
  closed: 'No board, no matching. For campout prep, parties and outside clinics.'
};

export function BoardSettings({
  entryId,
  initial,
  badges,
  picks
}: {
  entryId: number;
  initial: BoardSettingsValue;
  /** Badges that can be a merit badge night: the ones with requirement rows. */
  badges: { id: string; name: string }[];
  /** Picks counted on this board now (for the "they aren't lost" note). */
  picks: number;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<BoardSettingsValue>(initial);
  const snap = useDraftSnapshot(draft);
  const feedback = useSavePhase();
  const [pending, start] = useTransition();
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsBadge = draft.mode === 'merit_badge' && !draft.mbId;

  function save() {
    setError(null);
    feedback.start();
    start(async () => {
      const res = await setMeetingBoardAction({ entryId, mode: draft.mode, mbId: draft.mode === 'merit_badge' ? draft.mbId : null, blockCount: draft.blockCount });
      if (!res.ok) {
        feedback.fail();
        setError(res.error);
        return;
      }
      snap.markSaved();
      setTried(false);
      feedback.done();
      router.refresh();
    });
  }

  return (
    <FormPanel
      title="Board"
      aria-label="Board settings"
      actions={
        <>
          <DiscardButton
            dirty={snap.dirty}
            pending={pending}
            onClick={() => {
              setDraft(snap.saved);
              setTried(false);
              setError(null);
            }}
          />
          <SaveButton dirty={snap.dirty} pending={pending} dirtyLabel="Save board" blocked={needsBadge} onBlocked={() => setTried(true)} onClick={save} />
          {tried && needsBadge && <SaveProblem reason="choose the badge for this night" />}
          <SaveFeedback phase={feedback.phase} />
        </>
      }
    >
      <div className={styles.boardSettings}>
        <div className={styles.boardSetting}>
          <span className={styles.teachLabel}>Board</span>
          <SegmentedControl
            name={`board-mode-${entryId}`}
            label="Board"
            value={draft.mode}
            options={MODES}
            disabled={pending}
            onChange={(mode) => setDraft((d) => ({ ...d, mode, mbId: mode === 'merit_badge' ? d.mbId : '' }))}
          />
        </div>
        {draft.mode === 'rank' && (
          <div className={styles.boardSetting}>
            <span className={styles.teachLabel}>Teaching blocks</span>
            <SegmentedControl
              name={`board-blocks-${entryId}`}
              label="Teaching blocks"
              value={String(draft.blockCount) as '1' | '2' | '3'}
              options={BLOCKS}
              disabled={pending}
              onChange={(v) => setDraft((d) => ({ ...d, blockCount: Number(v) }))}
            />
          </div>
        )}
        {draft.mode === 'merit_badge' && (
          <label className={styles.boardSetting}>
            <span className={styles.teachLabel}>Badge</span>
            <select
              className={tried && needsBadge ? `${styles.obSelect} ${styles.fieldBad}` : styles.obSelect}
              aria-invalid={tried && needsBadge ? true : undefined}
              value={draft.mbId}
              disabled={pending}
              onChange={(e) => setDraft((d) => ({ ...d, mbId: e.target.value }))}
            >
              <option value="">Choose a badge…</option>
              {badges.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <p className={styles.boardEmpty}>{MODE_NOTE[draft.mode]}</p>
      {draft.mode === 'merit_badge' && <p className={styles.boardEmpty}>Only badges with their requirements entered can be a merit badge night. Stations and rotations come next.</p>}
      {draft.mode !== 'rank' && initial.mode === 'rank' && picks > 0 && (
        <p className={styles.boardEmpty}>
          {picks} {picks === 1 ? 'pick is' : 'picks are'} on this board now. They aren&rsquo;t lost: they carry to the next rank board with their first-asked dates.
        </p>
      )}
      {error && (
        <p className={styles.statusErr} role="alert">
          {error}
        </p>
      )}
    </FormPanel>
  );
}
