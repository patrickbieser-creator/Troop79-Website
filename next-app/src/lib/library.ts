/**
 * Resource Library — shared shapes and pure helpers (Plans/Resource-Library.md).
 *
 * Client-safe: no next/headers, no supabase — usable from Client Components,
 * Server Components, Server Actions, and tests alike. DB access lives in
 * lib/library-data.ts.
 *
 * ADDRESSING (tech-lead review 2026-07-21): placements/notes/submissions key
 * off (target_kind, target_key) using the SAME composite codes the ledger
 * uses — `rank_req` keys are '{rankId}-{code}' (never bare code: "9a"
 * legitimately repeats across ranks), `mb_req` keys are '{mbId}-{code}',
 * `mb` is the badge id alone, `topic` is the shelf slug.
 */

// Type-only — erased at build, so this file stays free of next/headers.
import type { LibraryViewer } from '@/lib/library-viewer';

export type LibraryTargetKind = 'rank_req' | 'mb' | 'mb_req' | 'topic';

export type ResourceKind = 'link' | 'video' | 'document' | 'image' | 'post';

export type ResourceStatus = 'pending' | 'published' | 'archived';

export const RESOURCE_KIND_LABEL: Record<ResourceKind, string> = {
  link: 'Link',
  video: 'Video',
  document: 'Document',
  image: 'Image',
  post: 'Troop Post'
};

export function rankReqKey(rankId: string, code: string): string {
  return `${rankId}-${code}`;
}

export function mbReqKey(mbId: string, code: string): string {
  return `${mbId}-${code}`;
}

/** Splits a rank_req target_key back into (rankId, code) given the known
 *  rank ids — rank ids themselves contain hyphens ('first-class'), so a
 *  blind split on the first '-' would be wrong. */
export function splitRankReqKey(
  key: string,
  rankIds: string[]
): { rankId: string; code: string } | null {
  for (const rankId of rankIds) {
    if (key.startsWith(`${rankId}-`)) {
      return { rankId, code: key.slice(rankId.length + 1) };
    }
  }
  return null;
}

/**
 * Carries the "which scout's progress is showing" URL param forward across
 * the rank drill → rank detail → requirement detail flow (lib/library-viewer.ts),
 * the one navigation path the personalized completion indicators render on.
 * No-op when nothing is selected, so every existing Link stays a plain href
 * for an anonymous visitor.
 */
export function withViewScout(href: string, viewScoutId: string | undefined): string {
  if (!viewScoutId) return href;
  const sep = href.includes('?') ? '&' : '?';
  return `${href}${sep}viewScout=${encodeURIComponent(viewScoutId)}`;
}

/** Display host chip for an outbound URL — presentation only, never trust. */
export function detectHost(url: string | null): string | null {
  if (!url) return null;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host.includes('youtube.com') || host === 'youtu.be') return 'YouTube';
  if (host.includes('docs.google.com') || host.includes('drive.google.com')) return 'Google Doc';
  if (host.includes('amazon.')) return 'Amazon';
  if (host.includes('scouting.org')) return 'BSA';
  if (url.toLowerCase().endsWith('.pdf')) return 'PDF';
  return host.replace(/^www\./, '');
}

/** Best-guess resource kind from a URL — a default for the submit form and
 *  queue; the webmaster can always override before publishing. */
export function inferKind(url: string | null): ResourceKind {
  if (!url) return 'post';
  const lower = url.toLowerCase();
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return 'link';
  }
  if (host.includes('youtube.com') || host === 'youtu.be' || host.includes('vimeo.com')) {
    return 'video';
  }
  if (
    host.includes('docs.google.com') ||
    host.includes('drive.google.com') ||
    lower.endsWith('.pdf') ||
    lower.endsWith('.doc') ||
    lower.endsWith('.docx') ||
    lower.endsWith('.ppt') ||
    lower.endsWith('.pptx')
  ) {
    return 'document';
  }
  if (/\.(jpe?g|png|gif|webp|heic)$/.test(lower)) return 'image';
  return 'link';
}

/** Extracts a YouTube video id from any of the common URL shapes
 *  (watch?v=, youtu.be/, /shorts/, /embed/, /live/) — null for anything else. */
export function youtubeVideoId(url: string | null): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') {
    id = parsed.pathname.split('/')[1] ?? null;
  } else if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    if (parsed.pathname === '/watch') {
      id = parsed.searchParams.get('v');
    } else {
      const m = parsed.pathname.match(/^\/(shorts|embed|live)\/([^/?]+)/);
      id = m ? m[2] : null;
    }
  }
  // Video ids are 11 URL-safe chars — reject anything else rather than
  // building a broken image URL.
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

/**
 * Display thumbnail for a resource: an explicit thumbnail_url wins; otherwise
 * YouTube links get the video's own thumbnail (a static image from ytimg —
 * NOT an embed; the no-iframe decision stands). Null = render the kind icon.
 */
