/**
 * What the registry needs to know about a person to decide what they may open (visibleFeatures). One place, so the
 * rail, Home, search and A–Z can never disagree about who sees what. Server only (reads the health viewers list).
 */
import type { AdminActor } from '@/lib/admin-actor';
import { adminIsHealthViewer } from '@/lib/health-access';
import { plannerAccess } from '@/lib/meeting-planner-access';
import { CAPABILITIES, type Capability } from '@/lib/capabilities';
import { FEATURES, visibleFeatures, type Feature, type VisibilityOpts } from './feature-registry';

/** A legacy password session, or an identity actor holding every capability. */
export function isFullAdmin(actor: { legacyRole: unknown; capabilities: ReadonlySet<Capability> }): boolean {
  return actor.legacyRole !== null || CAPABILITIES.every((c) => actor.capabilities.has(c));
}

export async function navVisibility(actor: AdminActor): Promise<VisibilityOpts> {
  return {
    fullAdmin: isFullAdmin(actor),
    capabilities: actor.capabilities,
    // The workspace must render even if the health list can't be read: the Health items just stay hidden.
    healthViewer: await adminIsHealthViewer(actor).catch(() => false),
    plannerView: plannerAccess(actor).canView
  };
}

export async function visibleFeaturesFor(actor: AdminActor): Promise<Feature[]> {
  return visibleFeatures(FEATURES, await navVisibility(actor));
}
