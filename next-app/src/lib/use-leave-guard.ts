'use client';

/**
 * Leave guard for a public edit screen with unsaved changes. While `dirty`:
 *   - `beforeunload` asks the browser to confirm reloads and tab closes;
 *   - a click on an in-app link asks "discard your changes?" first, and a "no"
 *     cancels the navigation (App Router has no route-change event, so the
 *     check runs in a capture-phase click listener ahead of <Link>'s own).
 * Browser Back/Forward is covered by neither — App Router offers no hook for it.
 * The admin side has its own registry (useRegisterDirty); public code does not
 * import it.
 */
import { useEffect } from 'react';

export const LEAVE_MESSAGE = 'You have unsaved changes. Leave this page and lose them?';

export function useLeaveGuard(dirty: boolean, message: string = LEAVE_MESSAGE): void {
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      if (!window.confirm(message)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', onUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty, message]);
}
