/**
 * /admin/health-forms — Admin › People & Setup › Health Forms (Plans/Admin-Health-Forms.md, phase 2: read-only).
 *
 * The routine-maintenance home for health records: everyone the troop keeps records for, with a mark per document
 * and a status, and each person's record in a side sheet. Only an admin who is also on the health viewers list gets
 * in (decision 3); the layout has already required admin access, and the nav item shows only to viewers.
 * Writes (upload, remove, review) and the bulk actions arrive in phases 3 and 4.
 */
import { createAdminClient } from '@/lib/supabase/server';
import { healthAdminAccess } from '@/lib/health-access';
import { healthFilesConfigured } from '@/lib/health-files';
import { loadHealthRoster } from '@/lib/health-store';
import { HEALTH_KINDS, healthStanding } from '@/lib/health-records';
import { healthMark, HEALTH_STANDING_RANK } from '@/lib/health-marks';
import { centralToday } from '@/lib/dates';
import { PageTitle } from '../_components/page-title';
import { Notice } from '../_components/notice';
import { HealthFormsList, type HealthListRow } from './health-forms-list';
import { openHealthRecordAction } from './actions';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Health Forms — Troop 79 Admin'
};

const LEDE = 'Forms, insurance cards and immunizations for outings. Opening a record is logged, and families can see who did.';

export default async function HealthFormsPage({ searchParams }: { searchParams: Promise<{ person?: string }> }) {
  const access = await healthAdminAccess();
  if (!access?.named) {
    return (
      <>
        <PageTitle back={null} title="Health Forms" />
        <Notice variant="info">Health Forms is for leaders on the health records list. Ask one of them to add you.</Notice>
      </>
    );
  }
  if (!healthFilesConfigured()) {
    return (
      <>
        <PageTitle back={null} title="Health Forms" sub={LEDE} />
        <Notice variant="info">Health records aren&rsquo;t switched on yet.</Notice>
      </>
    );
  }

  const sp = await searchParams;
  const today = centralToday();
  const roster = await loadHealthRoster(createAdminClient());
  const rows: HealthListRow[] = roster.map((r) => {
    const standing = healthStanding(r.pages, { reviewed: r.review != null, needsPartC: false, today });
    return {
      personId: r.personId,
      name: r.name,
      firstName: r.firstName,
      lastName: r.lastName,
      type: r.type,
      lastUpload: r.lastUpload,
      marks: Object.fromEntries(HEALTH_KINDS.map((k) => [k, healthMark(k, r.pages, today)])) as HealthListRow['marks'],
      standing,
      standingRank: HEALTH_STANDING_RANK[standing]
    };
  });
  const initialPerson = Number(sp.person);

  return (
    <HealthFormsList
      rows={rows}
      initialPersonId={Number.isInteger(initialPerson) && initialPerson > 0 ? initialPerson : null}
      lede={LEDE}
      today={today}
      openRecord={openHealthRecordAction}
    />
  );
}
