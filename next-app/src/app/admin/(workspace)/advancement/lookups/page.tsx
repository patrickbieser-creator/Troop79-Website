/**
 * /admin/advancement/lookups — Reference tables and site settings. Since 2026-10-28 (Patrick: too many cards to
 * scroll) the bare path is a landing page of grouped links (lookup-cards.ts) that reads no table; ?card=<id> opens one
 * card on its own, expanded, under "← Back to Lookups & Admin", reading only what that card needs. Every editor's
 * revalidatePath('/admin/advancement/lookups') still refreshes the open card: the query keeps one path.
 *
 * Scouts and adults are NOT here — they moved to /admin/advancement/roster in v1.12. The catalog and teaching cards
 * still READ both tables to populate the merit-badge counselor and Meeting Plan skill-assignment pickers.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { requireCapability } from '@/lib/require-capability';
// Scout and adult MANAGEMENT moved to /admin/advancement/roster in v1.12 —
// this page still READS both to build the merit-badge counselor and skill
// assignment pickers, so the row types come from there.
/**
 * The `leaders` row shape this page actually reads — just enough for the
 * counselor and skill-assignment pickers below, not the full leader
 * demographic shape (that lived on the now-deleted roster/leader-form.tsx;
 * editing an adult's demographics moved to the Roster's PersonEditor on the
 * `people` spine, 2026-08-17 — see change-requests.ts's LEADER_PERSON_FIELDS).
 * `person_id` replaces the retired `scout_id` for telling a youth leader from
 * an adult (Plans/Retire-Roster-Contact-Columns.md).
 */
interface LeaderRow {
  code: string;
  name: string;
  role: string | null;
  is_person: boolean;
  person_id: number | null;
}
/** Just enough of a scout to place them in the Meeting Plan's Scout
 *  Instructors picker — none of a scout's contact/demographic fields, which
 *  this page has no use for. */
