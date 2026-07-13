/**
 * /photos — the troop's Google Photos album index (Brad's design,
 * prototypes/photo-albums, with Patrick's dropdown-filter revision).
 * Server-renders the full list (small) and hands filtering to the client.
 */

import { createAdminClient } from '@/lib/supabase/server';
import type { PhotoAlbum } from '@/lib/supabase/types';
import { AlbumsBrowser, type AlbumWithCover } from './albums-browser';

export const revalidate = 1800;

export const metadata = {
  title: 'Photo Albums — Scout Troop 79',
  description:
    'Every Troop 79 campout, court of honor, and service project since 2022 — photo albums, all in one place.'
};

async function loadAlbums(): Promise<AlbumWithCover[]> {
  const supabase = createAdminClient();
  const { data: albums } = await supabase
    .from('photo_albums')
    .select('*')
    .order('event_date', { ascending: false });
  const rows = (albums ?? []) as PhotoAlbum[];

  const coverIds = [...new Set(rows.map((a) => a.cover_media_id).filter((x): x is number => x != null))];
  const covers = new Map<number, { cdn_url: string; alt_text: string | null }>();
  if (coverIds.length > 0) {
    const { data: media } = await supabase.from('media').select('id, cdn_url, alt_text').in('id', coverIds);
    for (const m of media ?? []) {
      covers.set(m.id as number, { cdn_url: m.cdn_url as string, alt_text: m.alt_text as string | null });
    }
  }

  return rows.map((a) => ({
    ...a,
    cover_url: a.cover_media_id ? (covers.get(a.cover_media_id)?.cdn_url ?? null) : null,
    cover_alt: a.cover_media_id ? (covers.get(a.cover_media_id)?.alt_text ?? null) : null
  }));
}

export default async function PhotosPage() {
  const albums = await loadAlbums();
  return <AlbumsBrowser albums={albums} />;
}
