/**
 * /admin/advancement/lookups — Reference tables. Each card has an editor:
 *   - Merit Badges: edit (modal)
 *   - Internal Requirement Codes: edit (modal), top-level rows only — nested
 *     sub-requirement trees are edited per-MB in the Merit Badge card instead
 *
 * Scouts and adults are NOT here — they moved to /admin/advancement/roster in
 * v1.12. This page still READS both tables to populate the merit-badge
 * counselor and Meeting Plan skill-assignment pickers.
 */

import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/server';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { requireRole } from '@/lib/require-role';
// Scout and adult MANAGEMENT moved to /admin/advancement/roster in v1.12 —
// this page still READS both to build the merit-badge counselor and skill
// assignment pickers, so the row types come from there.
import type { LeaderRow } from '../roster/leader-form';
import type { ScoutRow } from '../roster/scout-form';
import { MbEditor, type MbRow, type CounselorRow, type EditReqNode } from './mb-editor';
import { NameLookupEditor, type NameRow } from './name-lookup-editor';
import { EventEditor, type EventRow } from './event-editor';
import { ReqCodesTable, type ReqRow } from './req-codes-table';
import { LookupCard } from './lookup-card';
import { SkillsEditor, type SkillRow } from './skills-editor';
import { SkillAssignEditor, type AssignPerson } from './skill-assign-editor';
import { TagsManager } from './tags-manager';
import type { Tag } from '@/lib/supabase/types';
import {
  createEvent,
  updateEvent,
  deleteEvent,
  createServiceProject,
  updateServiceProject,
  deleteServiceProject,
  createLeadershipPosition,
  updateLeadershipPosition,
  deleteLeadershipPosition,
  createSkill,
  updateSkill,
  deleteSkill,
  setLeaderSkills,
  setScoutInstructorSkills
} from './actions';
import styles from './lookups.module.css';

interface MbReqRowFull {
  id: number;
  mb_id: string;
  parent_id: number | null;
  code: string;
  label: string;
  complete_rule: 'all' | 'any' | 'n-of';
  complete_n: number | null;
  sort_order: number;
}

function buildEditTree(rows: MbReqRowFull[]): EditReqNode[] {
  const byParent = new Map<number | null, MbReqRowFull[]>();
  for (const r of rows) {
    const list = byParent.get(r.parent_id) ?? [];
    list.push(r);
    byParent.set(r.parent_id, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.sort_order - b.sort_order);
  }
  function build(parentId: number | null): EditReqNode[] {
    const kids = byParent.get(parentId) ?? [];
    return kids.map((k) => ({
      id: k.id,
      code: k.code,
      originalCode: k.code,
      label: k.label,
      complete_rule: k.complete_rule,
      complete_n: k.complete_n,
      children: build(k.id)
    }));
  }
  return build(null);
}

export const metadata = {
  title: 'Lookups & Admin — Troop 79'
};

