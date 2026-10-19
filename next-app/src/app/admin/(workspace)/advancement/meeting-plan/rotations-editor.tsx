'use client';

/**
 * This Sunday › Rotations, on a merit badge night (Phase 3b of Plans/Meeting-Requests-And-Teaching-Offers.md; prototype
 * prototypes/meeting-board/admin-rotations.html). Groups × rotations × stations, from the matcher's draft: patrols kept
 * together, sizes balanced, finished stations shown as "Free: help out". The leader moves anyone.
 *
 *   - Moves are a draft until Save, with a dirty-gated "Save rotations" + Discard changes (the house edit-form
 *     standard), not one click per move: an arrangement is many moves that only make sense together, and saving pins
 *     everyone shown where they are (lib/meeting-board-rotations: a saved arrangement on top of the live draft), so a
 *     half-done set of moves must never land.
 *   - "Move to" is a select on every row (keyboard and phone alike); no drag and drop.
 *   - Has the badge: place each as a helper at a station or on other work.
 *   - Didn't answer: "Add to…" puts them in a group (or, with the badge, as a helper); saving records them Coming.
 *   - A group over 8 is outlined and says so; it still saves (the leader's call on the night).
 *   - "Start over from the draft" drops the saved arrangement, after an in-place confirm.
 *   - A youth leader (SPL / PL) sees the groups read-only: arranging them is an adult leader's call, like the board.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../../../_components/button';
import { FormPanel } from '../../../_components/form-panel';
import { DiscardButton, SaveButton, SaveFeedback, useDraftSnapshot, useSavePhase } from '../../_components/save-state';
import { arrangementPlacements, groupLabel, ROTATION_GROUP_CAP } from '@/lib/meeting-board-rotations';
import { saveRotationsAction } from './actions';
import styles from './meeting-plan.module.css';

export interface RotationPerson {
  personId: number;
  name: string;
  patrol: string | null;
}

export interface RotationEditorData {
  entryId: number;
  stations: { index: number; topicId: number; title: string; location: string | null }[];
  /** Station index per rotation, for each group (Group A first). */
  schedules: number[][];
  groups: (RotationPerson & { skips: number[]; isNew: boolean; undecided: boolean })[][];
  holders: (RotationPerson & { undecided: boolean; placement: HolderPlacement })[];
  noAnswer: (RotationPerson & { awarded: boolean; skips: number[] })[];
  /** A saved arrangement exists. */
  arranged: boolean;
}

export type HolderPlacement = { kind: 'helper'; topicId: number } | { kind: 'other' } | null;

interface Draft {
  groups: number[][];
  holders: Record<string, HolderPlacement>;
}

const holderValue = (p: HolderPlacement) => (p == null ? '' : p.kind === 'other' ? 'other' : `st:${p.topicId}`);
const parseHolder = (v: string): HolderPlacement => (v === 'other' ? { kind: 'other' } : v.startsWith('st:') ? { kind: 'helper', topicId: Number(v.slice(3)) } : null);

