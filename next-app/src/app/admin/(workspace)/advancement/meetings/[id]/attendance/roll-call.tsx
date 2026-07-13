'use client';

/**
 * Roll Call — the attendance capture screen for one meeting.
 *
 * Two checkbox grids (scouts grouped by patrol, then leaders), live counts,
 * replace-on-save via saveRollCall. Leaders with a future 'committed' signup
 * show a tag but are not pre-checked — roll call records who actually showed.
 */

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Meeting } from '@/lib/supabase/types';
import { formatLongDate } from '@/lib/dates';
import { saveRollCall } from './actions';
import styles from '../../meetings.module.css';

export interface RollCallScout {
  id: string;
  display_name: string;
  patrol: string | null;
}
export interface RollCallLeader {
  code: string;
  name: string;
  committed: boolean;
}

interface Props {
  meeting: Meeting;
  scouts: RollCallScout[];
  leaders: RollCallLeader[];
  initialScoutIds: string[];
  initialLeaderCodes: string[];
}

export function RollCall({ meeting, scouts, leaders, initialScoutIds, initialLeaderCodes }: Props) {
  const router = useRouter();
  const [scoutIds, setScoutIds] = useState<Set<string>>(new Set(initialScoutIds));
  const [leaderCodes, setLeaderCodes] = useState<Set<string>>(new Set(initialLeaderCodes));
  const [recordedBy, setRecordedBy] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  const patrols = useMemo(() => {
    const groups = new Map<string, RollCallScout[]>();
    for (const s of scouts) {
      const key = s.patrol ?? 'No Patrol';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(s);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [scouts]);

  function toggle(set: Set<string>, id: string): Set<string> {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  }

  function save() {
    setErr(null);
    setSaved(false);
    startTransition(async () => {
      const res = await saveRollCall({
        meetingId: meeting.id,
        meetingDate: meeting.meeting_date,
        meetingTitle: meeting.title,
        scoutIds: [...scoutIds],
        leaderCodes: [...leaderCodes],
        recordedBy: recordedBy || null
      });
      if (!res.ok) {
        setErr(res.error ?? 'Save failed.');
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <>
      <div className={styles.editorHead}>
        <div>
          <Link href="/admin/advancement/meetings" className={styles.backLink}>
            ← All meetings
          </Link>
          <h1>
            Roll Call — {meeting.title}, {formatLongDate(meeting.meeting_date)}
          </h1>
        </div>
        <div className={styles.headActions}>
          <Link href={`/admin/advancement/meetings/${meeting.id}`} className={styles.editBtn}>
            Open agenda
          </Link>
          <button type="button" className={styles.publishBtn} onClick={save} disabled={isPending}>
            {isPending ? 'Saving…' : `Save (${scoutIds.size} + ${leaderCodes.size})`}
          </button>
        </div>
      </div>

      {err && <div className={styles.editError}>{err}</div>}
      {saved && !err && <p className={styles.okNote}>Roll call saved.</p>}

      <div className={styles.panel}>
        <div className={styles.panelTitle}>
          <span>
            Scouts — {scoutIds.size} of {scouts.length} present
          </span>
          <span>
            <button
              type="button"
              className={styles.editBtn}
              onClick={() => setScoutIds(new Set(scouts.map((s) => s.id)))}
            >
              All
            </button>
            <button type="button" className={styles.editBtn} onClick={() => setScoutIds(new Set())}>
              None
            </button>
          </span>
        </div>
        {patrols.map(([patrol, members]) => (
          <div key={patrol} className={styles.rollPatrol}>
            <p className={styles.rollPatrolName}>{patrol}</p>
            <div className={styles.rollGrid}>
              {members.map((s) => (
                <label
                  key={s.id}
                  className={`${styles.rollChip} ${scoutIds.has(s.id) ? styles.rollChipOn : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={scoutIds.has(s.id)}
                    onChange={() => setScoutIds((prev) => toggle(prev, s.id))}
                  />
                  {s.display_name}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className={styles.panel}>
        <div className={styles.panelTitle}>
          <span>Leaders — {leaderCodes.size} present</span>
        </div>
        <div className={styles.rollGrid}>
          {leaders.map((l) => (
            <label
              key={l.code}
              className={`${styles.rollChip} ${leaderCodes.has(l.code) ? styles.rollChipOn : ''}`}
            >
              <input
                type="checkbox"
                checked={leaderCodes.has(l.code)}
                onChange={() => setLeaderCodes((prev) => toggle(prev, l.code))}
              />
              {l.name}
              {l.committed && !leaderCodes.has(l.code) && (
                <span className={styles.rollCommitted}>committed</span>
              )}
            </label>
          ))}
        </div>
      </div>

      <div className={styles.panel}>
        <div className={styles.panelTitle}>Recorded by</div>
        <select
          className={styles.editInput}
          style={{ maxWidth: 280 }}
          value={recordedBy}
          onChange={(e) => setRecordedBy(e.target.value)}
          aria-label="Recorded by"
        >
          <option value="">— optional —</option>
          {leaders.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}
