'use server';

/**
 * EmailOctopus sync (lib/newsletter-sync.ts). Loading the preview only reads
 * both sides; Sync re-plans server-side and applies: adds, name updates, and
 * unsubscribes recorded in person_emails. It never changes a contact's status,
 * so it can't resubscribe anyone. roster.manage, the same as the Roster.
 */
import { revalidatePath } from 'next/cache';
import { requireCapability } from '@/lib/require-capability';
import { createAdminClient } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { EmailOctopusClient, EmailOctopusError, emailOctopusConfig } from '@/lib/emailoctopus';
import { planNewsletterSync, type SyncPlan } from '@/lib/newsletter-sync';
import { loadSyncAddresses, markAddressesUnsubscribed } from '@/lib/newsletter-sync-db';

export type NewsletterPreview = { ok: true; plan: SyncPlan; listSize: number } | { ok: false; error: string };
export type NewsletterSyncResult =
  | { ok: true; added: number; renamed: number; unsubscribed: number; failures: string[] }
  | { ok: false; error: string };

const NOT_SET_UP = 'EmailOctopus isn’t connected yet: EMAILOCTOPUS_API_KEY and EMAILOCTOPUS_LIST_ID need to be set.';

async function planNow(): Promise<{ ok: true; plan: SyncPlan; listSize: number; client: EmailOctopusClient } | { ok: false; error: string }> {
  const config = emailOctopusConfig();
  if (!config) return { ok: false, error: NOT_SET_UP };
  const client = new EmailOctopusClient(config.apiKey, config.listId);
  try {
    const [contacts, { addresses, unsubscribedHere }] = await Promise.all([client.listContacts(), loadSyncAddresses(createAdminClient())]);
    return { ok: true, plan: planNewsletterSync(addresses, contacts, unsubscribedHere), listSize: contacts.length, client };
  } catch (e) {
    if (e instanceof EmailOctopusError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function previewNewsletterSync(): Promise<NewsletterPreview> {
  await requireCapability('roster.manage');
  const p = await planNow();
  return p.ok ? { ok: true, plan: p.plan, listSize: p.listSize } : p;
}

export async function runNewsletterSyncAction(): Promise<NewsletterSyncResult> {
  await requireCapability('roster.manage');
  const p = await planNow();
  if (!p.ok) return p;
  const { plan, client } = p;
  const failures: string[] = [];
  let added = 0;
  let renamed = 0;

  // One at a time: well inside the API's 10-a-second rate, and one bad address doesn't stop the rest.
  for (const a of plan.add) {
    try {
      await client.createContact(a.email, a.firstName, a.lastName);
      added++;
    } catch (e) {
      failures.push(`${a.email}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  for (const r of plan.rename) {
    try {
      await client.renameContact(r.contactId, r.firstName, r.lastName);
      renamed++;
    } catch (e) {
      failures.push(`${r.email}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const unsubscribed = await markAddressesUnsubscribed(createAdminClient(), plan.markUnsubscribed, new Date().toISOString());

  await recordAudit({
    area: 'roster',
    action: 'update',
    entityType: 'newsletter_sync',
    summary: `EmailOctopus sync: ${added} added, ${renamed} names updated, ${plan.markUnsubscribed.length} unsubscribes recorded${failures.length ? `, ${failures.length} failed` : ''}`,
    details: { added, renamed, unsubscribed: plan.markUnsubscribed, failures }
  });
  revalidatePath('/admin/newsletter');
  return { ok: true, added, renamed, unsubscribed, failures };
}