interface LookupScoutRow {
  id: string;
  display_name: string;
  current_rank: string | null;
  active: boolean;
  person_id: number | null;
  graduation_year: number | null;
  junior_leader_override: 'yes' | 'no' | null;
}
import { MbEditor, type MbRow, type CounselorRow, type CounselorCandidate, type EditReqNode } from './mb-editor';
import { canOfferToTeach } from '@/lib/can-offer-to-teach';
import { centralToday } from '@/lib/dates';
import { NameLookupEditor, type NameRow } from './name-lookup-editor';
import { EventEditor, type EventRow } from './event-editor';
import { ReqCodesTable, type ReqRow } from './req-codes-table';
import { LookupCard } from './lookup-card';
import { LOOKUPS_PATH, findLookupCard, lookupCardHref, visibleLookupGroups } from './lookup-cards';
import { HouseholdsManager, type HouseholdMemberRow, type HouseholdRow } from './households-manager';
import { SkillsEditor, type SkillRow } from './skills-editor';
import { RequirementClassesEditor, type RequirementClassRow } from './requirement-classes-editor';
import { effectiveClasses } from '@/lib/requirement-class';
import { SkillAssignEditor } from './skill-assign-editor';
import { buildTeachingRows, collectTeachingAdults, type TeachingScout } from './teaching-rows';
import { TeachingChanges } from './teaching-changes';
import { loadTeachingSkillChanges } from '@/lib/teaching-skills';
import { CategoriesEditor } from './categories-editor';
import { StoresEditor } from './stores-editor';
import { ArticleTokensEditor } from './article-tokens-editor';
import { SiteTextEditor } from './site-text-editor';
import { SeoEditor } from './seo-editor';
import { EmailTemplatesEditor } from './email-templates-editor';
import {
  createEmailTemplate,
  updateEmailTemplate,
  retireEmailTemplate,
  restoreEmailTemplate,
  loadEmailTemplates
} from './email-template-actions';
import { samplePreviewContext } from '@/lib/signup-confirmation-preview';
import { siteUrl } from '@/lib/site-url';
import { loadSiteText, SITE_TEXT_KEYS, type SiteTextKey } from '@/lib/site-text';
import { SEO_KEYS, type SeoSettingKey } from '@/lib/seo';
import { loadArticleTokens } from '@/lib/article-tokens-server';
import { loadCalendarCategories } from '@/lib/calendar';
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
  setTeachingSkills,
  undoTeachingSkillChangeAction,
  markTeachingSkillChangeReviewedAction,
  createCalendarCategory,
  updateCalendarCategory,
  deleteCalendarCategory,
  saveArticleTokens,
  saveSiteText,
  saveSeoSettings
} from './actions';
import { createStore, renameStore, retireStore, restoreStore, deleteStore, moveStore } from './store-actions';
import { listStoresWith } from '@/lib/menu-monster/stores';
import { PageTitle } from '../../_components/page-title';
import { AdminHub } from '../../_components/admin-hub';

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
    officialTextRes
  ] = await Promise.all([
    supabase.from('leaders').select('code, name, role, is_person, person_id').order('code'),
    supabase
      .from('scouts')
      .select('id, display_name, current_rank, active, person_id, graduation_year, junior_leader_override')
      .order('display_name'),
    supabase
      .from('merit_badges')
      .select('id, name, eagle, scoutbook_id, bsa_page_url, workbook_url')
      .order('name'),
    supabase
      .from('merit_badge_counselors')
      .select('mb_id, person_id, leader_code, sort_order')
      .order('mb_id')
      .order('sort_order'),
    supabase.from('ranks').select('id, display_name, sort_order').order('sort_order'),
    // ALL depths (not just top-level) — rank_requirements nests up to one
    // level (e.g. Tenderfoot 4a under 4) and there's no separate nested-tree
    // editor for ranks, so this flat table is the only place to reach them.
    supabase
      .from('rank_requirements')
      .select('id, rank_id, parent_id, code, label, teach_minutes, class_codes')
      .order('rank_id')
      .order('code'),
    supabase
      .from('merit_badge_requirements')
      .select('id, mb_id, code, label, teach_minutes, class_codes')
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
    // Verbatim official BSA text, keyed by (source, parent_id, code) — see
    // the requirement_official_text migration for why not a bigserial FK.
    // Small today (ranks only), but paginate defensively per the PostgREST
    // 1,000-row cap lesson (D-028) in case merit badge text is added later.
    fetchAllRows<{ source: 'rank' | 'mb'; parent_id: string; code: string; official_text: string }>(
      (from, to) =>
        supabase
          .from('requirement_official_text')
          .select('source, parent_id, code, official_text')
          .order('id').range(from, to)
    )
  ]);

  const [
    skillsRes,
    classesRes,
    taggedMbReqs,
    teachingSkillsRes,
    adultDirectory,
    householdsRes,
    hhMembersRes
  ] = await Promise.all([
    supabase.from('skills').select('id, name, youth_teachable, sort_order').order('sort_order'),
    supabase.from('requirement_classes').select('code, name, description, sort_order, retired_at').order('sort_order'),
    // Every tagged requirement at every depth (untagged rows are most of them; only the tagged ones count usage).
    fetchAllRows<{ class_codes: string[] }>((from, to) =>
      supabase.from('merit_badge_requirements').select('class_codes').neq('class_codes', '{}').order('id').range(from, to)
    ),
    supabase.from('teaching_skills').select('person_id, skill_id'),
    // The Adult Skills pool: every adult the person picker offers, leaders and parents alike (the planner's teacher
    // pool reads the same rows, lib/people-lists).
    fetchAllRows<{ person_id: number; display_name: string; tab: string; in_picker: boolean }>((from, to) =>
      supabase.from('person_directory').select('person_id, display_name, tab, in_picker').in('tab', ['leader', 'adult']).order('person_id').range(from, to)
    ),
    supabase.from('households').select('id, label').is('system_key', null).order('label'),
    // Members carried through so each household can be told apart by WHO is
    // in it. Two families sharing a surname is normal — the troop has two
    // Stollenwerk households — and the label alone cannot distinguish them.
    supabase
      .from('household_members')
      .select('household_id, person_id, people!inner(display_name, merged_into_person_id)')
  ]);

  const memberRows = new Map<number, HouseholdMemberRow[]>();
  for (const m of (hhMembersRes.data ?? []) as unknown as {
    household_id: number;
    person_id: number;
    people: { display_name: string; merged_into_person_id: number | null } | null;
  }[]) {
    if (!m.people || m.people.merged_into_person_id !== null) continue;
    memberRows.set(m.household_id, [
      ...(memberRows.get(m.household_id) ?? []),
      { personId: m.person_id, name: m.people.display_name }
    ]);
  }
  const householdRows: HouseholdRow[] = ((householdsRes.data ?? []) as { id: number; label: string }[])
    .map((h) => ({
      id: h.id,
      label: h.label,
      members: (memberRows.get(h.id) ?? []).sort((a, b) => a.name.localeCompare(b.name))
    }));

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

  const officialTextByKey = new Map<string, string>();
  for (const t of officialTextRes as {
    source: 'rank' | 'mb';
    parent_id: string;
    code: string;
    official_text: string;
  }[]) {
    officialTextByKey.set(`${t.source}:${t.parent_id}:${t.code}`, t.official_text);
  }

  type RankReqFull = { id: number; rank_id: string; parent_id: number | null; code: string; label: string; teach_minutes: number; class_codes: string[] };
  const rankReqRows = (rankReqsRes.data ?? []) as RankReqFull[];
  const rankCodeById = new Map(rankReqRows.map((r) => [r.id, r.code]));
  const rankClassesById = new Map(rankReqRows.map((r) => [r.id, r.class_codes]));
  // Requirement classes (Plans/Requirement-Classification.md) and how many requirements carry each.
  const classUse = new Map<string, number>();
  for (const r of [...rankReqRows, ...taggedMbReqs]) for (const c of r.class_codes) classUse.set(c, (classUse.get(c) ?? 0) + 1);
  const requirementClasses: RequirementClassRow[] = (
    (classesRes.data ?? []) as { code: string; name: string; description: string; sort_order: number; retired_at: string | null }[]
  ).map((c) => ({ code: c.code, name: c.name, description: c.description, sortOrder: c.sort_order, retired: c.retired_at != null, usedBy: classUse.get(c.code) ?? 0 }));
  // T-3: a requirement with sub-requirements takes the sum of theirs.
  const partsMinutes = new Map<number, number>();
  for (const r of rankReqRows) if (r.parent_id !== null) partsMinutes.set(r.parent_id, (partsMinutes.get(r.parent_id) ?? 0) + r.teach_minutes);

  const reqs: ReqRow[] = [
    ...rankReqRows.map((r) => ({
      id: r.id,
      source: 'rank' as const,
      parentId: r.rank_id,
      parentLabel: rankLabels.get(r.rank_id) ?? r.rank_id,
      code: r.code,
      label: r.label,
      nestedUnder: r.parent_id !== null ? (rankCodeById.get(r.parent_id) ?? null) : null,
      officialText: officialTextByKey.get(`rank:${r.rank_id}:${r.code}`) ?? '',
      minutes: r.teach_minutes,
      partsMinutes: partsMinutes.get(r.id) ?? null,
      classCodes: r.class_codes,
      effectiveClasses: effectiveClasses(r.class_codes, r.parent_id !== null ? rankClassesById.get(r.parent_id) : undefined)
    })),
    ...((mbReqsRes.data ?? []) as { id: number; mb_id: string; code: string; label: string; teach_minutes: number; class_codes: string[] }[]).map(
      (r) => ({
        id: r.id,
        source: 'mb' as const,
        parentId: r.mb_id,
        parentLabel: mbLabels.get(r.mb_id) ?? r.mb_id,
        code: r.code,
        label: r.label,
        nestedUnder: null,
        officialText: officialTextByKey.get(`mb:${r.mb_id}:${r.code}`) ?? '',
        minutes: r.teach_minutes,
        partsMinutes: null,
        classCodes: r.class_codes,
        effectiveClasses: effectiveClasses(r.class_codes)
      })
    )
  ];

  // Skills + assignments (Meeting Plan)
  const skills = (skillsRes.data ?? []) as SkillRow[];
  // Teaching skills are keyed to people (Phase 0a): adults, parents with no leader code, and scouts alike.
  const skillIdsByPerson = new Map<number, string[]>();
  for (const ts of (teachingSkillsRes.data ?? []) as { person_id: number; skill_id: string }[]) {
    skillIdsByPerson.set(ts.person_id, [...(skillIdsByPerson.get(ts.person_id) ?? []), ts.skill_id]);
  }
  // Names for people who teach or counsel without a leader row (parents).
  const leaderPersonIds = new Set(((leadersRes.data ?? []) as LeaderRow[]).map((l) => l.person_id).filter((id): id is number => id != null));
  const scoutPersonIds = new Set(((scoutsRes.data ?? []) as LookupScoutRow[]).map((sc) => sc.person_id).filter((id): id is number => id != null));
  const extraIds = [...new Set([...skillIdsByPerson.keys(), ...((counselorsRes.data ?? []) as CounselorRow[]).map((c) => c.person_id)])].filter(
    (id): id is number => id != null && !leaderPersonIds.has(id) && !scoutPersonIds.has(id)
  );
  // A merged-away person can't be written (set_teaching_skills refuses), so they never get a row here.
  const { data: extraPeople } = extraIds.length
    ? await supabase.from('people').select('id, display_name').in('id', extraIds).is('merged_into_person_id', null)
    : { data: [] };

  return {
    leaders: (leadersRes.data ?? []) as LeaderRow[],
    scouts: (scoutsRes.data ?? []) as LookupScoutRow[],
    mbs,
    counselorsByMb,
    mbReqTrees,
    ranks: ranks.map((r) => ({ id: r.id, display_name: r.display_name })),
    ranksFull: ranks,
    reqs,
    requirementClasses,
    events: (eventsRes.data ?? []) as EventRow[],
    serviceProjects: (serviceProjectsRes.data ?? []) as NameRow[],
    leadershipPositions: (leadershipPositionsRes.data ?? []) as NameRow[],
    skills,
    skillIdsByPerson,
    otherTeachers: ((extraPeople ?? []) as { id: number; display_name: string }[]).map((p) => ({ personId: p.id, name: p.display_name })),
    adultDirectory,
    householdRows
  };
}