export function resourceThumbnail(resource: {
  thumbnail_url: string | null;
  url: string | null;
}): string | null {
  // Same http(s)-only guard as resource URLs (qa-lead 2026-07-21): this value
  // lands in an <img src>, and no write path validates thumbnail_url yet —
  // guard at render so a future admin thumbnail field can't regress it.
  if (resource.thumbnail_url && /^https?:\/\//i.test(resource.thumbnail_url)) {
    return resource.thumbnail_url;
  }
  const id = youtubeVideoId(resource.url);
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
}

/** True for the kinds whose whole point is an address to somewhere else —
 *  everything except a troop-written post. */
export function kindNeedsUrl(kind: ResourceKind): boolean {
  return kind !== 'post';
}

export interface NewResourceFields {
  title: string;
  kind: ResourceKind;
  url?: string | null;
  bodyMd?: string | null;
  /** True = publish now; false = park it in the queue as an admin draft. */
  publish: boolean;
}

/**
 * Completeness rules for a resource the WEBMASTER is entering
 * (Plans/Library-Admin-Resource-Entry.md). Returns a problem or null.
 *
 * Enforced at PUBLISH, not at insert: the schema deliberately leaves
 * url/body_md nullable so a messy family submission ("my orienteering
 * powerpoint", no title, no placement) can still land in the queue for the
 * webmaster to fix up (see the resource_library migration header). An admin
 * draft gets the same latitude for the same reason — it isn't finished yet.
 *
 * The URL scheme check is the exception: it applies to drafts too. A bad
 * scheme isn't incompleteness to be finished later, it's a value that must
 * never reach an href (D-060 guards write AND render paths).
 */
export function validateNewResource(fields: NewResourceFields): string | null {
  if (!fields.title.trim()) return 'Title is required.';

  const url = fields.url?.trim();
  if (url && !/^https?:\/\//i.test(url)) {
    return 'Links must start with http:// or https://';
  }

  if (!fields.publish) return null;

  if (fields.kind === 'post' && !fields.bodyMd?.trim()) {
    return 'A troop post needs a body before it can be published.';
  }
  if (kindNeedsUrl(fields.kind) && !url) {
    return `A ${RESOURCE_KIND_LABEL[fields.kind].toLowerCase()} needs a link or an uploaded file before it can be published.`;
  }
  return null;
}

/** Icon glyph per resource kind — used by both public cards and admin queue. */
export const RESOURCE_KIND_ICON: Record<ResourceKind, string> = {
  link: '🔗',
  video: '▶',
  document: '📄',
  image: '🖼',
  post: '📝'
};

/**
 * Who may submit proof-of-completion (Plans/Family-Identity-Auth.md,
 * Patrick 2026-08-06; Tier 1 retired 2026-08-21). Allowed: 'household'
 * (Tier 2/2-S, a VERIFIED identity session — adult or scout subjectKind
 * alike; submit-proof/actions.ts resolves which). Refused: 'family' (the OLD
 * Tier 1 — shared troop password + self-asserted household, retired
 * 2026-08-21 now that verified sign-in is the only path; Phase 3's
 * leader-issued-code safety net was the reason this stayed alive and it was
 * decided that feature won't be built — email is the path forward, and a
 * family with no working email is handled out of band, not by this gate),
 * 'leader' (signs requirements off directly via Fast Entry, no review queue
 * needed when the reviewer IS the signer), and the OLD unverified 'scout'
 * audience (shared SCOUT_PASSWORD login, no per-scout identity — any holder
 * could previously claim proof under any active scout's name;
 * Resource-Library.md decision 4's "leader review catches misuse" was never
 * actually load-bearing, the reviewer has no independent way to verify the
 * claim). That path is closed permanently, superseded by verified Tier 2-S
 * rather than reopened itself — see tests/proof-submission-gate.test.ts, the
 * regression guard for this exact behavior.
 *
 * WIDENED ONCE, 2026-09-07 (Patrick: "restore 'I did this' … when I proxy
 * for a scout"): a leader whose resolved library viewer is a PROXY for the
 * very scout the proof is for — holder of `library.proxy_view` who chose
 * `?viewScout=` (lib/library-viewer.ts → `{ kind: 'scout', isProxy: true }`)
 * and posted THAT scout — may file the claim on the scout's behalf. It is
 * not a Fast Entry sign-off: the submission still goes through the review
 * queue like any household claim, and the queue labels it as leader-filed
 * (filedByLeaderLine below). `ctx` carries the two ids; a plain leader
 * session with no proxied scout, or a proxied scout that differs from the
 * posted one, is refused exactly as before. The context never opens
 * 'family', the OLD 'scout' audience, or null.
 */
export type ProofAudience = 'family' | 'leader' | 'scout' | 'household' | null;

