'use client';

import { useMemo, useState, useTransition, type DragEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  placeInGroup,
  unplaceFromGroup,
  setRideStatus,
  addGroup,
  updateGroup,
  deleteGroup
} from '../../../events/actions';
import type { ParticipantClass } from '@/lib/participant-class';
import { ClassPill } from '../../../events/class-pill';
import {
  LEG_LABEL,
  RIDE_STATUSES,
  RIDE_STATUS_LABEL,
  capacityLabel,
  legTiles,
  type Leg,
  type RideStatus,
  type TransportCar
} from '@/lib/transport';
import ev from '../../../events/events-admin.module.css';
import styles from './assignments.module.css';
import { SaveButton, SaveFeedback, useSavePhase } from '../../../_components/save-state';

/** The group editor's draft, seeded from the group — the same shape is
 *  "saved", so the Save standard's dirty gate is a comparison against it. */
const groupDraft = (g: { id: number; name: string; capacity: number | null; notes: string | null }) => ({
  id: g.id,
  name: g.name,
  capacity: g.capacity != null ? String(g.capacity) : '',
  notes: g.notes ?? ''
});

/*
 * The assignment board (Plans/Event-Logistics.md §A/§B) — the campout sheet's
 * Car To / Car Back / Patrol / Tent columns as something you can drag.
 *
 * One component for every set. A CAR set (kind='car', a leg) shows the
 * sheet's Need/Avail/Short-Over tiles, a "Needs a ride" pool of unplaced
 * riders, one card per car (driver, capacity incl. driver, notes), and the
 * people travelling on their own. Any other set shows an Unassigned pool and
 * its groups. Chips drag onto cards (native HTML5 DnD — no new dependency);
 * the Move… select on every chip is the phone/touch/keyboard path.
 *
 * Placement is a Server Action over place_in_group, which locks the group
 * row — 'full' and 'gone' come back as ordinary outcomes and the board just
 * refreshes.
 */

export interface BoardSet {
  id: number;
  label: string;
  kind: string;
  leg: Leg | null;
  selfSelect: boolean;
  familyVisible: boolean;
  groups: BoardGroup[];
}
export interface BoardGroup {
  id: number;
  name: string;
  capacity: number | null;
  driverEntryId: number | null;
  notes: string | null;
  memberEntryIds: number[];
}
export interface BoardPerson {
  entryId: number;
  name: string;
  participantClass: ParticipantClass;
  status: string;
  participation: string;
  drivesOut: boolean;
  drivesBack: boolean;
  vehicleSeatsOut: number | null;
  vehicleSeatsBack: number | null;
  rideOut: RideStatus | null;
  rideBack: RideStatus | null;
  /** Leader-only surface: a driver's phone goes on their car card. */
  phone: string | null;
}