export default async function LookupsPage({ searchParams }: { searchParams: Promise<{ card?: string }> }) {
  const actor = await requireCapability('roster.manage');
  // The store list is Menu Monster content: its card (and read) is for people
  // who may moderate the Library, the capability its actions check.
  const canEditStores = actor.capabilities.has('library.moderate');
  const id = (await searchParams).card;

  // Landing (Patrick, 2026-10-28): grouped links; no table is read until a card is opened.
  if (!id) {
    return (
      <>
        <PageTitle
          back={null}
          title="Lookups & Admin"
          sub={
            <>
              The editable Troop 79 taxonomy and site settings. Scouts and adults are managed on the{' '}
              <Link href="/admin/advancement/roster">Roster</Link>.
            </>
          }
        />
        <AdminHub
          groups={visibleLookupGroups(canEditStores).map((g) => ({
            title: g.title,
            quiet: false,
            tint: g.tint,
            cards: g.cards.map((c) => ({ key: c.id, title: c.title, description: c.blurb, href: lookupCardHref(c.id) }))
          }))}
        />
      </>
    );
  }

  const def = findLookupCard(id, canEditStores);
  if (!def) notFound();
  const { sub, body } = await cardContent(def.id);
  return (
    <>
      <PageTitle back={{ label: 'Back to Lookups & Admin', href: LOOKUPS_PATH }} title={def.title} sub={sub} />
      <LookupCard title={def.title} single>
        {body}
      </LookupCard>
    </>
  );
}

