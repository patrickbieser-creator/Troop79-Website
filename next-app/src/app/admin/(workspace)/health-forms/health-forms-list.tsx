'use client';

/**
 * The admin Health Forms list and its record sheet (Plans/Admin-Health-Forms.md; the sheet is
 * Plans/Admin-Health-Record-Sheet-Redesign.md).
 *
 * Full-width DataTable · Compact; the status tabs carry the totals; Type is a SegmentedControl; the name search is
 * useTableSearch; every column but View sorts (useSortable), Name A–Z by default. A name or View opens the person in
 * a wide AdminDrawer over the list (the list stays mounted). The sheet's contents come from `openRecord`, which writes
 * the access-log line before returning anything; each write in the sheet answers with the record as it now is.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { HEALTH_KINDS, type HealthKind, type HealthStanding, HEALTH_STANDING_LABEL, HEALTH_STANDING_TONE } from '@/lib/health-records';
import { HEALTH_MARK_NAME, type HealthMarkValue } from '@/lib/health-marks';
import type { HealthRecordView, HealthRosterType } from '@/lib/health-store';
import { fmtDate } from '@/lib/format-date';
import { HelpBadge } from '../../_components/help-badge';
import { ActionsMenu } from '../_components/actions-menu';
import { AdminDrawer } from '../_components/admin-drawer';
import { Badge } from '../_components/badge';
import { Button } from '../../_components/button';
import { PageTitle } from '../_components/page-title';
import { SearchField, useTableSearch } from '../_components/search-field';
import { SegmentedControl } from '../_components/segmented-control';
import { TabStrip } from '../_components/tab-strip';
import { SortHeader, useSortable } from '../_components/use-sortable';
import { HealthSheet, HealthSheetFooter, type SheetActions } from './health-sheet';
import styles from './health-forms.module.css';

export interface HealthListRow {
  personId: number;
  name: string;
  firstName: string | null;
  lastName: string | null;
  type: HealthRosterType;
  lastUpload: string | null;
  marks: Record<HealthKind, HealthMarkValue>;
  standing: HealthStanding;
  standingRank: number;
}

export type OpenRecord = (personId: number) => Promise<{ ok: true; record: HealthRecordView } | { ok: false; error: string }>;

type Tab = 'all' | 'attention' | 'soon' | 'ready' | 'complete';
type TypeFilter = 'all' | HealthRosterType;
type ColKey = 'name' | 'last' | 'first' | 'type' | 'updated' | HealthKind | 'status';

const TYPE_LABEL: Record<HealthRosterType, string> = { scout: 'Scout', adult: 'Adult', other: 'Other' };
const MARK_HEADER: Record<HealthKind, string> = { bsa_ab: 'A & B', bsa_c: 'C', insurance: 'Ins.', immunization: 'Imm.' };

const IN_TAB: Record<Tab, (r: HealthListRow) => boolean> = {
  all: () => true,
  attention: (r) => r.standing === 'missing' || r.standing === 'expired',
  soon: (r) => r.standing === 'expires_soon',
  ready: (r) => r.standing === 'ready',
  complete: (r) => r.standing === 'complete'
};

/** Module scope on purpose — see the note on useSortable. */
function value(r: HealthListRow, key: ColKey): unknown {
  switch (key) {
    case 'name':
      return r.name;
    case 'last':
      return r.lastName;
    case 'first':
      return r.firstName;
    case 'type':
      return TYPE_LABEL[r.type];
    case 'updated':
      return r.lastUpload;
    case 'status':
      return r.standingRank;
    default:
      return r.marks[key].rank;
  }
}
const searchFields = (r: HealthListRow) => [r.name, r.firstName, r.lastName];

function setPersonInUrl(personId: number | null) {
  const url = new URL(window.location.href);
  if (personId == null) url.searchParams.delete('person');
  else url.searchParams.set('person', String(personId));
  window.history.replaceState(window.history.state, '', url);
}

