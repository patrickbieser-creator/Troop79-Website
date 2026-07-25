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
    testTimeout: 20000
  }
});
