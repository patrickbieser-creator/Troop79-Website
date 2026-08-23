-- Photo thumbnails, step 7 (Plans/Photo-Thumbnails.md): one album cover's
-- URL carried a raw space ("Klondike Team-BoyScoutChallenge-03-22.jpg") and
-- never loaded on /photos. The Bunny sync recorded 24 such media rows —
-- filenames uploaded straight to the CDN with spaces in them.
--
-- Data-only, idempotent: percent-encode the space in `cdn_url` (the URL a
-- browser is handed). `bunny_path` is left alone — it is the object's real
-- name in storage, which the Storage API is given separately. The renderer
-- (photos/album-cover.tsx → safeImageUrl) encodes defensively too, so a
-- future sync cannot reintroduce the break.
update public.media
set cdn_url = replace(cdn_url, ' ', '%20')
where cdn_url like '% %';
