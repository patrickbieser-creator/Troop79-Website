import { defineConfig } from 'vitest/config';

// Integration tests hit a real local Supabase instance (`supabase start`), the
// same way Server Actions do — see Tests/CLAUDE.md for why this project tests
// at the supabase-js boundary instead of mocking the DB layer.
process.loadEnvFile('.env.local');

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 20000
  }
});
