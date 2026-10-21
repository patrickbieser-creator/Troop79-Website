import { describe, it, expect } from 'vitest';
import type { AdminActor } from '../src/lib/admin-actor';
import { actorCanEnterAdmin } from '../src/lib/admin-actor';
import { actorIsLibraryLeader } from '../src/lib/library-viewer';
import { CAPABILITIES, holdsLeaderCapability, PLANNER_CAPABILITIES, type Capability } from '../src/lib/capabilities';
import { plannerAccess } from '../src/lib/meeting-planner-access';

/**
 * Meeting Planner II rights (Plans/Meeting-Planner-II.md, Decisions 2–5): three public-only rights. View sees the whole
 * board; edit changes it; seed is the planning team. Email is adults only. None of the three is a leader right: a parent
 * given View must not reach /admin or be treated as a leader by the Library or Menu Monster (tech-lead, 2026-10-21).
 */

const actor = (capabilities: Capability[], subjectKind: 'adult' | 'scout' = 'adult'): AdminActor => ({
  kind: 'identity',
  label: 'Test Person',
  personId: 1,
  capabilities: new Set(capabilities),
  legacyRole: null,
  subjectKind
});

describe('the planner rights exist', () => {
  it('Vocabulary_ListsViewEditAndSeed', () => {
    expect(PLANNER_CAPABILITIES).toEqual(['meeting_planner.view', 'meeting_planner.edit', 'meeting_planner.seed']);
    for (const c of PLANNER_CAPABILITIES) expect(CAPABILITIES).toContain(c);
  });
});

describe('planner rights are not leader rights', () => {
  it('ViewOnlyAdult_CannotEnterAdmin', () => {
    expect(actorCanEnterAdmin(actor(['meeting_planner.view']))).toBe(false);
  });

  it('PlanningTeamAdult_WithOnlyPlannerRights_CannotEnterAdmin', () => {
    expect(actorCanEnterAdmin(actor(['meeting_planner.view', 'meeting_planner.edit', 'meeting_planner.seed']))).toBe(false);
  });

  it('AdultWithAnyLeaderRight_StillEntersAdmin', () => {
    expect(actorCanEnterAdmin(actor(['meeting_planner.view', 'meeting_plan.use']))).toBe(true);
  });

  it('ViewOnlyAdult_IsNotALibraryLeader', () => {
    expect(actorIsLibraryLeader(actor(['meeting_planner.view']))).toBe(false);
  });

  it('LeaderCheck_IgnoresPlannerRights', () => {
    expect(holdsLeaderCapability(new Set<Capability>(['meeting_planner.edit']))).toBe(false);
  });

  it('LeaderCheck_CountsAnyOtherRight', () => {
    expect(holdsLeaderCapability(new Set<Capability>(['news.write']))).toBe(true);
  });
});

describe('plannerAccess', () => {
  it('SignedOut_HasNoAccess', () => {
    expect(plannerAccess(null)).toEqual({ canView: false, canEdit: false, canSeed: false, canEmail: false });
  });

  it('PersonWithNoPlannerRight_CannotView', () => {
    expect(plannerAccess(actor(['news.write'])).canView).toBe(false);
  });

  it('Viewer_CanViewOnly', () => {
    expect(plannerAccess(actor(['meeting_planner.view']))).toEqual({ canView: true, canEdit: false, canSeed: false, canEmail: false });
  });

  it('AdultEditor_CanEditAndEmail', () => {
    expect(plannerAccess(actor(['meeting_planner.edit']))).toEqual({ canView: true, canEdit: true, canSeed: false, canEmail: true });
  });

  it('ScoutEditor_TheSpl_CanEditButNeverEmail', () => {
    expect(plannerAccess(actor(['meeting_planner.edit'], 'scout'))).toEqual({ canView: true, canEdit: true, canSeed: false, canEmail: false });
  });

  it('Seeder_CanViewAndSeed', () => {
    const a = plannerAccess(actor(['meeting_planner.seed']));
    expect([a.canView, a.canSeed, a.canEdit]).toEqual([true, true, false]);
  });
});