/** One card's line and editor, reading only what that card needs. */
async function cardContent(id: string): Promise<{ sub: string; body: React.ReactNode }> {
  switch (id) {
    case 'teaching-changes': {
      const adminSb = createAdminClient();
      const [changesToReview, changesAll] = await Promise.all([
        loadTeachingSkillChanges(adminSb, { filter: 'review' }),
        loadTeachingSkillChanges(adminSb, { filter: 'all' })
      ]);
      return {
        sub: 'Adults and Junior Leaders set what they can teach on the member page; it counts right away and nothing waits for approval. Undo reverses a change (and is logged). Mark reviewed clears it from the admin-home count.',
        body: (
          <TeachingChanges
            toReview={changesToReview}
            all={changesAll}
            onUndo={undoTeachingSkillChangeAction}
            onMarkReviewed={markTeachingSkillChangeReviewedAction}
          />
        )
      };
    }
    case 'categories': {
      const calendarCategories = await loadCalendarCategories();
      return {
        sub: `${calendarCategories.length} categories · the ONE taxonomy — every event, photo album AND news story picks from this list (tags merged in, 2026-08-21) · renaming one updates everything that used it · a category in use can't be deleted · each has a public page at /category/<slug>`,
        body: (
          <CategoriesEditor
            rows={calendarCategories}
            onCreate={createCalendarCategory}
            onUpdate={updateCalendarCategory}
            onDelete={deleteCalendarCategory}
          />
        )
      };
    }
    case 'article-typography':
      return {
        sub: 'how markdown stories are set — news posts, event write-ups and library narratives share it · blank means the built-in default · values only, so a typo can’t break the page',
        body: <ArticleTokensEditor values={await loadArticleTokens()} onSave={saveArticleTokens} />
      };
    case 'event-reminder':
    case 'search-visibility': {
      const siteTextMap = await loadSiteText(createAdminClient());
      if (id === 'event-reminder') {
        const siteText: Partial<Record<SiteTextKey, string>> = {};
        for (const def of SITE_TEXT_KEYS) {
          const v = siteTextMap.get(def.key);
          if (v) siteText[def.key] = v;
        }
        return {
          sub: 'the follow-up sent from an event roster’s “Chase the non-responders” panel · blank means the built-in wording · {title} and {deadline} are filled when it’s sent',
          body: <SiteTextEditor values={siteText} onSave={saveSiteText} />
        };
      }
      // seo.* keys live in the same site_settings table.
      const seoValues: Partial<Record<SeoSettingKey, string>> = {};
      for (const def of SEO_KEYS) {
        const v = siteTextMap.get(def.key);
        if (v) seoValues[def.key] = v;
      }
      return {
        sub: 'robots.txt, the sitemap, and what search engines and AI assistants are told about the troop · saved changes are live immediately, no deploy',
        body: <SeoEditor values={seoValues} onSave={saveSeoSettings} />
      };
    }
    case 'email-templates':
      return {
        sub: "the library the signup builder's Confirmation email block picks from · grouped by kind · fields in [brackets] fill in when sent · a template in use is retired, not deleted",
        body: (
          <EmailTemplatesEditor
            rows={await loadEmailTemplates()}
            previewCtx={samplePreviewContext(siteUrl())}
            onCreate={createEmailTemplate}
            onUpdate={updateEmailTemplate}
            onRetire={retireEmailTemplate}
            onRestore={restoreEmailTemplate}
          />
        )
      };
    case 'stores': {
      const stores = await listStoresWith(createAdminClient(), { includeRetired: true });
      return {
        sub: `${stores.filter((s) => !s.retiredAt).length} stores · the pull-down on the Menu Monster price book's packages · renaming one updates its packages too`,
        body: (
          <StoresEditor
            rows={stores}
            onCreate={createStore}
            onRename={renameStore}
            onRetire={retireStore}
            onRestore={restoreStore}
            onDelete={deleteStore}
            onMove={moveStore}
          />
        )
      };
    }
  }
  return lookupsCardContent(id, await loadLookups());
}

