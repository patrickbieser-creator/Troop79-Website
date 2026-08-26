import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Integration tests hit a real local Supabase instance (`supabase start`), the
// same way Server Actions do — see Tests/CLAUDE.md for why this project tests
// at the supabase-js boundary instead of mocking the DB layer.
process.loadEnvFile('.env.local');
// The suite never mails anyone (Patrick, 2026-08-25: seven relay emails per
// `npm run test` were spamming Gmail). identity-auth & co assert login_tokens
// rows, not delivery, so a live Resend key in .env.local is stripped here and
// sendEmail() reports 'skipped'. Opt back in for a deliberate end-to-end
// send with EMAIL_LIVE_TESTS=1 (the dev relay still redirects to you).
if (process.env.EMAIL_LIVE_TESTS !== '1') {
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
}

// Mirrors tsconfig.json's "@/*" -> "./src/*" path — needed for any test that
// imports a src/lib module by value (not just `import type`), since Vitest
// doesn't read tsconfig paths on its own.
const alias = { '@': path.resolve(__dirname, 'src') };

/*
 * TWO PROJECTS, because the two kinds of test want opposite things.
 *
 * `db` is everything this suite has been until now: integration tests against
 * one shared local Postgres, which is why they must not run in parallel.
 *
 * `dom` renders components in jsdom. Added 2026-08-15 — with `environment:
 * 'node'` as the only setting, a whole class of bug was structurally
 * uncatchable: the /profile member switcher shipped showing the previous
 * member's data (D-098) while every value in the database was correct, because
 * only a renderer sees state leaking between selections. These touch no shared
 * state, so they keep Vitest's default parallelism rather than inheriting the
 * DB project's serial execution.
 *
 * Split by extension: `.test.ts` is a DB test, `.test.tsx` is a DOM test.
 */
export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'db',
          environment: 'node',
          include: ['tests/**/*.test.ts'],
          testTimeout: 20000,
          // Every test file shares ONE local Supabase/Postgres instance —
          // Vitest's default concurrent-file execution races them against it.
          // Files that use deterministic fixture ids (e.g.
          // resource-library.test.ts's `vitest-*` scout rows) can collide on a
          // shared primary key when two files insert at the same moment
          // (qa-lead, 2026-08-06 — reproduced the flake, fixed here rather
          // than chasing collision-resistant ids file-by-file). This project
          // also runs concurrent Claude sessions against the same repo/DB (see
          // feedback-multi-session-git memory), which makes the race a near-
          // certainty rather than a rare CI fluke.
          fileParallelism: false
        }
      },
      {
        resolve: { alias },
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['tests/**/*.test.tsx'],
          setupFiles: ['tests/setup-dom.ts']
        }
      }
    ]
  }
});
