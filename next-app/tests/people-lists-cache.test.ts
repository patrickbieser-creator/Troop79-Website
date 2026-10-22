import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { adminClient } from './helpers/admin-client';
import { fetchMeetingLabels, fetchPeopleLists } from '../src/lib/people-lists';

/**
 * The Meeting Planner's slow-changing lists (perf, 2026-10-22): active scouts, the teacher pool's directory rows, leader
 * ids (tag `people-lists`) and the meeting categories (tag `meeting-categories`) sit behind unstable_cache with an
 * hourly fallback. Every app writer of what they hold must expire the tag, or the planner shows a stale roster (a scout's
 * rank moves with the ledger, through the rank triggers, so ledger writers count too). Picks, answers, teachers and
 * ledger progress are never cached, and nothing derived from the match (D-426).
 */
const SRC = join(__dirname, '..', 'src');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
function body(src: string, name: string): string {
  const m = new RegExp(`(?:export )?(?:async )?function ${name}\\b`).exec(src);
  if (!m) return '';
  const rest = src.slice(m.index + 1);
  const next = rest.search(/\n(?:export )?(?:async )?function |\nexport const /);
  return src.slice(m.index, next === -1 ? undefined : m.index + 1 + next);
}
const missing = (rel: string, fns: string[], call: string) => fns.filter((fn) => !body(read(rel), fn).includes(call));

const PEOPLE_WRITERS: [string, string[]][] = [
  ['app/admin/(workspace)/advancement/lookups/actions.ts', ['createScout', 'updateScout', 'updateScoutIdentity', 'updateScoutFields', 'updateMeritBadge', 'promoteScoutToAdult', 'updateReqCode']],
  ['app/admin/(workspace)/advancement/roster/person-actions.ts', ['createPerson', 'addRole', 'endRole', 'deleteRole', 'setPersonActive', 'createAdultForScout', 'deletePerson', 'mergePersonInto']],
  ['app/admin/(workspace)/advancement/roster/change-request-actions.ts', ['approveChangeRequest']],
  ['app/admin/(workspace)/advancement/roster/guest-actions.ts', ['forgetGuest', 'promoteGuest']],
  ['app/admin/(workspace)/advancement/roster/patrols/actions.ts', ['savePatrolAssignments']],
  ['app/admin/(workspace)/advancement/roster/[personId]/scout-status-actions.ts', ['setScoutActive']],
  ['app/(public)/profile/actions.ts', ['addHouseholdMemberAction']],
  ['app/(public)/events/[id]/actions.ts', ['submitSignupAction']],
  ['lib/write-person-demographics.ts', ['writePersonDemographics']],
  ['lib/teaching-skills.ts', ['saveTeachingSkills', 'undoTeachingSkillChange']],
  ['lib/bsa-roster-db.ts', ['saveRegistrations']],
  // Ledger writers: current_rank follows the ledger (trg_refresh_scout_rank, the auto rank-award triggers).
  ['app/admin/(workspace)/advancement/audits/actions.ts', ['fillMissingRankRequirements', 'resolveDuplicateLedgerEntries', 'retireOrphanedCredit', 'resolveQtyMismatch', 'resolveDateDrift']],
  ['app/admin/(workspace)/advancement/fast-entry/actions.ts', ['addLedgerEntries', 'undoCompletion']],
  [
    'app/admin/(workspace)/advancement/ledger/actions.ts',
    ['archiveLedgerEntry', 'softDeleteLedgerEntry', 'updateLedgerEntry', 'bulkUpdateLedgerEntries', 'bulkArchiveLedgerEntries', 'bulkDeleteLedgerEntries', 'restoreLedgerEntry', 'setScoutbookSubmitted', 'setPresented', 'bulkSetScoutbookSubmitted']
  ],
  ['lib/attendance-admin.ts', ['syncCredit', 'retireCredit', 'adoptLegacyCredit']],
  ['lib/calendar-admin.ts', ['executeCalendarEntryMerge']],
  ['lib/court-of-honor.ts', ['markItemsPresented']],
  ['lib/library-data.ts', ['approveSubmission']]
];

describe('the planner lists cache', () => {
  it('PeopleLists_AreTagCached_WithAnHourlyFallback', () => {
    expect(read('lib/people-lists.ts')).toMatch(/unstable_cache\([\s\S]*tags: \[PEOPLE_LISTS_TAG\], revalidate: 3600/);
  });

  it('MeetingCategories_AreTagCached_WithAnHourlyFallback', () => {
    expect(read('lib/people-lists.ts')).toMatch(/unstable_cache\([\s\S]*tags: \[MEETING_CATEGORIES_TAG\], revalidate: 3600/);
  });

  it('CachedValues_AreJsonOnly', async () => {
    const sb = adminClient();
    const lists = { people: await fetchPeopleLists(sb), labels: await fetchMeetingLabels(sb) };
    expect(JSON.parse(JSON.stringify(lists))).toEqual(lists);
  });

  it('ThePlannerReadsTheCachedLists', () => {
    const uses = ['app/(public)/planner/page.tsx', 'app/(public)/planner/actions.ts'].filter((f) => !read(f).includes('loadPlannerLists()'));
    expect(uses).toEqual([]);
  });

  it.each(PEOPLE_WRITERS)('Writers_ExpireThePeopleLists: %s', (rel, fns) => {
    expect(missing(rel, fns, 'expirePeopleLists()')).toEqual([]);
  });

  it('CalendarCategoryWriters_ExpireTheMeetingCategories', () => {
    expect(missing('app/admin/(workspace)/advancement/lookups/actions.ts', ['createCalendarCategory', 'updateCalendarCategory', 'deleteCalendarCategory'], 'expireMeetingCategories()')).toEqual([]);
  });
});
