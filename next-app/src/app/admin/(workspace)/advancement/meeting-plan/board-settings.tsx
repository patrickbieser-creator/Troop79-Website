'use client';

/**
 * This Sunday › Board (Phase 3a of Plans/Meeting-Requests-And-Teaching-Offers.md; prototype
 * prototypes/meeting-board/admin-setup.html): the leader sets the meeting's board. Rank (up to 12 teaching blocks,
 * filled by the matcher: no count to choose since 2026-10-20; the saved block_count rides along unchanged), merit
 * badge with its badge and stations (Phase 3b), or closed. A dirty-gated Save + Discard
 * changes (the house edit-form standard): a mode change is a decision, not a tap, because it changes what every family
 * sees. Picks are never lost: on a merit badge or closed week they carry to the next rank board.
 *
 * Phase 3b, stations: choosing a badge offers a starting set from its top-level requirements (lib/meeting-board-
 * rotations defaultStations) for the leader to edit: each station a name, an optional place, and the requirements it
 * covers; 2 to 6 of them. Problems are marked in place on Save (the "greyed means nothing to do" rule). The badge,
 * the stations and their order save together.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { SegmentedControl } from '../../_components/segmented-control';
import { DiscardButton, SaveButton, SaveFeedback, SaveProblem, useDraftSnapshot, useSavePhase } from '../../_components/save-state';
import { Button } from '../../../_components/button';
import { FormPanel } from '../../../_components/form-panel';
import type { BoardMode } from '@/lib/meeting-board-shared';
import type { CatalogMeritBadgeRequirement } from '@/lib/advancement-catalog';
import { defaultStations, MAX_STATIONS, stationProblems, STATION_PLACE_MAX, STATION_TITLE_MAX, type StationDraft } from '@/lib/meeting-board-rotations';
import { Notice } from '../../_components/notice';
import { setMeetingBoardAction, setMeetingStationsAction } from './actions';
import styles from './meeting-plan.module.css';

export interface BoardSettingsValue {
  mode: BoardMode;
  mbId: string;
  blockCount: number;
  /** The merit badge night's stations, in order (Phase 3b). */
  stations: StationDraft[];
}

const MODES = [
  { value: 'rank', label: 'Rank' },
  { value: 'merit_badge', label: 'Merit badge' },
  { value: 'closed', label: 'Closed' }
] as const;
const MODE_NOTE: Record<BoardMode, string> = {
  rank: 'Scouts pick up to 5 things; the matcher fills up to 12 teaching blocks. A scout gets at most 2 topics.',
  merit_badge: 'One badge, run as stations. Every scout who comes is put in a rotation; no picks.',
  closed: 'No board, no matching. For campout prep, parties and outside clinics.'
};

type BadgeReq = Pick<CatalogMeritBadgeRequirement, 'id' | 'mb_id' | 'parent_id' | 'code' | 'label' | 'complete_rule' | 'complete_n' | 'sort_order' | 'venue'>;