export function HealthFormsList({
  rows,
  initialPersonId,
  lede,
  today,
  openRecord,
  actions
}: {
  rows: HealthListRow[];
  initialPersonId: number | null;
  lede: string;
  /** Central-time calendar day, from the server: the sheet rates documents as of it. */
  today: string;
  openRecord: OpenRecord;
  actions: SheetActions;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('all');
  const [type, setType] = useState<TypeFilter>('all');

  const typed = useMemo(() => (type === 'all' ? rows : rows.filter((r) => r.type === type)), [rows, type]);
  const { q, setQ, visible: searched } = useTableSearch(typed, searchFields);
  const shown = useMemo(() => searched.filter(IN_TAB[tab]), [searched, tab]);
  const { sorted, sortKey, sortDir, toggle } = useSortable<HealthListRow, ColKey>(shown, value, 'name');

  // The sheet: which person, and what the logging action returned for them.
  const [openId, setOpenId] = useState<number | null>(initialPersonId);
  const [record, setRecord] = useState<HealthRecordView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(initialPersonId != null);

  // Which open is current: a slow answer for someone already closed (or replaced) must not land under another name.
  const request = useRef(0);
  const open = useCallback(
    async (personId: number) => {
      const mine = (request.current += 1);
      setOpenId(personId);
      setPersonInUrl(personId);
      setRecord(null);
      setError(null);
      setLoading(true);
      const res = await openRecord(personId);
      if (mine !== request.current) return;
      setLoading(false);
      if (res.ok) setRecord(res.record);
      else setError(res.error);
    },
    [openRecord]
  );
  const close = useCallback(() => {
    request.current += 1;
    setOpenId(null);
    setRecord(null);
    setError(null);
    setPersonInUrl(null);
  }, []);

  // A linked ?person= opens once on arrival (the loading state is already set above; only the fetch runs here).
  useEffect(() => {
    if (initialPersonId == null) return;
    let live = true;
    void openRecord(initialPersonId).then((res) => {
      if (!live) return;
      setLoading(false);
      if (res.ok) setRecord(res.record);
      else setError(res.error);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A write in the sheet answers with the record; the action's revalidatePath refreshes the list underneath. A late
  // answer for someone no longer open is dropped.
  const onRecord = useCallback((r: HealthRecordView) => setRecord((cur) => (cur && cur.personId === r.personId ? r : cur)), []);
  const openRow = openId == null ? null : (rows.find((r) => r.personId === openId) ?? null);

  const counts = useMemo(() => {
    const c = {} as Record<Tab, number>;
    for (const t of Object.keys(IN_TAB) as Tab[]) c[t] = searched.filter(IN_TAB[t]).length;
    return c;
  }, [searched]);

  const sh = { sortKey, sortDir, toggle };

  return (
    <>
      <PageTitle back={null} title="Health Forms" sub={lede}>
        <div className={styles.headActions}>
          <ActionsMenu
            ariaLabel="Health Forms actions"
            options={[
              { value: 'viewers', label: 'Who can open health records' },
              { value: 'log', label: 'Access log' }
            ]}
            onAction={(v) => router.push(v === 'viewers' ? '/admin/health-forms/viewers' : '/admin/health-forms/log')}
          />
        </div>
      </PageTitle>

      <TabStrip
        ariaLabel="Health status"
        activeKey={tab}
        items={[
          { key: 'all', label: 'All', count: counts.all, onSelect: () => setTab('all') },
          { key: 'attention', label: 'Missing or expired', count: counts.attention, onSelect: () => setTab('attention') },
          { key: 'soon', label: 'Expires soon', count: counts.soon, onSelect: () => setTab('soon') },
          { key: 'ready', label: 'Ready for review', count: counts.ready, onSelect: () => setTab('ready') },
          { key: 'complete', label: 'Reviewed', count: counts.complete, onSelect: () => setTab('complete') }
        ]}
      />

      <div className={styles.toolbar}>
        <SearchField value={q} onChange={setQ} label="Search health records by name" resultCount={shown.length} totalCount={typed.length} />
        <SegmentedControl<TypeFilter>
          name="health-type"
          label="Type"
          value={type}
          onChange={setType}
          options={[
            { value: 'all', label: 'All' },
            { value: 'scout', label: 'Scouts' },
            { value: 'adult', label: 'Adults' },
            { value: 'other', label: 'Other' }
          ]}
        />
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <SortHeader label="Name" colKey="name" {...sh} />
              <SortHeader label="Last" colKey="last" {...sh} />
              <SortHeader label="First" colKey="first" {...sh} />
              <SortHeader label="Type" colKey="type" {...sh} />
              <SortHeader label="Updated" colKey="updated" {...sh} />
              {HEALTH_KINDS.map((k) => (
                <SortHeader key={k} label={MARK_HEADER[k]} colKey={k} title={HEALTH_MARK_NAME[k]} {...sh} />
              ))}
              <SortHeader label="Status" colKey="status" {...sh} />
              <th className={styles.actionsCell}>
                <HelpBadge id="health.marks" size={16} />
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={HEALTH_KINDS.length + 7} className={styles.empty}>
                  {rows.length === 0 ? 'Nobody has health records yet. Families add them under Members › Health forms.' : 'Nobody matches.'}
                </td>
              </tr>
            ) : (
              sorted.map((r) => (
                <tr key={r.personId} className={styles.rowLink}>
                  <td className={styles.nameCell}>
                    <a
                      href={`?person=${r.personId}`}
                      onClick={(e) => {
                        e.preventDefault();
                        void open(r.personId);
                      }}
                    >
                      {r.name}
                    </a>
                  </td>
                  <td className={styles.wide}>{r.lastName ?? ''}</td>
                  <td className={styles.wide}>{r.firstName ?? ''}</td>
                  <td>{TYPE_LABEL[r.type]}</td>
                  <td className={styles.nowrap}>{r.lastUpload ? fmtDate(r.lastUpload) : ''}</td>
                  {HEALTH_KINDS.map((k) => (
                    <td key={k} className={styles.markCell}>
                      <span className={styles[`mark_${r.marks[k].tone}`]} aria-hidden="true">
                        {r.marks[k].text}
                      </span>
                      <span className={styles.srOnly}>{r.marks[k].srText}</span>
                    </td>
                  ))}
                  <td className={styles.nowrap}>
                    <Badge variant={HEALTH_STANDING_TONE[r.standing]}>{HEALTH_STANDING_LABEL[r.standing]}</Badge>
                  </td>
                  <td className={styles.actionsCell}>
                    <Button variant="quiet" size="sm" onClick={() => void open(r.personId)} aria-label={`View ${r.name}`}>
                      View
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {openId != null && (
        <AdminDrawer
          wide
          title={openRow?.name ?? record?.name ?? 'Health record'}
          sub={
            <>
              {openRow ? TYPE_LABEL[openRow.type] : ''}
              {openRow && record?.lastUpload ? ' · ' : ''}
              {record?.lastUpload ? `Last upload ${fmtDate(record.lastUpload)}` : ''}
            </>
          }
          onClose={close}
          footer={record ? <HealthSheetFooter record={record} actions={actions} onRecord={onRecord} onClose={close} /> : undefined}
        >
          {loading ? (
            <p className={styles.muted}>Opening…</p>
          ) : error ? (
            <p className={styles.problem}>{error}</p>
          ) : record ? (
            <HealthSheet record={record} today={today} actions={actions} onRecord={onRecord} />
          ) : null}
        </AdminDrawer>
      )}
    </>
  );
}