/** The cards that read the shared lookups load (catalog, pick lists, skills, teaching, households). */
function lookupsCardContent(id: string, l: Awaited<ReturnType<typeof loadLookups>>): { sub: string; body: React.ReactNode } {
  switch (id) {
    case 'merit-badges':
      return {
        sub: `${l.mbs.length} merit badges · BSA Scoutbook IDs for export · assigned counselors`,
        body: <MbEditor rows={l.mbs} leaders={counselorCandidates(l)} counselorsByMb={l.counselorsByMb} reqTreesByMb={l.mbReqTrees} />
      };
    case 'requirement-codes':
      return {
        sub: `${l.reqs.length} top-level codes · renaming a code updates matching ledger entries too · nested sub-requirement trees are edited per-MB in the Merit Badge Catalog`,
        body: <ReqCodesTable rows={l.reqs} classes={l.requirementClasses} />
      };
    case 'requirement-classes':
      return {
        sub: `${l.requirementClasses.length} classes · tag where a requirement can be done, on Internal Requirement Codes · the meeting planner suggests what a meeting can hold (M, or untagged)`,
        body: <RequirementClassesEditor rows={l.requirementClasses} />
      };
    case 'events':
      return {
        sub: `${l.events.length} events · each classified as a Campout, Hike, Day Outing, or Fundraiser so Fast Entry never has to ask twice · drives the Events tab pull-down · not a foreign key, so removing one only affects the picker`,
        body: <EventEditor rows={l.events} onCreate={createEvent} onUpdate={updateEvent} onDelete={deleteEvent} />
      };
    case 'service-projects':
      return {
        sub: `${l.serviceProjects.length} projects · drives the Service tab pull-down · hours entered per data-entry`,
        body: (
          <NameLookupEditor
            rows={l.serviceProjects}
            noun="Service Project"
            onCreate={createServiceProject}
            onUpdate={updateServiceProject}
            onDelete={deleteServiceProject}
          />
        )
      };
    case 'leadership-positions':
      return {
        sub: `${l.leadershipPositions.length} positions · drives the Leadership tab pull-down`,
        body: (
          <NameLookupEditor
            rows={l.leadershipPositions}
            noun="Leadership Position"
            onCreate={createLeadershipPosition}
            onUpdate={updateLeadershipPosition}
            onDelete={deleteLeadershipPosition}
          />
        )
      };
    case 'skills':
      return {
        sub: `${l.skills.length} skills · drives teacher matching on the Meeting Plan · "Older scout may teach" is the per-skill authorization scope — First Aid, Woods Tools, Fire Safety, and Aquatics stay adults-only per the Guide to Safe Scouting`,
        body: <SkillsEditor rows={l.skills} onCreate={createSkill} onUpdate={updateSkill} onDelete={deleteSkill} />
      };
    case 'adult-skills': {
      const t = teachingData(l);
      return {
        sub: `${t.adultRows.length} adults who teach, leaders and parents alike — the Meeting Plan matches these to requirement skills when it fills the Teaching slot · Add gives someone a skill, Delete clears all of theirs · scouts teach via Scout Instructors instead`,
        body: (
          <SkillAssignEditor
            people={t.adultRows}
            candidates={t.adultCandidates}
            skills={l.skills.map((s) => ({ id: s.id, name: s.name }))}
            keyField="person_id"
            noun="Adult"
            onSave={setTeachingSkills}
          />
        )
      };
    }
    case 'scout-instructors': {
      const t = teachingData(l);
      return {
        sub: `${t.scoutRows.length} scouts who teach · Add offers anyone First Class or above, or a Junior Leader · blanket per-skill authorization — only youth-teachable skills can be assigned`,
        body: (
          <SkillAssignEditor
            people={t.scoutRows}
            candidates={t.scoutCandidates}
            skills={l.skills.filter((s) => s.youth_teachable).map((s) => ({ id: s.id, name: s.name }))}
            keyField="person_id"
            noun="Scout"
            onSave={setTeachingSkills}
          />
        )
      };
    }
    case 'households':
      return {
        sub: `${l.householdRows.length} households · who belongs to one is set on each person under Roster · two families can share a surname, so name them apart`,
        body: <HouseholdsManager households={l.householdRows} />
      };
  }
  notFound();
}

