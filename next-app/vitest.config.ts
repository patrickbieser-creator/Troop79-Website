import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Integration tests hit a real local Supabase instance (`supabase start`), the
// same way Server Actions do — see Tests/CLAUDE.md for why this project tests
// at the supabase-js boundary instead of mocking the DB layer.
process.loadEnvFile('.env.local');

export default defineConfig({
  resolve: {
    // Mirrors tsconfig.json's "@/*" -> "./src/*" path — needed for any test
    // that imports a src/lib module by value (not just `import type`), since
    // Vitest doesn't read tsconfig paths on its own.
    alias: { '@': path.resolve(__dirname, 'src') }
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 20000,
    // Every test file shares ONE local Supabase/Postgres instance — Vitest's
    // default concurrent-file execution races them against it. Files that use
    // deterministic fixture ids (e.g. resource-library.test.ts's `vitest-*`
    // scout rows) can collide on a shared primary key when two files insert
    // at the same moment (qa-lead, 2026-08-06 — reproduced the flake, fixed
    // here rather than chasing collision-resistant ids file-by-file). This
    // project also runs concurrent Claude sessions against the same repo/DB
    // (see feedback-multi-session-git memory), which makes the race a near-
    // certainty rather than a rare CI fluke.
    fileParallelism: false
  }
});
