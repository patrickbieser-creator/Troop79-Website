/**
 * /admin/pins — Edit pins (Plans/Admin-Portal-Nav.md phase 3): reorder, remove or add the items pinned in the rail.
 * Opened from the rail's "Edit pins". Pins are personal, so a session with no person id gets a note instead.
 */
import { redirect } from 'next/navigation';
import { resolveAdminActor } from '@/lib/admin-actor';
import { createAdminClient } from '@/lib/supabase/server';
import { PageTitle } from '../_components/page-title';
import { Notice } from '../_components/notice';
import { visibleFeaturesFor } from '../_components/nav-visibility';
import { loadPinKeys, MAX_PINS } from '../_components/pins-store';
import { PinsEditor } from './pins-editor';

export const metadata = { title: 'Edit pins — Troop 79' };

export default async function EditPinsPage() {
  const actor = await resolveAdminActor();
  if (!actor) redirect('/admin/login');
  const back = { label: 'Home', href: '/admin' };
  if (actor.personId == null) {
    return (
      <>
        <PageTitle back={back} title="Edit pins" />
        <Notice variant="info">Pins are kept per person. Sign in with your own email to pin items.</Notice>
      </>
    );
  }
  const [visible, keys] = await Promise.all([visibleFeaturesFor(actor), loadPinKeys(createAdminClient(), actor.personId)]);
  const options = visible
    .filter((f) => f.key !== 'home')
    .map((f) => ({ key: f.key, label: f.label }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const byKey = new Map(options.map((o) => [o.key, o]));
  const saved = keys.flatMap((k) => (byKey.has(k) ? [byKey.get(k)!] : []));
  return (
    <>
      <PageTitle back={back} title="Edit pins" sub="Your pinned items sit in the rail under Pinned and lead your shortcuts on Home." />
      <PinsEditor saved={saved} options={options} max={MAX_PINS} />
    </>
  );
}