export function RotationsEditor({ data, readOnly = false }: { data: RotationEditorData; readOnly?: boolean }) {
  const router = useRouter();
  const initial: Draft = {
    groups: data.groups.map((g) => g.map((m) => m.personId)),
    holders: Object.fromEntries(data.holders.map((h) => [String(h.personId), h.placement]))
  };
  const [draft, setDraft] = useState<Draft>(initial);
  const snap = useDraftSnapshot(draft);
  const feedback = useSavePhase();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const locked = pending || readOnly;

  const info = new Map<number, RotationPerson & { skips: number[]; isNew?: boolean; undecided?: boolean; added?: boolean }>();
  for (const g of data.groups) for (const m of g) info.set(m.personId, m);
  for (const n of data.noAnswer) info.set(n.personId, { ...n, added: true });
  const holderInfo = new Map<number, RotationPerson & { undecided: boolean; added?: boolean }>(data.holders.map((h) => [h.personId, h]));
  for (const n of data.noAnswer) if (n.awarded) holderInfo.set(n.personId, { ...n, undecided: false, added: true });

  const inGroups = new Set(draft.groups.flat());
  const placedHolders = new Set(Object.keys(draft.holders).filter((k) => draft.holders[k] != null).map(Number));
  const holderIds = [...new Set([...data.holders.map((h) => h.personId), ...data.noAnswer.filter((n) => n.awarded && placedHolders.has(n.personId)).map((n) => n.personId)])];
  const unanswered = data.noAnswer.filter((n) => !inGroups.has(n.personId) && !(n.awarded && placedHolders.has(n.personId)));
  const stationTitle = (i: number) => data.stations.find((s) => s.index === i)?.title ?? `Station ${i + 1}`;
  const anyOver = draft.groups.some((g) => g.length > ROTATION_GROUP_CAP);

  function moveTo(personId: number, group: number) {
    setDraft((d) => ({ ...d, groups: d.groups.map((g, gi) => (gi === group ? [...g.filter((id) => id !== personId), personId] : g.filter((id) => id !== personId))) }));
    setLive(`${info.get(personId)?.name ?? 'Scout'} moved to Group ${groupLabel(group)}. Not saved yet.`);
  }

  function placeHolder(personId: number, p: HolderPlacement) {
    setDraft((d) => ({ ...d, holders: { ...d.holders, [String(personId)]: p } }));
  }

  function save() {
    setError(null);
    feedback.start();
    start(async () => {
      const placements = arrangementPlacements(
        draft.groups.map((ids) => ({ members: ids.map((personId) => ({ personId })) })),
        Object.entries(draft.holders).map(([id, placement]) => ({ personId: Number(id), placement }))
      );
      const res = await saveRotationsAction({ entryId: data.entryId, placements });
      if (!res.ok) {
        feedback.fail();
        setError(res.error);
        return;
      }
      snap.markSaved();
      feedback.done();
      setLive('Saved. Scouts’ pages use these groups now.');
      router.refresh();
    });
  }

  function startOver() {
    setConfirmReset(false);
    setError(null);
    start(async () => {
      const res = await saveRotationsAction({ entryId: data.entryId, placements: [] });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setLive('Back to the matcher’s draft.');
      router.refresh();
    });
  }

  if (!data.stations.length) {
    return (
      <FormPanel title="Rotations">
        <p className={styles.boardEmpty}>Set the stations above first. The matcher drafts the groups from them.</p>
      </FormPanel>
    );
  }

  return (
    <FormPanel
      title="Rotations"
      aria-label="Rotations"
      actions={
        readOnly ? undefined : (
          <>
            <DiscardButton
              dirty={snap.dirty}
              pending={pending}
              onClick={() => {
                setDraft(snap.saved);
                setError(null);
                setLive('Changes discarded.');
              }}
            />
            <SaveButton dirty={snap.dirty} pending={pending} dirtyLabel="Save rotations" onClick={save} />
            <SaveFeedback phase={feedback.phase} doneLabel="Saved. Scouts’ pages use these groups now." />
          </>
        )
      }
    >
      <p className={styles.boardEmpty}>
        {data.stations.length} {data.stations.length === 1 ? 'station' : 'stations'}, so {data.stations.length} rotations.{' '}
        {data.arranged ? 'These are your saved groups; anyone who signs up later is added to the smallest group.' : 'This is the matcher’s draft until you save: move anyone.'}
      </p>
      {anyOver && <p className={styles.statusErr}>A group is over {ROTATION_GROUP_CAP}. You can still save; it&rsquo;s your call on the night.</p>}
      <div className={styles.rotGrid}>
        {draft.groups.map((ids, gi) => {
          const over = ids.length > ROTATION_GROUP_CAP;
          return (
            <section key={gi} className={over ? `${styles.rotCol} ${styles.rotColOver}` : styles.rotCol} aria-label={`Group ${groupLabel(gi)}`}>
              <h3 className={styles.blockHead}>
                Group {groupLabel(gi)} <span className={styles.teachMeta}>{ids.length} {ids.length === 1 ? 'scout' : 'scouts'}</span>
              </h3>
              {over && <p className={styles.statusErr}>{ids.length} is over the {ROTATION_GROUP_CAP} cap. Move someone.</p>}
              <ol className={styles.rotSched}>
                {(data.schedules[gi] ?? []).map((st, r) => (
                  <li key={r}>{stationTitle(st)}</li>
                ))}
              </ol>
              {ids.length ? (
                <ul className={styles.rotMembers}>
                  {ids.map((id) => {
                    const m = info.get(id);
                    const skips = (m?.skips ?? []).map(stationTitle);
                    const bits = [m?.patrol, m?.undecided ? 'not sure yet' : null, m?.added ? 'added by you' : m?.isNew ? 'new since you saved' : null, skips.length ? `done: ${skips.join(', ')}` : null].filter(Boolean);
                    return (
                      <li key={id}>
                        <span className={styles.grow}>
                          <span className={styles.scoutName}>{m?.name ?? `Scout ${id}`}</span>
                          {bits.length > 0 && <span className={styles.patrol}>{bits.join(' · ')}</span>}
                        </span>
                        <select className={styles.rotMove} aria-label={`Move ${m?.name ?? 'scout'} to`} value={gi} disabled={locked} onChange={(e) => moveTo(id, Number(e.target.value))}>
                          {draft.groups.map((_, x) => (
                            <option key={x} value={x}>
                              Group {groupLabel(x)}
                            </option>
                          ))}
                        </select>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className={styles.boardEmpty}>Empty. Move someone here.</p>
              )}
            </section>
          );
        })}
      </div>

      <div className={styles.boardCols}>
        <div>
          <h3 className={styles.sectionTitle}>Has the badge</h3>
          <p className={styles.boardEmpty}>Help teach a station, or other work.</p>
          {holderIds.length ? (
            <ul className={styles.supplyList}>
              {holderIds.map((id) => {
                const h = holderInfo.get(id)!;
                return (
                  <li key={id} className={styles.rotHolder}>
                    <span className={styles.grow}>
                      <span className={styles.scoutName}>{h.name}</span>
                      <span className={styles.patrol}>{[h.patrol, h.undecided ? 'not sure yet' : null, h.added ? 'added by you' : null].filter(Boolean).join(' · ')}</span>
                    </span>
                    <select className={styles.rotMove} aria-label={`Place ${h.name}`} value={holderValue(draft.holders[String(id)] ?? null)} disabled={locked} onChange={(e) => placeHolder(id, parseHolder(e.target.value))}>
                      <option value="">Not placed</option>
                      {data.stations.map((s) => (
                        <option key={s.topicId} value={`st:${s.topicId}`}>
                          Helper at {s.title}
                        </option>
                      ))}
                      <option value="other">Other work</option>
                    </select>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className={styles.boardEmpty}>Nobody coming has it.</p>
          )}
        </div>
        <div>
          <h3 className={styles.sectionTitle}>Didn&rsquo;t answer</h3>
          <p className={styles.boardEmpty}>Came anyway? Add them; saving marks them coming.</p>
          {unanswered.length ? (
            <ul className={styles.supplyList}>
              {unanswered.map((n) => (
                <li key={n.personId} className={styles.rotHolder}>
                  <span className={styles.grow}>
                    <span className={styles.scoutName}>{n.name}</span>
                    <span className={styles.patrol}>{n.awarded ? 'Has the badge' : (n.patrol ?? '')}</span>
                  </span>
                  <select
                    className={styles.rotMove}
                    aria-label={`Add ${n.name}`}
                    value=""
                    disabled={locked}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) return;
                      if (n.awarded) placeHolder(n.personId, parseHolder(v));
                      else moveTo(n.personId, Number(v));
                    }}
                  >
                    <option value="">Add to…</option>
                    {n.awarded ? (
                      <>
                        {data.stations.map((s) => (
                          <option key={s.topicId} value={`st:${s.topicId}`}>
                            Helper at {s.title}
                          </option>
                        ))}
                        <option value="other">Other work</option>
                      </>
                    ) : (
                      draft.groups.map((_, x) => (
                        <option key={x} value={x}>
                          Group {groupLabel(x)}
                        </option>
                      ))
                    )}
                  </select>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.boardEmpty}>Everyone answered.</p>
          )}
        </div>
      </div>

      {!readOnly && (
        <div className={styles.rotFoot}>
          {confirmReset ? (
            <span className={styles.rotConfirm} role="group" aria-label="Start over from the draft">
              Start over? Your saved groups go back to the matcher&rsquo;s draft.{' '}
              <Button size="sm" variant="secondary" disabled={pending} onClick={startOver}>
                Start over
              </Button>{' '}
              <Button size="sm" variant="quiet" onClick={() => setConfirmReset(false)}>
                Keep my groups
              </Button>
            </span>
          ) : (
            <Button size="sm" variant="quiet" disabled={!data.arranged || pending || snap.dirty} title={!data.arranged ? 'These are already the matcher’s draft' : undefined} onClick={() => setConfirmReset(true)}>
              Start over from the draft
            </Button>
          )}
        </div>
      )}
      {error && (
        <p className={styles.statusErr} role="alert">
          {error}
        </p>
      )}
      <p className={styles.sr} aria-live="polite">
        {live}
      </p>
    </FormPanel>
  );
}
