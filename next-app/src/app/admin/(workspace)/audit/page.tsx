/**
 * /admin/audit — the content audit trail (Patrick, 2026-08-30): who changed
 * what, when, across news / calendar / roster / resource library. Rows are
 * written by lib/audit.recordAudit from each area's server actions;
 * advancement and finance are excluded by design — they have ledgers of
 * record. Read-only; gated on roster.manage because roster rows reference
 * people (the most sensitive of the four areas).
 */

import { createAdminClient } from '@/lib/supabase/server';
import { requireCapability } from '@/lib/require-capability';
import { fmtDateTime } from '@/lib/format-date';
import { AUDIT_AREAS, type AuditArea } from '@/lib/audit';
import { PageTitle } from '../_components/page-title';
import { TabStrip } from '../_components/tab-strip';
import styles from './audit.module.css';

export const metadata = {
  title: 'Audit Trail — Troop 79 Admin'
};

const AREA_LABEL: Record<AuditArea, string> = {
  news: 'News',
  calendar: 'Calendar',
  roster: 'Roster',
  library: 'Library'
};

interface AuditRow {
  id: number;
  occurred_at: string;
  actor_label: string;
  area: AuditArea;
  action: string;
  entity_type: string;
  entity_id: string | null;
  summary: string;
}

const PAGE_SIZE = 200;

export default async function AuditTrailPage({
  searchParams
}: {
  searchParams: Promise<{ area?: string }>;
}) {
  await requireCapability('roster.manage');
  const { area } = await searchParams;
  const activeArea = (AUDIT_AREAS as readonly string[]).includes(area ?? '') ? (area as AuditArea) : null;

  const supabase = createAdminClient();
  let q = supabase
    .from('audit_log')
    .select('id, occurred_at, actor_label, area, action, entity_type, entity_id, summary')
    .order('occurred_at', { ascending: false })
    .limit(PAGE_SIZE);
  if (activeArea) q = q.eq('area', activeArea);
  const { data } = await q;
  const rows = (data ?? []) as AuditRow[];

  return (
    <>
      <PageTitle back={null}
        title="Audit Trail"
        sub="Every content change — news, calendar, roster, and Resource Library —
          with who made it and when. Advancement and finance aren't here: they
          have their own ledgers."
      />

      <div className={styles.toolbar}>
        <TabStrip
          ariaLabel="Filter by area"
          activeKey={activeArea ?? 'all'}
          items={[
            { key: 'all', label: 'All', href: '/admin/audit' },
            ...AUDIT_AREAS.map((a) => ({
              key: a,
              label: AREA_LABEL[a],
              href: `/admin/audit?area=${a}`
            }))
          ]}
        />
      </div>

      {rows.length === 0 ? (
        <p className={styles.empty}>
          Nothing recorded{activeArea ? ` for ${AREA_LABEL[activeArea]}` : ''} yet — entries appear
          here as content changes are made.
        </p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Area</th>
                <th>Action</th>
                <th>What</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className={styles.when}>{fmtDateTime(r.occurred_at)}</td>
                  <td>{r.actor_label}</td>
                  <td>{AREA_LABEL[r.area] ?? r.area}</td>
                  <td className={styles.action}>{r.action}</td>
                  <td>
                    {r.summary}
                    {r.entity_id && (
                      <span className={styles.entityRef}>
                        {' '}
                        ({r.entity_type} {r.entity_id})
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === PAGE_SIZE && (
            <p className={styles.capNote}>
              Showing the most recent {PAGE_SIZE} entries{activeArea ? ` for ${AREA_LABEL[activeArea]}` : ''}.
            </p>
          )}
        </div>
      )}
    </>
  );
}
