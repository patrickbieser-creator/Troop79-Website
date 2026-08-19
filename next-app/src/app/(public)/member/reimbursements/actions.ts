'use server';

/**
 * Reimbursement submission + withdrawal (Plans/Troop-Finances.md Phase 4).
 * Any verified t79_identity person may submit on their own behalf — no
 * capability needed, same "own-household actions need no grant" philosophy
 * as event signup submission. Withdrawal is requester-only, not
 * household-scoped: the plan is explicit that only the actual requester can
 * withdraw, even though a parent can SEE their scout's request via the
 * shared household scope.
 */

import { redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { getIdentitySessionIfValid } from '@/lib/family-access';
import { isEpochCurrent } from '@/lib/identity-session';
import { uploadReceiptMedia } from '@/lib/receipt-media';

const PATH = '/member/reimbursements';

function url(params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v != null)) as Record<string, string>
  ).toString();
  return qs ? `${PATH}?${qs}` : PATH;
}

export async function submitReimbursementAction(formData: FormData): Promise<void> {
  const supabase = createAdminClient();
  const session = await getIdentitySessionIfValid();
  if (!session || !(await isEpochCurrent(supabase, session))) {
    redirect(url({ err: 'auth' }));
  }

  const amount = Number(formData.get('amount'));
  const description = String(formData.get('description') ?? '').trim();
  const file = formData.get('receipt');

  if (!Number.isFinite(amount) || amount <= 0) redirect(url({ err: 'amount' }));
  if (!description) redirect(url({ err: 'description' }));
  if (!(file instanceof File) || file.size === 0) redirect(url({ err: 'receipt' }));

  const { entry, error: uploadError } = await uploadReceiptMedia(supabase, file as File, session!.personId);
  if (uploadError || !entry) redirect(url({ err: 'receipt' }));

  const { error: insertError } = await supabase.from('reimbursement_requests').insert({
    requester_person_id: session!.personId,
    amount,
    description,
    receipt_path: entry!.path,
    status: 'submitted'
  });
  if (insertError) redirect(url({ err: 'save' }));

  redirect(url({ ok: '1' }));
}

export async function withdrawReimbursementAction(formData: FormData): Promise<void> {
  const supabase = createAdminClient();
  const session = await getIdentitySessionIfValid();
  if (!session || !(await isEpochCurrent(supabase, session))) {
    redirect(url({ err: 'auth' }));
  }

  const id = Number(formData.get('id'));
  if (!Number.isFinite(id)) redirect(url({ err: 'save' }));

  // Requester-only, and only from 'submitted' — an already-decided request
  // isn't withdrawable, it needs a conversation with the treasurer instead.
  const { error } = await supabase
    .from('reimbursement_requests')
    .update({ status: 'withdrawn' })
    .eq('id', id)
    .eq('requester_person_id', session!.personId)
    .eq('status', 'submitted');
  if (error) redirect(url({ err: 'save' }));

  redirect(url({ ok: 'withdrawn' }));
}
