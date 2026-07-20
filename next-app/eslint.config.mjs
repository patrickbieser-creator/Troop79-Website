import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Leftover renamed build cache from a Windows file-lock workaround
    // (2026-07-19) — not .gitignore'd since it isn't literally ".next", and
    // still locked by a running dev server. Safe to remove this line once
    // the folder itself is deleted.
    ".next-broken/**",
  ]),
]);

export default eslintConfig;