async function loadLookups() {
  const supabase = createAdminClient();

  const [
    leadersRes,
    scoutsRes,
    mbsRes,
    counselorsRes,
    ranksRes,
    rankReqsRes,
    mbReqsRes,
    mbReqsFullRes,
    eventsRes,
    serviceProjectsRes,
    leadershipPositionsRes,
    tagsRes
  ] = await Promise.all([
    supabase.from('leaders').select('*').order('code'),
    supabase
      .from('scouts')
      .select(
        'id, first_name, last_name, display_name, patrol, current_rank, bsa_member_id, birthdate, gender, school, graduation_year, swim_class, active, inactive_reason, address_line1, address_line2, city, state, zip, phone, email, health_form_date'
      )
      .order('display_name'),
    supabase
      .from('merit_badges')
      .select('id, name, eagle, scoutbook_id, bsa_page_url, workbook_url')
      .order('name'),
    supabase
      .from('merit_badge_counselors')
      .select('mb_id, leader_code, sort_order')
      .order('mb_id')
      .order('sort_order'),
    supabase.from('ranks').select('id, display_name, sort_order').order('sort_order'),
    supabase
      .from('rank_requirements')
      .select('id, rank_id, code, label')
      .is('parent_id', null)
      .order('rank_id'),
    supabase
      .from('merit_badge_requirements')
      .select('id, mb_id, code, label')
      .is('parent_id', null)
      .order('mb_id'),
    // Full MB requirement tree for the per-badge editor. Past the 1000-row
    // PostgREST cap (1,700+ rows) — paginate so late-alphabet badges' trees
    // aren't silently dropped (lib/supabase/paginate.ts).
    fetchAllRows<MbReqRowFull>((from, to) =>
      supabase
        .from('merit_badge_requirements')
        .select('id, mb_id, parent_id, code, label, complete_rule, complete_n, sort_order')
        .order('mb_id')
        .order('sort_order')
        .range(from, to)
    ),
    supabase.from('events').select('id, name, default_kind, start_date').order('name'),
    supabase.from('service_projects').select('id, name').order('name'),
    supabase.from('leadership_positions').select('id, name').order('name'),
    supabase.from('tags').select('*').order('name')
  ]);

  const [skillsRes, leaderSkillsRes, scoutInstructorsRes] = await Promise.all([
    supabase.from('skills').select('id, name, youth_teachable, sort_order').order('sort_order'),
    supabase.from('leader_skills').select('leader_code, skill_id'),
    supabase.from('scout_instructors').select('scout_id, skill_id')
  ]);

  // Group counselors by MB
  const counselorsByMb = new Map<string, CounselorRow[]>();
  for (const c of (counselorsRes.data ?? []) as CounselorRow[]) {
    const list = counselorsByMb.get(c.mb_id) ?? [];
    list.push(c);
    counselorsByMb.set(c.mb_id, list);
  }

  // Build MB requirement trees for the editor.
  type MbReqRowFull = {
    id: number;
    mb_id: string;
    parent_id: number | null;
    code: string;
    label: string;
    complete_rule: 'all' | 'any' | 'n-of';
    complete_n: number | null;
    sort_order: number;
  };
  const reqsByMb = new Map<string, MbReqRowFull[]>();
  for (const r of mbReqsFullRes) {
    const list = reqsByMb.get(r.mb_id) ?? [];
    list.push(r);
    reqsByMb.set(r.mb_id, list);
  }
  const mbReqTrees = new Map<string, EditReqNode[]>();
  for (const [mbId, rows] of reqsByMb.entries()) {
    mbReqTrees.set(mbId, buildEditTree(rows));
  }

  const ranks = (ranksRes.data ?? []) as { id: string; display_name: string; sort_order: number }[];
  const rankLabels = new Map(ranks.map((r) => [r.id, r.display_name]));
  const mbs = (mbsRes.data ?? []) as MbRow[];
  const mbLabels = new Map(mbs.map((m) => [m.id, m.name]));

  const reqs: ReqRow[] = [
    ...((rankReqsRes.data ?? []) as { id: number; rank_id: string; code: string; label: string }[]).map(
      (r) => ({
        id: r.id,
        source: 'rank' as const,
        parentId: r.rank_id,
        parentLabel: rankLabels.get(r.rank_id) ?? r.rank_id,
        code: r.code,
        label: r.label
      })
    ),
    ...((mbReqsRes.data ?? []) as { id: number; mb_id: string; code: string; label: string }[]).map(
      (r) => ({
        id: r.id,
        source: 'mb' as const,
        parentId: r.mb_id,
        parentLabel: mbLabels.get(r.mb_id) ?? r.mb_id,
        code: r.code,
        label: r.label
      })
    )
  ];

  // Skills + assignments (Meeting Plan)
  const skills = (skillsRes.data ?? []) as SkillRow[];
  const skillIdsByLeader = new Map<string, string[]>();
  for (const ls of (leaderSkillsRes.data ?? []) as { leader_code: string; skill_id: string }[]) {
    const list = skillIdsByLeader.get(ls.leader_code) ?? [];
    list.push(ls.skill_id);
    skillIdsByLeader.set(ls.leader_code, list);
  }
  const skillIdsByScout = new Map<string, string[]>();
  for (const si of (scoutInstructorsRes.data ?? []) as { scout_id: string; skill_id: string }[]) {
    const list = skillIdsByScout.get(si.scout_id) ?? [];
    list.push(si.skill_id);
    skillIdsByScout.set(si.scout_id, list);
  }

  return {
    leaders: (leadersRes.data ?? []) as LeaderRow[],
    scouts: (scoutsRes.data ?? []) as ScoutRow[],
    mbs,
    counselorsByMb,
    mbReqTrees,
    ranks: ranks.map((r) => ({ id: r.id, display_name: r.display_name })),
    ranksFull: ranks,
    reqs,
    events: (eventsRes.data ?? []) as EventRow[],
    serviceProjects: (serviceProjectsRes.data ?? []) as NameRow[],
    leadershipPositions: (leadershipPositionsRes.data ?? []) as NameRow[],
    skills,
    skillIdsByLeader,
    skillIdsByScout,
    tags: (tagsRes.data ?? []) as Tag[]
  };
}