function problemText(p: ReturnType<typeof stationProblems>, needsBadge: boolean): string[] {
  const out: string[] = [];
  if (needsBadge) out.push('choose the badge for this night');
  if (p.count === 'few') out.push('add at least 2 stations');
  if (p.count === 'many') out.push(`${MAX_STATIONS} stations at most`);
  p.each.forEach((e, i) => {
    const missing = [e.includes('title') ? 'a name' : null, e.includes('codes') ? 'a requirement' : null].filter(Boolean);
    if (missing.length) out.push(`station ${i + 1} needs ${missing.join(' and ')}`);
    if (e.includes('shared')) out.push(`station ${i + 1} shares a requirement with another`);
  });
  return out;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Saving removes 3 stations, 2 teacher sign-ups and the saved rotation groups." */
export function dropText(stations: number, teachers: number, arranged: boolean): string {
  const parts = [count(stations, 'station', 'stations'), teachers ? count(teachers, 'teacher sign-up', 'teacher sign-ups') : null, arranged ? 'the saved rotation groups' : null].filter(
    (x): x is string => !!x
  );
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  return `Saving removes ${list}.`;
}

export function BoardSettings({
  entryId,
  initial,
  badges,
  badgeReqs,
  picks,
  stationTeachers = 0,
  arranged = false
}: {
  entryId: number;
  initial: BoardSettingsValue;
  /** Badges that can be a merit badge night: the ones with requirement rows. */
  badges: { id: string; name: string }[];
  /** Those badges' top-level requirements (what a station is built from). */
  badgeReqs: BadgeReq[];
  /** Picks counted on this board now (for the "they aren't lost" note). */
  picks: number;
  /** Teacher sign-ups on the saved stations, and whether rotation groups are saved: what leaving the night removes. */
  stationTeachers?: number;
  arranged?: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<BoardSettingsValue>(initial);
  const snap = useDraftSnapshot(draft);
  const feedback = useSavePhase();
  const [pending, start] = useTransition();
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mb = draft.mode === 'merit_badge';
  const needsBadge = mb && !draft.mbId;
  const sp: ReturnType<typeof stationProblems> = mb && draft.mbId ? stationProblems(draft.stations) : { count: null, each: [] };
  const problems = problemText(sp, needsBadge);
  const blocked = problems.length > 0;
  const tops = draft.mbId ? badgeReqs.filter((r) => r.mb_id === draft.mbId && r.parent_id == null).sort((a, b) => a.sort_order - b.sort_order) : [];
  const dropsStations = initial.mode === 'merit_badge' && initial.stations.length > 0 && (draft.mode !== 'merit_badge' || draft.mbId !== initial.mbId);
  const regroups = mb && draft.mbId === initial.mbId && initial.stations.length > 0 && draft.stations.length !== initial.stations.length;

  const setStation = (i: number, patch: Partial<StationDraft>) => setDraft((d) => ({ ...d, stations: d.stations.map((s, x) => (x === i ? { ...s, ...patch } : s)) }));

  function save() {
    setError(null);
    feedback.start();
    start(async () => {
      const res = mb
        ? await setMeetingStationsAction({ entryId, mbId: draft.mbId, stations: draft.stations })
        : await setMeetingBoardAction({ entryId, mode: draft.mode, mbId: null, blockCount: draft.blockCount });
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
          <SaveButton dirty={snap.dirty} pending={pending} dirtyLabel="Save board" blocked={blocked} onBlocked={() => setTried(true)} onClick={save} />
          {tried && blocked && <SaveProblem reason={problems[0]} more={problems.length - 1} />}
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
            onChange={(mode) =>
              setDraft((d) =>
                mode === 'merit_badge'
                  ? { ...d, mode, mbId: d.mbId || initial.mbId, stations: d.mbId || !initial.mbId ? d.stations : initial.stations }
                  : { ...d, mode, mbId: '', stations: [] }
              )
            }
          />
        </div>
        {mb && (
          <label className={styles.boardSetting}>
            <span className={styles.teachLabel}>Badge</span>
            <select
              className={tried && needsBadge ? `${styles.obSelect} ${styles.fieldBad}` : styles.obSelect}
              aria-invalid={tried && needsBadge ? true : undefined}
              value={draft.mbId}
              disabled={pending}
              onChange={(e) => {
                const mbId = e.target.value;
                // A different badge is a different night: start from its own requirements (the saved stations if it's the saved badge).
                setDraft((d) => ({ ...d, mbId, stations: mbId === initial.mbId ? initial.stations : mbId ? defaultStations(mbId, badgeReqs) : [] }));
              }}
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
      {mb && !draft.mbId && <p className={styles.boardEmpty}>Only badges with their requirements entered can be a merit badge night.</p>}

      {mb && draft.mbId && (
        <div className={styles.stationsHead}>
          <h3 className={styles.sectionTitle}>
            Stations <span className={styles.teachMeta}>{draft.stations.length ? `${draft.stations.length} rotations` : ''}</span>
          </h3>
          {draft.stations.map((s, i) => {
            const bad = tried ? sp.each[i] : [];
            const missing = [bad.includes('title') ? 'a name' : null, bad.includes('codes') ? 'at least one requirement' : null].filter(Boolean);
            return (
              <div key={i} className={bad.includes('codes') || bad.includes('shared') ? `${styles.stationEdit} ${styles.stationEditBad}` : styles.stationEdit}>
                <div className={styles.stationRow}>
                  <label className={styles.field}>
                    Station {i + 1}
                    <input
                      type="text"
                      maxLength={STATION_TITLE_MAX}
                      value={s.title}
                      aria-invalid={bad.includes('title') ? true : undefined}
                      className={bad.includes('title') ? styles.fieldBad : undefined}
                      disabled={pending}
                      onChange={(e) => setStation(i, { title: e.target.value })}
                    />
                  </label>
                  <label className={styles.field}>
                    Where (optional)
                    <input type="text" maxLength={STATION_PLACE_MAX} value={s.location} disabled={pending} onChange={(e) => setStation(i, { location: e.target.value })} />
                  </label>
                  <Button
                    size="sm"
                    variant="quiet"
                    aria-label={`Remove station ${i + 1}`}
                    disabled={pending}
                    onClick={() => setDraft((d) => ({ ...d, stations: d.stations.filter((_, x) => x !== i) }))}
                  >
                    Remove
                  </Button>
                </div>
                <fieldset className={styles.stationReqs} aria-label={`Station ${i + 1} requirements`}>
                  {tops.map((r) => (
                    <label key={r.code}>
                      <input
                        type="checkbox"
                        checked={s.codes.includes(r.code)}
                        disabled={pending}
                        onChange={(e) =>
                          setStation(i, {
                            codes: e.target.checked
                              ? tops.filter((t) => t.code === r.code || s.codes.includes(t.code)).map((t) => t.code)
                              : s.codes.filter((c) => c !== r.code)
                          })
                        }
                      />
                      {r.code}. {r.label.length > 40 ? `${r.label.slice(0, 39)}…` : r.label}
                    </label>
                  ))}
                </fieldset>
                {missing.length > 0 && <p className={styles.statusErr}>Station {i + 1} needs {missing.join(' and ')}.</p>}
                {bad.includes('shared') && <p className={styles.statusErr}>A requirement here is in another station too.</p>}
              </div>
            );
          })}
          {tried && sp.count === 'few' && <p className={styles.statusErr}>Add at least 2 stations so groups have somewhere to rotate.</p>}
          {!draft.stations.length && <p className={styles.boardEmpty}>No stations yet. Most nights use 3 or 4.</p>}
          <p>
            {draft.stations.length < MAX_STATIONS && (
              <Button size="sm" variant="quiet" disabled={pending} onClick={() => setDraft((d) => ({ ...d, stations: [...d.stations, { topicId: null, title: '', location: '', codes: [] }] }))}>
                + Station
              </Button>
            )}{' '}
            {!draft.stations.length && (
              <Button size="sm" variant="quiet" disabled={pending} onClick={() => setDraft((d) => ({ ...d, stations: defaultStations(d.mbId, badgeReqs) }))}>
                Use the suggested stations
              </Button>
            )}
          </p>
        </div>
      )}

      {dropsStations && <Notice variant="warning">{dropText(initial.stations.length, stationTeachers, arranged)}</Notice>}
      {regroups && <p className={styles.boardEmpty}>A different number of stations starts the rotation groups over from the draft.</p>}
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