/** Classify sign-off initials: youth = linked to an ACTIVE scout; aging out (scout inactive) flips them to adult. */
function leaderTypes(l: Awaited<ReturnType<typeof loadLookups>>) {
  const activeScoutPersonIds = new Set(l.scouts.filter((s) => s.active && s.person_id != null).map((s) => s.person_id as number));
  const leaderType = (x: LeaderRow): 'adult' | 'youth' | 'source' =>
    !x.is_person ? 'source' : x.person_id != null && activeScoutPersonIds.has(x.person_id) ? 'youth' : 'adult';
  const adultLeaders = l.leaders.filter((x) => leaderType(x) === 'adult' && x.person_id != null);
  return { activeScoutPersonIds, adultLeaders };
}

function counselorCandidates(l: Awaited<ReturnType<typeof loadLookups>>): CounselorCandidate[] {
  const { adultLeaders } = leaderTypes(l);
  return [
    ...adultLeaders.map((x) => ({ personId: x.person_id as number, name: x.name, code: x.code })),
    ...l.otherTeachers.map((p) => ({ personId: p.personId, name: p.name, code: null })),
    // Non-person sources: Summer Camp stands in for the council camp staff who counsel at camp.
    ...l.leaders.filter((x) => !x.is_person).map((x) => ({ personId: null, name: x.name, code: x.code }))
  ];
}

