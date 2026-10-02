'use client';

/**
 * My menus — the one quiet line that offers the anonymous planner's browser
 * draft to a signed-in scout ("Save it to My menus" / "No thanks"). Shown only
 * when the draft has a recipe and this exact draft hasn't been saved or waved
 * off before: the answer is remembered as a hash of the draft, so a NEW draft
 * is offered again. The browser draft itself is never touched — the anonymous
 * planner stays as it was. Storage can be blocked; then there is no offer.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Catalog } from '@/lib/menu-monster/types';
import { MEALS } from '@/lib/menu-monster/units';
import { restorePlan } from '@/lib/menu-monster/engine';
import { menuFromDraft } from '@/lib/menu-monster/menus';
import { createMenuAction } from '../../../_tools/menu-monster/menu-actions';
import { PLAN_STORAGE_KEY } from '../../../_tools/menu-monster/planner';
import s from './workspace.module.css';

/** Holds the hash of the last draft the scout answered (saved or dismissed). */
export const DRAFT_ANSWERED_KEY = 'troop79.menuMonster.plan.v1.offerAnswered';

/** A small, stable hash of the draft's JSON text (djb2). */
export function hashDraft(raw: string): string {
  let h = 5381;
  for (let i = 0; i < raw.length; i++) h = ((h * 33) ^ raw.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

interface Offer {
  hash: string;
  label: string;
  raw: unknown;
}

function readOffer(catalog: Catalog): Offer | null {
  try {
    const text = window.localStorage.getItem(PLAN_STORAGE_KEY);
    if (!text) return null;
    const hash = hashDraft(text);
    if (window.localStorage.getItem(DRAFT_ANSWERED_KEY) === hash) return null;
    const raw: unknown = JSON.parse(text);
    if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as { recipeIds?: unknown }).recipeIds)) return null;
    const plan = restorePlan(raw, catalog);
    if (plan.recipeIds.length === 0) return null;
    const names = plan.recipeIds.map((id) => catalog.recipes.find((r) => r.id === id)?.name).filter(Boolean);
    const slot = MEALS.find((m) => m.key === plan.meal)?.label ?? 'Meal';
    return { hash, label: `${slot} · ${names.join(', ')}`, raw };
  } catch {
    return null;
  }
}

function markAnswered(hash: string) {
  try {
    window.localStorage.setItem(DRAFT_ANSWERED_KEY, hash);
  } catch {
    // Blocked storage: it may be offered again next visit, which is harmless.
  }
}

export function DraftOffer({ catalog }: { catalog: Catalog }) {
  const router = useRouter();
  const [offer, setOffer] = useState<Offer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOffer(readOffer(catalog));
  }, [catalog]);

  if (!offer) return null;

  async function save(o: Offer) {
    setBusy(true);
    setError(null);
    const res = await createMenuAction(menuFromDraft(restorePlan(o.raw, catalog), catalog));
    if (!res.ok) {
      setBusy(false);
      return setError(res.error);
    }
    markAnswered(o.hash);
    router.push(`/library/menu-monster/menus/${res.id}`);
  }

  function dismiss(o: Offer) {
    markAnswered(o.hash);
    setOffer(null);
  }

  return (
    <p className={s.foot} role="status">
      You have a meal planned on this computer: <strong>{offer.label}</strong>.{' '}
      <button type="button" className={s.linkBtn} disabled={busy} onClick={() => void save(offer)}>
        Save it to My menus
      </button>{' '}
      <button type="button" className={s.linkBtn} disabled={busy} onClick={() => dismiss(offer)}>
        No thanks
      </button>
      {error && <span> {error}</span>}
    </p>
  );
}
