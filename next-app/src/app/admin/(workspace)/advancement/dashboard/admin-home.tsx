/**
 * Home (/admin) - "Needs you today" for every leader (filtered to what they can open), then the card grid, one tinted
 * group per section. The advancement overview is no longer rendered here: it is the Dashboard card, first in the
 * Advancement group, on its own page (./advancement-overview, /admin/advancement/dashboard).
 */

import { createAdminClient } from '@/lib/supabase/server';
import { resolveAdminActor } from '@/lib/admin-actor';
import { loadAttentionCategories } from './attention-items';
import { PageTitle } from '../../_components/page-title';
import { AttentionInbox } from '../../_components/attention-inbox';
import { AdminHub } from '../../_components/admin-hub';
import { SECTIONS, visibleNavSections, hubGroups, isFullAdmin } from '../../_components/nav-data';
import { loadWreathSaleOpen } from '@/lib/wreaths/admin-data';
import { SuggestionButton } from './suggestion-button';
import { loadSuggestionActor, sendSuggestionAction } from './suggestion-actions';

export async function AdminHome() {
  const actor = await resolveAdminActor();
  if (!actor) throw new Error('Not authenticated');
  const visible = visibleNavSections(SECTIONS, {
    fullAdmin: isFullAdmin(actor),
    capabilities: actor.capabilities
  });
  // The Wreath Sale card orders by season; only a treasurer sees the card, so only they pay for the (one small) select.
  const wreathCardVisible = visible.some((s) => s.items.some((i) => i.seasonal));
  const [rows, suggestionActor, wreathOpen] = await Promise.all([
    loadAttentionCategories(actor.capabilities),
    loadSuggestionActor(),
    wreathCardVisible ? loadWreathSaleOpen(createAdminClient()) : Promise.resolve(false)
  ]);
  const groups = hubGroups(visible, { wreathOpen });

  return (
    <>
      <PageTitle back={null}
        title="Home"
        sub="What needs you today, then the troop at a glance."
      >
        <SuggestionButton
          actorName={suggestionActor.name}
          actorEmail={suggestionActor.email}
          action={sendSuggestionAction}
        />
      </PageTitle>

      <AttentionInbox rows={rows} />

      <AdminHub groups={groups} />
    </>
  );
}