/**
 * Skill-assignment rows (Meeting Plan), keyed to people; teaching-rows.ts decides who is listed and who Add offers.
 * ADULTS: everyone the person picker offers (leaders and parents) plus adult leaders and anyone else who already
 * teaches or counsels. SCOUTS: Add offers whoever can offer to teach today (First Class+ or Junior Leader); anyone
 * holding a skill is listed.
 */
function teachingData(l: Awaited<ReturnType<typeof loadLookups>>) {
  const { activeScoutPersonIds, adultLeaders } = leaderTypes(l);
  const teachingAdults = collectTeachingAdults({
    directory: l.adultDirectory.map((d) => ({ personId: d.person_id, name: d.display_name, tab: d.tab, inPicker: d.in_picker })),
    adultLeaders: adultLeaders.map((x) => ({ personId: x.person_id as number, name: x.name, role: x.role })),
    otherTeachers: l.otherTeachers,
    formerScouts: l.scouts
      .filter((s) => !s.active && s.person_id != null && l.skillIdsByPerson.has(s.person_id))
      .map((s) => ({ personId: s.person_id as number, name: s.display_name })),
    activeScoutIds: activeScoutPersonIds
  });
  const rankSort = new Map(l.ranksFull.map((r) => [r.id, r.sort_order]));
  const rankName = new Map(l.ranksFull.map((r) => [r.id, r.display_name]));
  const firstClassSort = rankSort.get('first-class') ?? Number.MAX_SAFE_INTEGER;
  const today = centralToday();
  const teachingScouts: TeachingScout[] = l.scouts
    .filter((s) => s.active && s.person_id != null)
    .map((s) => ({
      personId: s.person_id as number,
      name: s.display_name,
      sub: s.current_rank ? (rankName.get(s.current_rank) ?? s.current_rank) : null,
      eligible: canOfferToTeach({
        rankSortOrder: s.current_rank ? (rankSort.get(s.current_rank) ?? null) : null,
        firstClassSortOrder: firstClassSort,
        graduationYear: s.graduation_year,
        override: s.junior_leader_override,
        onDate: today
      })
    }));
  return buildTeachingRows({ adults: teachingAdults, scouts: teachingScouts, skillIdsByPerson: l.skillIdsByPerson });
}
