'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ageOn, gradeFromGradYear, gradeLabel, SWIM_CLASS_LABEL } from '@/lib/demographics';
import { INACTIVE_REASON_LABEL } from '@/lib/supabase/types';
import type { RosterDates } from '@/lib/roster-dates';
import { ScoutForm, type ScoutRow } from './scout-form';
import { SortHeader, useSortable } from '../../_components/use-sortable';
import { TabStrip } from '../../_components/tab-strip';
import { AddButton } from '../../_components/add-button';
import { Badge } from '../../_components/badge';
import { Dialog } from '../../_components/dialog';
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
 *
 * Since Phase 6 of Plans/Person-Editor-Rethink.md (2026-09-07) a scout's name
 * links to their record page (`roster/[personId]?from=<tab>`) — the edit
 * dialog is retired; only "+ Add Scout" (ScoutForm, create-once) stays here.
 */

type ColKey =
  | 'id'
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
  | 'status'
  | 'reason'
  | 'created'
  | 'left';

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
type SortableScout = ScoutRow & {
  _today: string;
  _rankLabel: Record<string, string>;
  _created: string | null;
  _left: string | null;
};

function scoutValue(s: SortableScout, key: ColKey): unknown {
  switch (key) {
    case 'id':
      return s.id;
    case 'name':
      return s.display_name;
    case 'age':
      return ageOn(s.birthdate, s._today);
    case 'birthday':
      // Month-day, NOT the full date. Sorting on the ISO date orders by year
      // first, which is just the Age column wearing a different hat. What a
      // birthday column is actually for is "whose is coming up".
      return s.birthdate ? s.birthdate.slice(5) : null;
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
      return s.active ? 'Active' : 'Inactive';
    case 'reason':
      return s.inactive_reason ? INACTIVE_REASON_LABEL[s.inactive_reason] : null;
    case 'created':
      return s._created;
    case 'left':
      return s._left;
    default:
      return null;
  }
}

interface Props {
  scouts: ScoutRow[];
  ranks: { id: string; display_name: string }[];
  rankLabel: Record<string, string>;
  today: string;
  /** Set when the page owns the Active/Inactive split (the four-tab Roster).
   *  The internal tab bar is hidden and this decides the filter, so age-out —
   *  which the page classifies, not this component — cannot be contradicted
   *  here by a bare `scouts.active` test. */
  only?: 'active' | 'inactive' | 'webelos';
  /** The ID "+ Add Webelos" suggests (lib/scout-ids nextWebelosId). */
  suggestedWebelosId?: string;
  /** Created (by people.id) and Left (by scout id), derived in lib/roster-dates (Patrick, 2026-11-01). */
  dates: RosterDates;
}

/** Where a scout's name goes: the record page, remembering the tab it came
 *  from so the page's Back link returns here. Null for a scout with no
 *  linked person (defensive — createScout always links one). */
export function scoutRecordHref(s: Pick<ScoutRow, 'person_id'>, tab: 'active' | 'inactive' | 'webelos'): string | null {
  if (s.person_id == null) return null;
  const from = tab === 'inactive' ? 'inactive_scout' : tab === 'webelos' ? 'webelos' : 'active_scout';
  return `/admin/advancement/roster/${s.person_id}?from=${from}`;
}

