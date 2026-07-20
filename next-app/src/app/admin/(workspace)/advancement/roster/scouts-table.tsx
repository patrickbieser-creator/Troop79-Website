'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ageOn, gradeFromGradYear, gradeLabel, SWIM_CLASS_LABEL } from '@/lib/demographics';
import { INACTIVE_REASON_LABEL } from '@/lib/supabase/types';
import { ScoutForm, type ScoutRow, type ParentRow } from './scout-form';
import { SortHeader, useSortable } from './use-sortable';
import styles from './roster.module.css';

/*
 * The troop's scout roster — and, since v1.12, the place scouts are MANAGED.
 * Scout add/edit and the active/inactive toggle used to live in Lookups &
 * Admin; a roster you can read but not correct meant spotting a wrong grade
 * here and fixing it two screens away.
 *
 * Active and inactive are tabs rather than a filter control because they are
 * different jobs: the active tab is the working roster you print and take to
 * a campout, the inactive tab is the archive you consult when someone comes
 * back or you need history.
 */

type ColKey =
  | 'name'
  | 'age'
  | 'birthday'
  | 'grade'
  | 'school'
  | 'patrol'
  | 'rank'
  | 'swim'
  | 'bsa'
  | 'health'
  | 'status';

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(`${iso}T12:00:00Z`));
}

/** The lookups the comparator needs, carried on the row so the sort function
 *  can live at module scope instead of being rebuilt each render. */
type SortableScout = ScoutRow & { _today: string; _rankLabel: Record<string, string> };

/** Module scope on purpose — see the note on useSortable. */
function scoutValue(s: SortableScout, key: ColKey): unknown {
  switch (key) {
    case 'name':
      return s.display_name;
    case 'age':
      return ageOn(s.birthdate, s._today);
    case 'birthday':
      return s.birthdate;
    case 'grade':
      return gradeFromGradYear(s.graduation_year, s._today);
    case 'school':
      return s.school;
    case 'patrol':
      return s.patrol;
    case 'rank':
      return s.current_rank ? (s._rankLabel[s.current_rank] ?? s.current_rank) : null;
    case 'swim':
      return s.swim_class ? SWIM_CLASS_LABEL[s.swim_class] : null;
    case 'bsa':
      return s.bsa_member_id;
    case 'health':
      return s.health_form_date;
    case 'status':
      return s.active ? 'Active' : (s.inactive_reason ? INACTIVE_REASON_LABEL[s.inactive_reason] : 'Inactive');
    default:
      return null;
  }
}

interface Props {
  scouts: ScoutRow[];
  ranks: { id: string; display_name: string }[];
  rankLabel: Record<string, string>;
  parentsByScout: Record<string, ParentRow[]>;
  today: string;
  /** Set when the page owns the Active/Inactive split (the four-tab Roster).
   *  The internal tab bar is hidden and this decides the filter, so age-out —
   *  which the page classifies, not this component — cannot be contradicted
   *  here by a bare `scouts.active` test. */
  only?: 'active' | 'inactive';
}

