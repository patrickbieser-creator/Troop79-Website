/**
 * /admin/newsletter — keep the troop's EmailOctopus list in step with People
 * (Patrick, 2026-10-20). roster.manage.
 *
 * The page shows what a sync would change (reading EmailOctopus and People,
 * writing nothing); Sync now applies it. Every active person's every address
 * is added, names follow People, and unsubscribes in EmailOctopus are recorded
 * here so no sync ever re-adds them.
 */
import { requireCapability } from '@/lib/require-capability';
import { PageTitle } from '../_components/page-title';
import { previewNewsletterSync, runNewsletterSyncAction } from './actions';
import { NewsletterSyncView } from './newsletter-sync-view';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'EmailOctopus Sync — Troop 79'
};

export default async function NewsletterPage() {
  await requireCapability('roster.manage');
  const preview = await previewNewsletterSync();

  return (
    <>
      <PageTitle
        back={null}
        title="EmailOctopus Sync"
        sub="Adds everyone active in People to the troop's EmailOctopus list, keeps their names current, and records anyone who unsubscribed there so they're never added back."
      />
      <NewsletterSyncView preview={preview} syncAction={runNewsletterSyncAction} />
    </>
  );
}
