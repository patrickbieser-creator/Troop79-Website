/**
 * /admin/advancement/meeting-plan — retired (Build a Plan B4, Decision 3). Admin's generator (Generate Plan / Group
 * Sessions) and Publish to Site are gone: Build a Plan is the plan of record and its Suggested column is the
 * generator, so old links and bookmarks land there. By Scout and Teaching Roster live on at ./by-scout.
 */
import { redirect } from 'next/navigation';

export default function MeetingPlanPage() {
  redirect('/planner/build');
}
