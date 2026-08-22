/**
 * /photos — the troop's Google Photos album index.
 *
 * Four views of one list (Patrick, 2026-08-22, from Brad's concepts in
 * prototypes/photo-library-concepts.html): Prints, Timeline, List, Almanac.
 * This file loads; albums-browser.tsx filters and switches; views.tsx draws.
 *
 * Category colours now come from `calendar_categories.color` — the same
 * authoritative column the calendar month grid reads. The old hardcoded
 * label→class map in albums-browser.tsx had no entry for five live labels, so
 * "Troop 79 — 2025 in Review" (Recruiting / Outreach) silently rendered the
 * default navy chip instead of its own colour (Brad, 2026-08-22).
 */

import { createAdminClient } from '@/lib/supabase/server';
import type { PhotoAlbum } from '@/lib/supabase/types';
import { categoryColorMap, type CalendarCategoryRow } from '@/lib/calendar-categories';
import type { PhotoViewAlbum } from '@/lib/photo-views';
import { AlbumsBrowser } from './albums-browser';

export const revalidate = 1800;

export const metadata = {
  title: 'Photo Albums — Scout Troop 79',
  description:
    'Every Troop 79 campout, court of honor, and service project since 2022 — photo albums, all in one place.'
};

async function loadData(): Promise<{ albums: PhotoViewAlbum[]; colors: Record<string, string> }> {
  const supabase = createAdminClient();
  const [{ data: albumRows }, { data: categoryRows }] = await Promise.all([
    supabase.from('photo_albums').select('*').order('event_date', { ascending: false }),
    supabase.from('calendar_categories').select('label, color')
  ]);

  const rows = (albumRows ?? []) as PhotoAlbum[];
  const coverIds = [...new Set(rows.map((a) => a.cover_media_id).filter((x): x is number => x != null))];
  const covers = new Map<number, { cdn_url: string; alt_text: string | null }>();
  if (coverIds.length > 0) {
    const { data: media } = await supabase.from('media').select('id, cdn_url, alt_text').in('id', coverIds);
    for (const m of media ?? []) {
      covers.set(m.id as number, { cdn_url: m.cdn_url as string, alt_text: m.alt_text as string | null });
    }
  }

  return {
    albums: rows.map((a) => ({
      id: a.id,
      title: a.title,
      category: a.category,
      event_date: a.event_date,
      photo_count: a.photo_count,
      google_url: a.google_url,
      description: a.description,
      cover_url: a.cover_media_id ? (covers.get(a.cover_media_id)?.cdn_url ?? null) : null,
      cover_alt: a.cover_media_id ? (covers.get(a.cover_media_id)?.alt_text ?? null) : null
    })),
    colors: categoryColorMap((categoryRows ?? []) as CalendarCategoryRow[])
  };
}

export default async function PhotosPage() {
  const { albums, colors } = await loadData();
  return <AlbumsBrowser albums={albums} colors={colors} />;
}