export function AssignmentsBoard({
  signupId,
  calendarEntryId,
  sets,
  people,
  activeSetId = null
}: {
  signupId: number;
  calendarEntryId: number;
  sets: BoardSet[];
  people: BoardPerson[];
  /** The set to show — chosen by the top-level EventNav tab (`?set=`);
   *  the board no longer carries its own set tabs (Patrick, 2026-08-22). */
  activeSetId?: number | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const activeId: number | null = activeSetId ?? sets[0]?.id ?? null;
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<string | null>(null);
  // Group CRUD for non-car sets (Plans/Event-Logistics.md §B) — cars are
  // trigger-owned; only their note ("pulling trailer") is editable here.
  const [newName, setNewName] = useState('');
  const [newCap, setNewCap] = useState('');
  const [editingGroup, setEditingGroup] = useState<{ id: number; name: string; capacity: string; notes: string } | null>(null);

  const active = sets.find((s) => s.id === activeId) ?? sets[0] ?? null;
  const byId = useMemo(() => new Map(people.map((p) => [p.entryId, p])), [people]);
  const live = useMemo(() => people.filter((p) => p.status === 'yes'), [people]);

  const feedback = useSavePhase();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error ?? 'Could not save.');
      router.refresh();
    });

  const place = (groupId: number, entryId: number) =>
    run(() => placeInGroup(groupId, entryId, signupId, calendarEntryId));
  const unplace = (groupId: number, entryId: number) =>
    run(() => unplaceFromGroup(groupId, entryId, signupId, calendarEntryId));

  const onDragStart = (e: DragEvent, entryId: number) => {
    e.dataTransfer.setData('text/plain', String(entryId));
    e.dataTransfer.effectAllowed = 'move';
    setDragging(entryId);
  };
  const onDragEnd = () => {
    setDragging(null);
    setOver(null);
  };
  const allowDrop = (key: string) => (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (over !== key) setOver(key);
  };
  const onDropGroup = (group: BoardGroup) => (e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    const entryId = Number(e.dataTransfer.getData('text/plain'));
    if (!entryId || group.memberEntryIds.includes(entryId)) return;
    place(group.id, entryId);
  };
  const onDropPool = (set: BoardSet) => (e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    const entryId = Number(e.dataTransfer.getData('text/plain'));
    if (!entryId) return;
    const from = set.groups.find((g) => g.memberEntryIds.includes(entryId));
    if (from) unplace(from.id, entryId);
  };

  if (!active) {
    return (
      <section className={ev.panel}>
        <p className={styles.noSets}>
          This signup has no assignment sets yet. Turn on &ldquo;Drivers needed&rdquo; in the Builder for cars;
          patrols, tents and teams come with the Assignments block.
        </p>
      </section>
    );
  }

  const isCar = active.kind === 'car' && active.leg != null;
  const leg = active.leg ?? 'out';
  const drivesLeg = (p: BoardPerson) => (leg === 'out' ? p.drivesOut : p.drivesBack);
  const rideLeg = (p: BoardPerson) => (leg === 'out' ? p.rideOut : p.rideBack);
  const placedIds = new Set(active.groups.flatMap((g) => g.memberEntryIds));

  // Pool: for cars, riders who still need a seat; otherwise everyone attending
  // who isn't in any group of this set. Contributors never travel or tent.
  const eligible = live.filter((p) => p.participation !== 'contributor');
  const pool = isCar
    ? eligible.filter((p) => !drivesLeg(p) && rideLeg(p) === 'needs_ride' && !placedIds.has(p.entryId))
    : eligible.filter((p) => !placedIds.has(p.entryId));
  const onTheirOwn = isCar ? eligible.filter((p) => !drivesLeg(p) && rideLeg(p) !== 'needs_ride') : [];

  const cars: TransportCar[] = isCar
    ? active.groups
        .filter((g) => g.driverEntryId != null)
        .map((g) => ({
          id: g.id,
          leg,
          driverEntryId: g.driverEntryId as number,
          capacity: g.capacity ?? 1,
          memberEntryIds: g.memberEntryIds
        }))
    : [];
  const tiles = isCar
    ? legTiles(
        live.map((p) => ({
          id: p.entryId,
          status: p.status,
          participation: p.participation,
          drivesOut: p.drivesOut,
          drivesBack: p.drivesBack,
          vehicleSeatsOut: p.vehicleSeatsOut,
          vehicleSeatsBack: p.vehicleSeatsBack,
          rideOut: p.rideOut,
          rideBack: p.rideBack
        })),
        cars,
        leg
      )
    : null;

  const moveSelect = (p: BoardPerson, currentGroupId: number | null) => (
    <select
      className={styles.moveSelect}
      aria-label={`Move ${p.name}`}
      value={currentGroupId ?? ''}
      disabled={pending}
      onChange={(e) => {
        const v = e.target.value;
        if (v === '') {
          if (currentGroupId != null) unplace(currentGroupId, p.entryId);
        } else {
          place(Number(v), p.entryId);
        }
      }}
    >
      <option value="">{isCar ? 'Needs a ride' : 'Unassigned'}</option>
      {active.groups.map((g) => (
        <option key={g.id} value={g.id} disabled={g.capacity != null && g.memberEntryIds.length >= g.capacity && g.id !== currentGroupId}>
          {g.name}
          {g.capacity != null ? ` (${g.memberEntryIds.length}/${g.capacity})` : ''}
        </option>
      ))}
    </select>
  );

  const chip = (p: BoardPerson, groupId: number | null, role: 'driver' | null) => (
    <li
      key={p.entryId}
      className={styles.chip}
      draggable={role !== 'driver'}
      data-dragging={dragging === p.entryId ? 'true' : undefined}
      onDragStart={(e) => onDragStart(e, p.entryId)}
      onDragEnd={onDragEnd}
    >
      <span className={styles.chipName}>{p.name}</span>
      {/* Class pill on patrol / tent / crew chips only — same short colored pill
          as the roster; car chips stay bare (Patrick, 2026-08-22). */}
      {role === 'driver' ? <span className={styles.chipRole}>driver</span> : !isCar && <ClassPill cls={p.participantClass} />}
      {role !== 'driver' && moveSelect(p, groupId)}
      {role !== 'driver' && groupId != null && (
        <button
          type="button"
          className={styles.chipX}
          aria-label={`Remove ${p.name} from ${active.groups.find((g) => g.id === groupId)?.name ?? 'group'}`}
          disabled={pending}
          onClick={() => unplace(groupId, p.entryId)}
        >
          ×
        </button>
      )}
    </li>
  );

  return (
    <>
      <SaveFeedback phase={feedback.phase} />
      {tiles && (
        <div className={ev.tiles}>
          <div className={`${ev.tile} ${tiles.unplaced > 0 ? ev.tileWarn : ev.tileOk}`}>
            <div className={ev.tileLabel}>Need a ride {LEG_LABEL[leg].toLowerCase()}</div>
            <div className={ev.tileValue}>{tiles.riders}</div>
            <div className={ev.tileSub}>{tiles.placed} placed · {tiles.unplaced} still to place</div>
          </div>
          <div className={`${ev.tile} ${tiles.shortOver < 0 ? ev.tileWarn : ev.tileOk}`}>
            <div className={ev.tileLabel}>Seats for riders</div>
            <div className={ev.tileValue}>{tiles.room}</div>
            <div className={ev.tileSub}>
              {tiles.drivers} {tiles.drivers === 1 ? 'car' : 'cars'} ·{' '}
              {tiles.shortOver < 0 ? `${-tiles.shortOver} short` : `${tiles.shortOver} to spare`}
            </div>
          </div>
          <div className={ev.tile}>
            <div className={ev.tileLabel}>On their own</div>
            <div className={ev.tileValue}>{tiles.self + tiles.meetingThere}</div>
            <div className={ev.tileSub}>
              {tiles.self} driving separately · {tiles.meetingThere} meeting there · {tiles.notTraveling} not traveling
            </div>
          </div>
        </div>
      )}

      <p className={styles.lede}>
        Drag a name onto a {isCar ? 'car' : 'group'}, or use the Move… control on the name.{' '}
        {isCar
          ? 'Cars come from the signup — who drives and how many seats (including the driver) is set on the roster.'
          : 'Capacity is enforced; a full group refuses the drop.'}
      </p>
      {error && <p className={styles.err}>{error}</p>}

      {!isCar && (
        <div className={styles.addGroup}>
          <input
            placeholder={`New ${active.kind === 'patrol' ? 'patrol' : active.kind === 'tent' ? 'tent' : 'group'} name`}
            aria-label="New group name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <input
            type="number"
            min={1}
            placeholder="Capacity"
            aria-label="New group capacity"
            value={newCap}
            onChange={(e) => setNewCap(e.target.value)}
          />
          <button
            type="button"
            className={ev.enableBtn}
            disabled={pending || !newName.trim()}
            onClick={() =>
              run(async () => {
                const res = await addGroup(active.id, signupId, calendarEntryId, {
                  name: newName,
                  capacity: newCap ? Number(newCap) : undefined
                });
                if (res.ok) {
                  setNewName('');
                  setNewCap('');
                }
                return res;
              })
            }
          >
            Add {active.kind === 'patrol' ? 'patrol' : active.kind === 'tent' ? 'tent' : 'group'}
          </button>
        </div>
      )}

      <div className={styles.columns}>
        <section
          className={`${styles.card} ${styles.pool}`}
          data-over={over === 'pool' ? 'true' : undefined}
          onDragOver={allowDrop('pool')}
          onDragLeave={() => setOver((o) => (o === 'pool' ? null : o))}
          onDrop={onDropPool(active)}
          aria-label={isCar ? 'Needs a ride' : 'Unassigned'}
        >
          <div className={styles.cardHead}>
            <span className={styles.cardTitle}>{isCar ? 'Needs a ride' : 'Unassigned'}</span>
            <span className={styles.capPill}>{pool.length}</span>
          </div>
          {pool.length === 0 ? (
            <p className={styles.empty}>{isCar ? 'Everyone has a seat.' : 'Everyone is placed.'}</p>
          ) : (
            <ul className={styles.chips}>{pool.map((p) => chip(p, null, null))}</ul>
          )}
        </section>

        {active.groups.map((g) => {
          const full = g.capacity != null && g.memberEntryIds.length >= g.capacity;
          const key = `g${g.id}`;
          return (
            <section
              key={g.id}
              className={styles.card}
              data-over={over === key ? 'true' : undefined}
              data-full={full ? 'true' : undefined}
              onDragOver={allowDrop(key)}
              onDragLeave={() => setOver((o) => (o === key ? null : o))}
              onDrop={onDropGroup(g)}
              aria-label={g.name}
            >
              {editingGroup?.id === g.id ? (
                <div className={styles.groupEdit}>
                  {!isCar && (
                    <input
                      aria-label="Group name"
                      value={editingGroup.name}
                      onChange={(e) => setEditingGroup({ ...editingGroup, name: e.target.value })}
                    />
                  )}
                  {!isCar && (
                    <input
                      type="number"
                      min={1}
                      placeholder="Capacity"
                      aria-label="Group capacity"
                      value={editingGroup.capacity}
                      onChange={(e) => setEditingGroup({ ...editingGroup, capacity: e.target.value })}
                    />
                  )}
                  <input
                    placeholder="Note (e.g. pulling trailer)"
                    aria-label="Group note"
                    value={editingGroup.notes}
                    onChange={(e) => setEditingGroup({ ...editingGroup, notes: e.target.value })}
                  />
                  <div className={styles.groupEditActions}>
                    <SaveButton
                      className={ev.enableBtn}
                      dirty={JSON.stringify(editingGroup) !== JSON.stringify(groupDraft(g))}
                      pending={pending}
                      blocked={!isCar && !editingGroup.name.trim()}
                      blockedReason="A group name is required"
                      onClick={() => {
                        feedback.start();
                        run(async () => {
                          const res = await updateGroup(g.id, signupId, calendarEntryId, {
                            name: isCar ? undefined : editingGroup.name,
                            capacity: isCar ? undefined : editingGroup.capacity ? Number(editingGroup.capacity) : null,
                            notes: editingGroup.notes
                          });
                          if (res.ok) {
                            setEditingGroup(null);
                            feedback.done();
                          } else feedback.fail();
                          return res;
                        });
                      }}
                    />
                    <button type="button" className={ev.rowEdit} onClick={() => setEditingGroup(null)}>
                      Cancel
                    </button>
                    {!isCar && (
                      <button
                        type="button"
                        className={ev.rowDel}
                        disabled={pending || g.memberEntryIds.length > 0}
                        title={g.memberEntryIds.length > 0 ? 'Move everyone out first' : undefined}
                        onClick={() =>
                          run(async () => {
                            const res = await deleteGroup(g.id, signupId, calendarEntryId);
                            if (res.ok) setEditingGroup(null);
                            return res;
                          })
                        }
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className={styles.cardHead}>
                  <span className={styles.cardTitle}>
                    {g.name}
                    {/* No phone on the card (Patrick, 2026-08-22) — the roster/contacts carry it. */}
                    {g.notes && <span className={styles.cardSub}>{g.notes}</span>}
                  </span>
                  <span className={styles.cardTools}>
                    <span
                      className={`${styles.capPill} ${full ? styles.capFull : g.capacity != null ? styles.capOpen : ''}`}
                    >
                      {capacityLabel(g.memberEntryIds.length, g.capacity)}
                    </span>
                    <button
                      type="button"
                      className={styles.cardEdit}
                      aria-label={`Edit ${g.name}`}
                      disabled={pending}
                      onClick={() => setEditingGroup(groupDraft(g))}
                    >
                      Edit
                    </button>
                  </span>
                </div>
              )}
              <ul className={styles.chips}>
                {g.memberEntryIds
                  .map((id) => byId.get(id))
                  .filter((p): p is BoardPerson => !!p)
                  .sort((a, b) => (a.entryId === g.driverEntryId ? -1 : b.entryId === g.driverEntryId ? 1 : 0))
                  .map((p) => chip(p, g.id, p.entryId === g.driverEntryId ? 'driver' : null))}
              </ul>
            </section>
          );
        })}
      </div>

      {isCar && onTheirOwn.length > 0 && (
        <div className={styles.side}>
          <p className={styles.sideHead}>Not riding with the troop {LEG_LABEL[leg].toLowerCase()}</p>
          <ul className={styles.sideList}>
            {onTheirOwn.map((p) => (
              <li key={p.entryId} className={styles.chip}>
                <span className={styles.chipName}>{p.name}</span>
                <select
                  className={styles.moveSelect}
                  aria-label={`Ride ${LEG_LABEL[leg].toLowerCase()} — ${p.name}`}
                  value={rideLeg(p) ?? 'needs_ride'}
                  disabled={pending}
                  onChange={(e) =>
                    run(() => setRideStatus(p.entryId, leg, e.target.value, signupId, calendarEntryId))
                  }
                >
                  {RIDE_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {RIDE_STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
