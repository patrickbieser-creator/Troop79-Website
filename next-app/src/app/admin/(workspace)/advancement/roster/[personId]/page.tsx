/**
 * /admin/advancement/roster/[personId] — one person's record page
 * (Plans/Person-Editor-Rethink.md, Direction A: read-only record, scoped
 * per-section Edit). One dynamic route for scouts, leaders and adults; the
 * loader decides the kind and the shell picks the sections.
 *
 * Phase 1 ships the shell and Status parity — the Marita bug. Section forms,
 * the immediate blocks, History, pending banners and the retirement of the
 * old dialog editors follow in later phases; until then the roster rows
 * still open the old editors, and only `?open=` deep links land here.
 *
 * LEADER-ONLY, same gate as the roster (D-037).
 */

import { notFound, redirect } from 'next/navigation';
import { resolveAdminActor } from '@/lib/admin-actor';
import { createAdminClient } from '@/lib/supabase/server';
import { isRosterTab, loadPersonRecord } from './load-person-record';
import { PersonRecord } from './person-record';
import styles from '../roster.module.css';

type Params = Promise<{ personId: string }>;
type Search = Promise<{ from?: string }>;

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function generateMetadata({ params }: { params: Params }) {
  const { personId } = await params;
  const id = parseId(personId);
  if (id == null) return { title: 'Roster — Troop 79' };
  const { data } = await createAdminClient().from('people').select('display_name').eq('id', id).maybeSingle();
  const name = (data as { display_name: string } | null)?.display_name;
  return { title: name ? `${name} · Roster — Troop 79` : 'Roster — Troop 79' };
}

export default async function PersonRecordPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const actor = await resolveAdminActor();
  if (!actor?.capabilities.has('roster.manage')) {
    return <div className={styles.gate}>The roster is available to adult leaders only.</div>;
  }

  const [{ personId: raw }, { from }] = await Promise.all([params, searchParams]);
  const id = parseId(raw);
  if (id == null) notFound();

  const res = await loadPersonRecord(id);
  if (res.kind === 'missing') notFound();
  if (res.kind === 'merged') {
    redirect(`/admin/advancement/roster/${res.survivorId}${isRosterTab(from) ? `?from=${from}` : ''}`);
  }

  return <PersonRecord record={res.record} from={isRosterTab(from) ? from : res.record.tab} />;
}
