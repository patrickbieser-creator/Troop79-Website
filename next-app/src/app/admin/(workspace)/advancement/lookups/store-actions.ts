'use server';

/**
 * Menu Monster stores — Lookups & Admin → Menu Monster stores. The list the
 * price book's store pickers offer (lib/menu-monster/stores.ts).
 *
 * Gate: `library.moderate`, the same capability the Menu Monster price book
 * itself needs — NOT the Lookups page's `roster.manage`. The page renders the
 * card only for people who hold it (page.tsx), so no one is shown an editor
 * that can only refuse. Writes use the service role (mm_* tables have RLS on
 * with zero policies, D-239) and land in the content audit trail (area
 * `library`).
 */

import { revalidatePath } from 'next/cache';
import { requireCapability } from '@/lib/require-capability';
import { createAdminClient } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import {
  addStoreWith,
  deleteStoreWith,
  moveStoreWith,
  renameStoreWith,
  restoreStoreWith,
  retireStoreWith,
  type StoreResult
} from '@/lib/menu-monster/stores';

type Result = StoreResult;

function revalidate() {
  revalidatePath('/admin/advancement/lookups');
  revalidatePath('/admin/library/menu-monster');
}

async function guard(): Promise<Result | null> {
  try {
    await requireCapability('library.moderate');
    return null;
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }
}

function idOf(fd: FormData): number | null {
  const id = Number(fd.get('id'));
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function run(fd: FormData, go: (id: number) => Promise<Result>): Promise<Result> {
  const denied = await guard();
  if (denied) return denied;
  const id = idOf(fd);
  if (id === null) return { ok: false, error: 'Missing store.' };
  const res = await go(id);
  if (res.ok) revalidate();
  return res;
}

export async function createStore(fd: FormData): Promise<Result> {
  const denied = await guard();
  if (denied) return denied;
  const res = await addStoreWith(createAdminClient(), String(fd.get('name') ?? ''), recordAudit);
  if (res.ok) revalidate();
  return res;
}

export async function renameStore(fd: FormData): Promise<Result> {
  return run(fd, (id) => renameStoreWith(createAdminClient(), id, String(fd.get('name') ?? ''), recordAudit));
}

export async function retireStore(fd: FormData): Promise<Result> {
  return run(fd, (id) => retireStoreWith(createAdminClient(), id, recordAudit));
}

export async function restoreStore(fd: FormData): Promise<Result> {
  return run(fd, (id) => restoreStoreWith(createAdminClient(), id, recordAudit));
}

export async function deleteStore(fd: FormData): Promise<Result> {
  return run(fd, (id) => deleteStoreWith(createAdminClient(), id, recordAudit));
}

export async function moveStore(fd: FormData): Promise<Result> {
  const direction = fd.get('direction') === 'down' ? 'down' : 'up';
  return run(fd, (id) => moveStoreWith(createAdminClient(), id, direction, recordAudit));
}