export function ScoutsTable({ scouts, ranks, rankLabel, parentsByScout, today, only }: Props) {
  const [tab, setTab] = useState<'active' | 'inactive'>(only ?? 'active');
  const [openFor, setOpenFor] = useState<ScoutRow | 'new' | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (openFor && !dlg.open) dlg.showModal();
    if (!openFor && dlg.open) dlg.close();
  }, [openFor]);

  const activeCount = useMemo(() => scouts.filter((s) => s.active).length, [scouts]);
  const inactiveCount = scouts.length - activeCount;

  // Decorate with the two lookups the comparator needs, so the sort function
  // can stay at module scope and not be rebuilt every render.
  const visible = useMemo(
    () =>
      scouts
        .filter((s) => (tab === 'active' ? s.active : !s.active))
        .map((s) => ({ ...s, _today: today, _rankLabel: rankLabel })),
    [scouts, tab, today, rankLabel]
  );

  const { sorted, sortKey, sortDir, toggle } = useSortable<SortableScout, ColKey>(
    visible,
    scoutValue,
    'name'
  );

  const head = (label: string, colKey: ColKey, align?: 'right') => (
    <SortHeader
      label={label}
      colKey={colKey}
      sortKey={sortKey}
      sortDir={sortDir}
      toggle={toggle}
      align={align}
    />
  );

  return (
    <>
      <div className={styles.tableToolbar}>
        {only ? (
          <span className={styles.toolbarCount}>{scouts.length} scouts</span>
        ) : (
          <div className={styles.tabs} role="tablist" aria-label="Scout status">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'active'}
              className={tab === 'active' ? styles.tabActive : styles.tab}
              onClick={() => setTab('active')}
            >
              Active ({activeCount})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'inactive'}
              className={tab === 'inactive' ? styles.tabActive : styles.tab}
              onClick={() => setTab('inactive')}
            >
              Inactive ({inactiveCount})
            </button>
          </div>
        )}
        <button type="button" className={styles.addBtn} onClick={() => setOpenFor('new')}>
          + Add Scout
        </button>
      </div>

      <table className={styles.table}>
        <thead>
          <tr>
            {head('Scout', 'name')}
            {head('Age', 'age')}
            {head('Birthday', 'birthday')}
            {head('Grade', 'grade')}
            {head('School', 'school')}
            {head('Patrol', 'patrol')}
            {head('Rank', 'rank')}
            {head('Swim', 'swim')}
            {head('BSA ID', 'bsa')}
            {head('Health Form', 'health')}
            {head('Status', 'status')}
            <th style={{ textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <tr>
              <td colSpan={12} className={styles.muted}>
                {tab === 'active'
                  ? 'No active scouts.'
                  : 'No inactive scouts — nobody has been marked dropped, transferred, moved, or aged out.'}
              </td>
            </tr>
          )}
          {sorted.map((s) => {
            const age = ageOn(s.birthdate, today);
            const grade = gradeFromGradYear(s.graduation_year, today);
            const dash = <span className={styles.muted}>—</span>;
            return (
              <tr key={s.id}>
                <td>
                  <button
                    type="button"
                    className={styles.nameBtn}
                    onClick={() => setOpenFor(s)}
                    title="Edit this scout"
                  >
                    {s.display_name}
                  </button>
                </td>
                <td>{age ?? dash}</td>
                <td>{s.birthdate ? fmtDate(s.birthdate) : dash}</td>
                <td>{grade !== null ? gradeLabel(grade) : dash}</td>
                <td>{s.school ?? dash}</td>
                <td>{s.patrol ?? dash}</td>
                <td>{s.current_rank ? (rankLabel[s.current_rank] ?? s.current_rank) : dash}</td>
                <td>{s.swim_class ? SWIM_CLASS_LABEL[s.swim_class] : dash}</td>
                <td className={styles.mono}>{s.bsa_member_id ?? dash}</td>
                <td>{s.health_form_date ? fmtDate(s.health_form_date) : dash}</td>
                <td>
                  <span className={s.active ? styles.tagActive : styles.tagInactive}>
                    {s.active ? 'Active' : 'Inactive'}
                  </span>
                  {!s.active && s.inactive_reason && (
                    <span className={styles.subText}>
                      {INACTIVE_REASON_LABEL[s.inactive_reason]}
                    </span>
                  )}
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button type="button" className={styles.editBtn} onClick={() => setOpenFor(s)}>
                    Edit
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <dialog
        ref={dialogRef}
        className={styles.editDialog}
        onClose={() => setOpenFor(null)}
        onClick={(e) => {
          if (e.target === dialogRef.current) setOpenFor(null);
        }}
      >
        {openFor && (
          <ScoutForm
            row={openFor === 'new' ? null : openFor}
            initialParents={openFor !== 'new' ? (parentsByScout[openFor.id] ?? []) : []}
            ranks={ranks}
            onClose={() => setOpenFor(null)}
          />
        )}
      </dialog>
    </>
  );
}