export default async function LookupsPage() {
  await requireRole(['leader']);
  const {
    leaders,
    scouts,
    mbs,
    counselorsByMb,
    mbReqTrees,
    ranksFull,
    reqs,
    events,
    serviceProjects,
    leadershipPositions,
    skills,
    skillIdsByLeader,
    skillIdsByScout,
    tags
  } = await loadLookups();
  const leadersLite = leaders.map((l) => ({ code: l.code, name: l.name }));

  // Classify sign-off initials: youth = linked to an ACTIVE scout; aging out
  // (scout inactive) automatically flips those initials to adult.
  const activeScoutIds = new Set(scouts.filter((s) => s.active).map((s) => s.id));
  const leaderType = (l: LeaderRow): 'adult' | 'youth' | 'source' =>
    !l.is_person ? 'source' : l.scout_id && activeScoutIds.has(l.scout_id) ? 'youth' : 'adult';

  // What each adult's login label would be if their login_name override were
  // blank — shown as a placeholder hint in the edit dialog. Computed over the
  // exact same pool the login system uses (current adults only — an active
  // youth leader isn't in this set yet, even if Type=Youth here).

  // Skill-assignment rows (Meeting Plan): ADULTS only — the engine schedules
  // anyone here as an adult teacher, including adults-only skills.
  const leaderPeople: AssignPerson[] = leaders
    .filter((l) => leaderType(l) === 'adult')
    .map((l) => ({
      key: l.code,
      name: l.name,
      sub: l.role ?? null,
      skillIds: skillIdsByLeader.get(l.code) ?? []
    }));
  const rankSort = new Map(ranksFull.map((r) => [r.id, r.sort_order]));
  const rankName = new Map(ranksFull.map((r) => [r.id, r.display_name]));
  const starSort = rankSort.get('star') ?? Number.MAX_SAFE_INTEGER;
  const instructorPeople: AssignPerson[] = scouts
    .filter(
      (s) => s.active && s.current_rank && (rankSort.get(s.current_rank) ?? -1) >= starSort
    )
    .map((s) => ({
      key: s.id,
      name: s.display_name,
      sub: s.current_rank ? (rankName.get(s.current_rank) ?? s.current_rank) : null,
      skillIds: skillIdsByScout.get(s.id) ?? []
    }));
  const youthSkills = skills.filter((s) => s.youth_teachable);

  return (
    <>
      <div className={styles.pageTitle}>
        <h1>Lookups &amp; Admin</h1>
        <p>
          The editable Troop 79 taxonomy. Internal codes, BSA Member IDs, leader
          signoff initials, and the merit-badge catalog. Click <strong>Edit</strong>{' '}
          on any row to make changes. Scouts and adults are managed on the{' '}
          <Link href="/admin/advancement/roster">Roster</Link>.
        </p>
      </div>

      {/* The Scouts and "Adults and Instructors" cards used to sit here. They
          moved to /admin/advancement/roster in v1.12 so the roster you read and
          the record you correct are the same screen. This page still reads both
          tables for the counselor and skill-assignment pickers below. */}

      <div className={styles.grid}>
        <Card title="Merit Badge Catalog" sub={`${mbs.length} merit badges · BSA Scoutbook IDs for export · assigned counselors`}>
          <MbEditor
            rows={mbs}
            leaders={leadersLite}
            counselorsByMb={counselorsByMb}
            reqTreesByMb={mbReqTrees}
          />
        </Card>

        <Card
          title="Internal Requirement Codes"
          sub={`${reqs.length} top-level codes · renaming a code updates matching ledger entries too · nested sub-requirement trees are edited per-MB in the Merit Badge Catalog card`}
        >
          <ReqCodesTable rows={reqs} />
        </Card>
      </div>

      <div className={styles.grid}>
        <Card
          title="Events"
          sub={`${events.length} events · each classified as a Campout, Hike, Day Outing, or Fundraiser so Fast Entry never has to ask twice · drives the Events tab pull-down · not a foreign key, so removing one only affects the picker`}
        >
          <EventEditor
            rows={events}
            onCreate={createEvent}
            onUpdate={updateEvent}
            onDelete={deleteEvent}
          />
        </Card>

        <Card
          title="Service Projects"
          sub={`${serviceProjects.length} projects · drives the Service tab pull-down · hours entered per data-entry`}
        >
          <NameLookupEditor
            rows={serviceProjects}
            noun="Service Project"
            onCreate={createServiceProject}
            onUpdate={updateServiceProject}
            onDelete={deleteServiceProject}
          />
        </Card>
      </div>

      <div className={styles.grid}>
        <Card
          title="Leadership Positions"
          sub={`${leadershipPositions.length} positions · drives the Leadership tab pull-down`}
        >
          <NameLookupEditor
            rows={leadershipPositions}
            noun="Leadership Position"
            onCreate={createLeadershipPosition}
            onUpdate={updateLeadershipPosition}
            onDelete={deleteLeadershipPosition}
          />
        </Card>

        <Card
          title="Skills (Meeting Plan)"
          sub={`${skills.length} skills · drives teacher matching on the Meeting Plan · "Older scout may teach" is the per-skill authorization scope — First Aid, Woods Tools, Fire Safety, and Aquatics stay adults-only per the Guide to Safe Scouting`}
        >
          <SkillsEditor
            rows={skills}
            onCreate={createSkill}
            onUpdate={updateSkill}
            onDelete={deleteSkill}
          />
        </Card>
      </div>

      <div className={styles.grid}>
        <Card
          title="Leader Skills"
          sub="What each ADULT can teach — the Meeting Plan matches these to requirement skills when it fills the Teaching slot. Youth-leader initials and record sources are excluded; scouts teach via Scout Instructors instead."
        >
          <SkillAssignEditor
            people={leaderPeople}
            skills={skills.map((s) => ({ id: s.id, name: s.name }))}
            keyField="leader_code"
            noun="Leader"
            onSave={setLeaderSkills}
          />
        </Card>

        <Card
          title="Scout Instructors"
          sub={`${instructorPeople.length} scouts at Star or above · blanket per-skill authorization — only youth-teachable skills can be assigned`}
        >
          <SkillAssignEditor
            people={instructorPeople}
            skills={youthSkills.map((s) => ({ id: s.id, name: s.name }))}
            keyField="scout_id"
            noun="Scout"
            onSave={setScoutInstructorSkills}
          />
        </Card>
      </div>

      <div className={styles.grid}>
        <Card
          title="Tags"
          sub={`${tags.length} tags · the controlled vocabulary scouts pick from when drafting articles`}
        >
          <TagsManager tags={tags} />
        </Card>
      </div>
    </>
  );
}

// Card = client component with Expand (full-width + all rows); the editors
// window themselves to 15 rows via useLookupTable/LookupCardContext.
const Card = LookupCard;