export function ScoutsTable({ scouts, ranks, rankLabel, today, only, dates, suggestedWebelosId }: Props) {
  // `only` must NOT seed state. A state initialiser runs once on mount, and
  // React keeps this component mounted when the page navigates between the
  // Active and Inactive roster tabs — so the internal tab stayed 'active'
  // while the page handed over the inactive list, and the table filtered every
  // row away: "18" in the tab, nothing in the body.
  const [ownTab, setOwnTab] = useState<'active' | 'inactive'>('active');
  const tab: 'active' | 'inactive' | 'webelos' = only ?? ownTab;
  const webelosTab = tab === 'webelos';
  const setTab = setOwnTab;
  // The only dialog left here is "+ Add Scout".
  const [adding, setAdding] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (adding && !dlg.open) dlg.showModal();
    if (!adding && dlg.open) dlg.close();
  }, [adding]);

  const activeCount = useMemo(() => scouts.filter((s) => s.active).length, [scouts]);
  const inactiveCount = scouts.length - activeCount;

  // Decorate with the two lookups the comparator needs, so the sort function
  // can stay at module scope and not be rebuilt every render.
  const visible = useMemo(
    () =>
      scouts
        .filter((s) => (tab === 'active' ? s.active : tab === 'webelos' ? !!s.is_webelos : !s.active && !s.is_webelos))
        .map((s) => ({
          ...s,
          _today: today,
          _rankLabel: rankLabel,
          _created: (s.person_id != null ? dates.created[s.person_id] : undefined) ?? null,
          _left: dates.left[s.id] ?? null
        })),
    [scouts, tab, today, rankLabel, dates]
  );

  // The name search moved above the tabs (RosterSearch, 2026-08-27).
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
        {/* The count lives on the tab (Patrick, 2026-08-25: "redundant"). */}
        {!only && (
          <TabStrip
            ariaLabel="Scout status"
            activeKey={tab}
            items={[
              { key: 'active', label: 'Active', count: activeCount, onSelect: () => setTab('active') },
              { key: 'inactive', label: 'Inactive', count: inactiveCount, onSelect: () => setTab('inactive') }
            ]}
          />
        )}
        <span className={styles.toolbarSpacer} />
        <AddButton onClick={() => setAdding(true)}>{webelosTab ? '+ Add Webelos' : '+ Add Scout'}</AddButton>
      </div>

      <table className={styles.table}>
        <thead>
          <tr>
            {head('ID', 'id')}
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
            {/* Created sits after the health form on the Active tab and after the
                Reason on the Inactive tab, with Left beside it (Patrick, 2026-11-01). */}
            {tab !== 'inactive' && head('Created', 'created')}
            {head('Status', 'status')}
            {/* One line per scout (Patrick, 2026-08-27): the reason is its own
                column on the Inactive tab rather than a second line under Status. */}
            {tab === 'inactive' && head('Reason', 'reason')}
            {tab === 'inactive' && head('Created', 'created')}
            {tab === 'inactive' && head('Left', 'left')}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <tr>
              <td colSpan={tab === 'inactive' ? 15 : 13} className={styles.muted}>
                {tab === 'active'
                  ? 'No active scouts.'
                  : webelosTab
                    ? 'No Webelos yet. Add one to sign them up for events and track their advancement before they cross over.'
                    : 'No inactive scouts — nobody has been marked dropped, transferred, moved, or aged out.'}
              </td>
            </tr>
          )}
          {sorted.map((s) => {
            const age = ageOn(s.birthdate, today);
            const grade = gradeFromGradYear(s.graduation_year, today);
            const dash = <span className={styles.muted}>—</span>;
            const href = scoutRecordHref(s, tab);
            return (
              <tr key={s.id}>
                {/* The internal scout id (A02, …). It is the key every other
                    system here uses — the ledger, the Scoutbook export, the
                    ?open= deep links — so it belongs where a leader can read
                    it off, not only in a URL. */}
                <td className={styles.scoutId}>{s.id}</td>
                <td>
                  {href ? (
                    <Link href={href} className={styles.nameBtn} title="Open this scout's record">
                      {s.display_name}
                    </Link>
                  ) : (
                    <span title="No person record linked">{s.display_name}</span>
                  )}
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
                {tab !== 'inactive' && <td>{s._created ? fmtDate(s._created) : dash}</td>}
                <td>
                  <Badge variant={s.is_webelos ? 'info' : s.active ? 'success' : 'danger'}>
                    {s.is_webelos ? 'Webelos' : s.active ? 'Active' : 'Inactive'}
                  </Badge>
                </td>
                {tab === 'inactive' && (
                  <td>{s.inactive_reason ? INACTIVE_REASON_LABEL[s.inactive_reason] : dash}</td>
                )}
                {tab === 'inactive' && <td>{s._created ? fmtDate(s._created) : dash}</td>}
                {tab === 'inactive' && <td>{s._left ? fmtDate(s._left) : dash}</td>}
                {/* The trailing duplicate Edit button is gone (Section 2
                    stretched-link sweep, 2026-08-21) — the scout's name is
                    the single way into the record, as on Calendar/News. */}
              </tr>
            );
          })}
        </tbody>
      </table>

      <Dialog ref={dialogRef} className={styles.editDialogWide} onClose={() => setAdding(false)}>
        {adding && (
          <ScoutForm
            ranks={ranks}
            onClose={() => setAdding(false)}
            webelos={webelosTab}
            suggestedId={webelosTab ? suggestedWebelosId : undefined}
          />
        )}
      </Dialog>
    </>
  );
}
