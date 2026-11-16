/**
 * Records an open from the rail, a menu, search or A–Z (decision 12) without touching the navigation: a beacon is sent
 * by the browser in the background and survives the page changing, a new-tab click included. Client-side only.
 */
export function beaconNavOpen(key: string): void {
  if (typeof navigator === 'undefined') return;
  try {
    if (navigator.sendBeacon?.('/admin/nav-open', key)) return;
    void fetch('/admin/nav-open', { method: 'POST', body: key, keepalive: true, credentials: 'same-origin' }).catch(() => {});
  } catch {
    // Tracking is best effort: never in the way of opening the page.
  }
}
