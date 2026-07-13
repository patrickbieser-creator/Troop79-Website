/**
 * /admin/news/photo-albums — index-card CRUD for the public Photos page.
 *
 * Each row is a pointer to a public Google Photos album (title, date,
 * category, share URL) plus an optional cover from the media library.
 * The albums themselves live on Google; nothing is mirrored here.
 */

import { createAdminClient } from '@/lib/supabase/server';
import { CATEGORIES } from '@/lib/calendar';
import type { PhotoAlbum } from '@/lib/supabase/types';
import { AlbumsEditor, type CoverInfo } from './albums-editor';
import { createPhotoAlbum, updatePhotoAlbum, deletePhotoAlbum } from './actions';
import styles from './albums.module.css';

export const metadata = {
  title: 'Photo Albums — Troop 79'
};

async function loadData(): Promise<{ albums: PhotoAlbum[]; covers: Record<number, CoverInfo> }> {
  const supabase = createAdminClient();
  const { data: albums } = await supabase
    .from('photo_albums')
    .select('*')
    .order('event_date', { ascending: false });

  const rows = (albums ?? []) as PhotoAlbum[];
  const coverIds = [...new Set(rows.map((a) => a.cover_media_id).filter((x): x is number => x != null))];
  const covers: Record<number, CoverInfo> = {};
  if (coverIds.length > 0) {
    const { data: media } = await supabase
      .from('media')
      .select('id, cdn_url, alt_text')
      .in('id', coverIds);
    for (const m of media ?? []) {
      covers[m.id as number] = { cdn_url: m.cdn_url as string, alt_text: (m.alt_text as string) ?? '' };
    }
  }
  return { albums: rows, covers };
}

export default async function PhotoAlbumsAdminPage() {
  const { albums, covers } = await loadData();

  return (
    <>
      <div className={styles.pageTitle}>
        <h1>Photo Albums</h1>
        <p>
          The index behind the public Photos page. Each entry points at a shared Google Photos
          album — paste the share link, pick a category and date, and optionally choose a cover
          from the media library (albums without one get the &ldquo;79&rdquo; tile).
        </p>
      </div>

      <AlbumsEditor
        rows={albums}
        covers={covers}
        categories={CATEGORIES}
        onCreate={createPhotoAlbum}
        onUpdate={updatePhotoAlbum}
        onDelete={deletePhotoAlbum}
      />
    </>
  );
}
