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
  // ── Design-system firewall (Phase D guardrail, 2026-08-21) ──
  // Public code must never import from the admin workspace. The one styling
  // exception era (DatePickerField on /profile) ended in Public Phase C;
  // this rule keeps it ended. src/lib is intentionally NOT restricted —
  // shared logic (admin-actor etc.) lives there for both sides.
  // Companion invariant checks: tests/design-system-census.test.ts.
  {
    files: ["src/app/(public)/**", "src/app/_components/**", "src/app/*.tsx", "src/app/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/admin/**", "@/app/admin/**"],
              message:
                "Public code must not import from src/app/admin — the design-system firewall runs both directions. Use the shared components in src/app/_components/ (see /admin/styleguide/public and next-app/AGENTS.md).",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