export interface ProofProxyContext {
  /** The scout the session's library viewer is a PROXY for (null = not proxying). */
  proxyScoutId?: string | null;
  /** The scout the proof is being filed for (the posted id). */
  forScoutId?: string | null;
}

export function proofSubmissionAllowedFor(audience: ProofAudience, ctx: ProofProxyContext = {}): boolean {
  // 'household' covers BOTH a verified adult (Tier 2) and a verified scout
  // (Tier 2-S, reopened Phase 0's closed scout path on a real identity basis
  // — see Plans/Family-Identity-Auth.md Phase 2).
  if (audience === 'household') return true;
  // 'leader' only with a matching proxy (see the header). Everything else —
  // 'family', the OLD unverified 'scout', and null — is refused.
  if (audience === 'leader') {
    return !!ctx.proxyScoutId && !!ctx.forScoutId && ctx.proxyScoutId === ctx.forScoutId;
  }
  return false;
}

/**
 * The scout a proof may be filed for ON BEHALF OF, or null. The posted id is
 * never trusted by itself: it must equal the scout the resolver already
 * authorized as the session's proxied scout (`isProxy: true` — a verified
 * parent viewing their own scout is NOT a proxy and takes the household
 * path instead). submit-proof/actions.ts resolves the viewer with the posted
 * id as `?viewScout=` and then applies this.
 */
export function proxyScoutIdFor(viewer: LibraryViewer, postedScoutId: string | null | undefined): string | null {
  if (!postedScoutId) return null;
  if (viewer.kind !== 'scout' || !viewer.isProxy) return null;
  return viewer.scoutId === postedScoutId ? viewer.scoutId : null;
}

/**
 * Whether a requirement row shows "I did this" at all — the page-side twin
 * of proofSubmissionAllowedFor(), so a viewer is never walked to a form that
 * refuses them (mb/[mbId]/page.tsx, rank/[rankId]/[code]/page.tsx). A scout
 * must be in view, and either the session is a verified household
 * ('household' — adult or scout) or the viewer is a leader's proxy for that
 * scout (the identity-cookie leader is audience 'household'; the legacy
 * leader cookie is 'leader' — both count once isProxy is true). The OLD
 * shared scout login ('scout'), the troop password alone ('family') and
 * anonymous never see it.
 */
export function canClaimProof(viewer: LibraryViewer, audience: ProofAudience): boolean {
  if (viewer.kind !== 'scout') return false;
  if (viewer.isProxy) return audience === 'household' || audience === 'leader';
  return audience === 'household';
}

/**
 * How a leader-filed claim is attributed on the record. `requirement_submissions`
 * has no from-label column and `submitted_via` is CHECK-constrained to
 * ('family','scout') — no migration for one line of provenance — so the
 * attribution is the FIRST LINE of body_md, written by the action and split
 * back out by the Proof Queue (splitFiledByLine) so the reviewer sees
 * "Filed by <Leader> (leader, on behalf of <Scout>)" as its own line rather
 * than inside the quoted write-up. Guarded by tests/proof-proxy-submit.test.ts.
 */
export function filedByLeaderLine(leaderName: string, scoutName: string): string {
  return `Filed by ${leaderName} (leader, on behalf of ${scoutName})`;
}

const FILED_BY_RE = /^Filed by (.+ \(leader, on behalf of .+\))(?:\n\n([\s\S]*))?$/;

/** A leading "Filed by … (leader, on behalf of …)" line, with any blank lines after it. */
const LEADING_FILED_BY_RE = /^\s*Filed by .+ \(leader, on behalf of .+\)[ \t]*(?:\r?\n\s*)*/;

/**
 * Removes any leading "Filed by …" attribution line(s) from USER-SUPPLIED
 * proof text before it is stored (qa-lead, 2026-09-07): the leader-filed
 * marker is a body_md prefix, so a family typing the same sentence into
 * their write-up would otherwise read as leader-filed in the Proof Queue.
 * Only the server (submitProofAction's proxy branch) may prepend it, after
 * this strip. Repeats are stripped too; the rest of the text is untouched.
 */
export function stripFiledByLine(userText: string | null): string | null {
  if (!userText) return null;
  let text = userText;
  for (let i = 0; i < 10 && LEADING_FILED_BY_RE.test(text); i++) {
    text = text.replace(LEADING_FILED_BY_RE, '');
  }
  const trimmed = text.trim();
  return trimmed || null;
}

export function splitFiledByLine(bodyMd: string | null): { filedBy: string | null; body: string | null } {
  if (!bodyMd) return { filedBy: null, body: null };
  const m = FILED_BY_RE.exec(bodyMd);
  if (!m) return { filedBy: null, body: bodyMd };
  const body = m[2]?.trim() ?? '';
  return { filedBy: m[1], body: body || null };
}
