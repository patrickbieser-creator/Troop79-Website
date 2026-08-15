import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

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
