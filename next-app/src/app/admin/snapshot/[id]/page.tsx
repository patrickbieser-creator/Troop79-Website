import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { parseRosterOrder } from '@/lib/event-snapshot';
import { SnapshotDocument } from './snapshot-document';
// OUTSIDE the (workspace) route group, like /admin/roster-print: there is no
// admin chrome to hide on paper because the page IS the document. The token
// sheet still has to be loaded here; access is decided in snapshot-document.tsx
// (loadSnapshot → requireCapability). Reached from the workspace snapshot page's
// Print button (Patrick, 2026-08-22: printing is "one final step", not the tab).
import '../../(workspace)/admin.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Event Snapshot — Troop 79',
  robots: { index: false, follow: false }
};

export default async function SnapshotPrintPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ order?: string }>;
}) {
  const { id } = await params;
  const signupId = Number(id);
  if (!Number.isInteger(signupId) || signupId < 1) notFound();
  const order = parseRosterOrder((await searchParams).order);
  return <SnapshotDocument signupId={signupId} order={order} printView />;
}
