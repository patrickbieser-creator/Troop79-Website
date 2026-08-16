'use server';

/**
 * Propose a news story from the public side
 * (Plans/Unified-Identity-And-Capabilities.md Phase C).
 *
 * PROPOSING IS BASELINE, NOT A CAPABILITY (Patrick, 2026-08-16). Any verified
 * person — adult or scout — may hand a story to the leaders, the same way
 * anyone may propose a demographics change or submit a library proof. There
 * is nothing to grant, so there is no grant to check: the guard here is
 * "are you a verified person", not "do you hold news.write".
 *
 * THE STATUS IS NOT A FORM FIELD, AND THAT IS THE SECURITY MODEL.
 * `status: 'pending'` is written as a literal below. The submitter cannot
 * name it, so a forged `status=published` in the POST body does nothing, and
 * a future refactor that forgets a permission check can at worst create a row
 * nobody sees. That is the whole argument for review-as-a-filter over a
 * news.publish capability — see the plan's "Publishing is a filter, not a
 * permission".
 */

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/server';
import { getIdentitySessionIfValid } from '@/lib/family-access';
import { isEpochCurrent } from '@/lib/identity-session';
import { slugify } from '@/lib/slugify';

export interface SubmitResult {
  ok: boolean;
  error?: string;
}

const MAX_TITLE = 120;
const MAX_BODY = 20_000;

/** Verified identity + a live session_epoch. Mirrors requireFamilyAccess()'s
 *  spend rule: this is a write, so the revocation read is paid here. */
async function requireVerifiedPerson() {
  const session = await getIdentitySessionIfValid();
  if (!session) throw new Error('Please sign in first.');
  if (!(await isEpochCurrent(createAdminClient(), session))) {
    throw new Error('Your sign-in has been revoked — please sign in again.');
  }
  return session;
}

async function uniquePendingSlug(
  supabase: ReturnType<typeof createAdminClient>,
  title: string
): Promise<string> {
  const base = slugify(title) || 'story';
  for (let n = 0; n < 50; n++) {
    const candidate = n === 0 ? base : `${base}-${n + 1}`;
    const { data } = await supabase.from('articles').select('id').eq('slug', candidate).maybeSingle();
    if (!data) return candidate;
  }
  return `${base}-${Date.now()}`;
}

export async function submitStoryAction(formData: FormData): Promise<SubmitResult> {
  let session;
  try {
    session = await requireVerifiedPerson();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Not signed in.' };
  }

  const title = String(formData.get('title') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();
  if (!title) return { ok: false, error: 'Give your story a headline.' };
  if (title.length > MAX_TITLE) return { ok: false, error: `Keep the headline under ${MAX_TITLE} characters.` };
  if (!body) return { ok: false, error: 'Write something in the story box.' };
  if (body.length > MAX_BODY) return { ok: false, error: 'That story is too long to submit here — send it to a leader instead.' };

  const supabase = createAdminClient();
  const { error } = await supabase.from('articles').insert({
    slug: await uniquePendingSlug(supabase, title),
    title,
    type: 'news',
    body,
    excerpt: null,
    // A literal, never formData. See the header.
    status: 'pending',
    featured: false,
    author_name: session.displayName,
    author_role: session.subjectKind === 'scout' ? 'scout' : 'leader'
  });
  if (error) return { ok: false, error: `Could not save that: ${error.message}` };

  revalidatePath('/admin/news/articles');
  return { ok: true };
}
