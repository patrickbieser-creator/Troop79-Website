import type { NextConfig } from "next";

// Only registered when set, so local dev with no Bunny account configured
// yet doesn't break — same "only wire up cloud storage if the env var is
// present" pattern the original spec used for S3.
const bunnyHostname = process.env.BUNNY_PULL_ZONE_HOSTNAME;

const nextConfig: NextConfig = {
  images: {
    remotePatterns: bunnyHostname
      ? [{ protocol: 'https', hostname: bunnyHostname }]
      : []
  },
  async headers() {
    return [
      {
        // Explicit rather than relying on the browser default of the same
        // value: the Bugle "Register Now" intake carries a recipient's email
        // address in its query string for one hop, and event pages load
        // images from the CDN — the query must never ride along in a
        // cross-origin Referer (Plans/Bugle-Register-Now-Links.md, B2).
        source: '/:path*',
        headers: [{ key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' }]
      },
      {
        // A wreath order's confirmation page is keyed by a secret in its URL (Plans/Wreath-Sale.md): it must not
        // leave in a Referer, be cached by a shared cache, or be indexed. Listed AFTER the global rule above so
        // its Referrer-Policy wins for these paths.
        source: '/wreaths/order/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Cache-Control', value: 'no-store' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' }
        ]
      },
      {
        // A meeting invite's answer link carries its secret in the path (Plans/Matcher-Tune-Up.md T-5, qa-lead M5).
        source: '/i/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Cache-Control', value: 'no-store' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' }
        ]
      }
    ];
  },
  async redirects() {
    return [
      // The public plan page is retired (Build a Plan B4); the Meeting
      // Planner is the plan of record now, so old bookmarks and shared
      // links land there (it asks visitors to sign in). /meetings, the
      // previous target, no longer exists. Not permanent, in case a public
      // plan page ever comes back.
      { source: '/meeting-plan', destination: '/planner', permanent: false }
    ];
  },
  experimental: {
    // Client router cache for dynamic pages. Next 15+ defaults this to 0, so
    // every admin click and every back/forward refetched the whole page.
    // 30 s makes revisits instant. Safe for writes: any Server Action that
    // calls revalidatePath / revalidateTag / updateTag (or cookies.set/delete)
    // clears the client cache, so the actor always sees their own edits.
    // Trade-off: ANOTHER leader's edit can show up to 30 s late on a page
    // you already visited. Back/forward navigation is unaffected by this
    // setting (the browser-history cache is separate).
    staleTimes: { dynamic: 30 },
    serverActions: {
      // Default is too small for photo uploads through the media picker.
      bodySizeLimit: '15mb'
    },
    // Default (true) caches Server Component fetch responses across dev
    // refreshes — even cache:'no-store' ones — and only clears on a hard
    // navigation, not router.refresh(). That makes every toggle-style
    // Server Action (Submit & Present's checkboxes, ledger archive/delete)
    // look broken in local dev: the write succeeds but the re-fetched data
    // is served stale. Doesn't exist in production, so this is dev-only.
    serverComponentsHmrCache: false
  }
};

export default nextConfig;
