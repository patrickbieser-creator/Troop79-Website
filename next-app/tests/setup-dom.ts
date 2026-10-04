import { afterEach } from 'vitest';
import { cleanup, configure } from '@testing-library/react';

/**
 * Setup for the `dom` Vitest project (vitest.config.ts).
 *
 * THIS FILE IS NOT OPTIONAL. Testing Library registers its own afterEach
 * cleanup only when a global `afterEach` exists, and this suite runs with
 * Vitest's globals OFF — every test file imports `describe`/`it`/`expect`
 * explicitly. Without the unmount below, components stay in the document
 * between tests in the same file, `getByLabelText` starts matching the
 * previous test's copy, and assertions about state leaking between renders —
 * exactly what this project runs, given D-098 — pass for the wrong reason.
 */
afterEach(() => {
  cleanup();
});

/**
 * waitFor / findBy* get 5 s instead of Testing Library's 1 s. Under the full
 * suite's load a server-action mock's follow-up render can land later than a
 * second; with the per-test timeout raised to 20 s (vitest.config.ts) this was
 * the last source of load-only failures (2026-10-03). A real miss still fails,
 * just four seconds later.
 */
configure({ asyncUtilTimeout: 5000 });

/**
 * jsdom doesn't implement <dialog>'s imperative API (showModal/close nor the
 * `open` property they toggle) — every dialog-based component in this app
 * (MemoCell, EnteredByCell, EditTransactionDialog, and more to come) calls
 * `dialogRef.current.showModal()` in a useEffect, which throws in jsdom with
 * no polyfill at all. Minimal implementation: just enough for a component to
 * open/close without erroring — this suite never asserts on native modal
 * behavior (focus trapping, top-layer promotion) since jsdom can't provide
 * it anyway; that's covered by real-browser verification instead.
 */
if (typeof HTMLDialogElement !== 'undefined') {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}
