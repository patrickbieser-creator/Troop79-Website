import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Design-system census — the Public Design System closeout numbers
 * (Plans/Completed/Public-Design-System.md, Phase D 2026-08-21) enforced as
 * invariants, the same way the test-count baseline is monotonic. These
 * turn AGENTS.md's styling rules from convention into failing tests.
 *
 * If one of these fails on your change, the fix is almost never "grow the
 * allowlist": use a token, use a shared component, or move the value into
 * CSS. Growing an allowlist requires the /* deliberate *​/ comment at the
 * site AND a scoreboard note on /admin/styleguide/public — same-commit
 * rule. (ESLint's no-restricted-imports covers the admin-import direction
 * of the firewall; this file covers everything grep-shaped.)
 */

const APP = path.join(__dirname, '..', 'src', 'app');

function walk(dir: string, opts: { excludeAdmin?: boolean } = {}): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (opts.excludeAdmin && e.name === 'admin' && dir === APP) continue;
      out.push(...walk(p, opts));
    } else {
      out.push(p);
    }
  }
  return out;
}

const rel = (p: string) => path.relative(APP, p).replace(/\\/g, '/');
const normHex = (h: string) => {
  h = h.toLowerCase();
  if (h.length === 4) h = '#' + [...h.slice(1)].map((c) => c + c).join('');
  return h;
};

const publicFiles = walk(APP, { excludeAdmin: true });
const publicCss = publicFiles.filter((f) => f.endsWith('.css'));
const publicTsx = publicFiles.filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'));

describe('Design-system census (public)', () => {
  it('PublicCss_ContainsOnlySanctionedHex_PerPhaseDCloseout', () => {
    // The 7 deliberates, each carrying a comment at its site: the printed
    // Clipboard's pencil grid (#999/#aaa/#efeae0), the Scout-rank and
    // tagYouth categorical colors (#7a7068/#f5eeda), and the merit-badge
    // celebration gold pair (#f5d76a/#5a3a00 — mint --award-gold on a 3rd
    // use). globals.css is the token sheet itself and is exempt.
    const SANCTIONED = new Set([
      '#999999',
      '#aaaaaa',
      '#efeae0',
      '#7a7068',
      '#f5eeda',
      '#f5d76a',
      '#5a3a00'
    ]);
    const violations: string[] = [];
    for (const f of publicCss) {
      if (rel(f) === 'globals.css') continue;
      const src = fs.readFileSync(f, 'utf8');
      for (const m of src.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
        if (!SANCTIONED.has(normHex(m[0]))) violations.push(`${rel(f)}: ${m[0]}`);
      }
    }
    expect(violations, 'raw hex outside the sanctioned set — use a token').toEqual([]);
  });

  it('PublicTsx_ContainsOnlySanctionedInlineStyles_PerPhaseDCloseout', () => {
    // 13 genuinely-dynamic sites in 6 files, each /* dynamic */-commented.
    const SANCTIONED: Record<string, number> = {
      '(public)/events/month-grid.tsx': 5,
      '(public)/scouts/[id]/page.tsx': 2,
      '(public)/merit-badges/[mbId]/page.tsx': 2,
      '(public)/events/[id]/page.tsx': 2,
      '(public)/events/calendar-browser.tsx': 1,
      '(public)/events/[id]/slot-first-form.tsx': 1
    };
    const violations: string[] = [];
    for (const f of publicTsx) {
      const count = (fs.readFileSync(f, 'utf8').match(/style=\{\{/g) ?? []).length;
      if (count === 0) continue;
      const allowed = SANCTIONED[rel(f)] ?? 0;
      if (count > allowed) violations.push(`${rel(f)}: ${count} inline site(s), ${allowed} sanctioned`);
    }
    expect(violations, 'inline style={{}} beyond the sanctioned dynamic sites — use a class').toEqual([]);
  });

  it('PublicCss_NeverReadsAdminTokens', () => {
    const violations: string[] = [];
    for (const f of publicCss) {
      const src = fs.readFileSync(f, 'utf8');
      for (const m of src.matchAll(/var\(--admin-[a-z0-9-]+/g)) {
        violations.push(`${rel(f)}: ${m[0]}`);
      }
    }
    expect(violations, 'public CSS reading --admin-* — firewall breach').toEqual([]);
  });

  it('PublicCode_NeverImportsFromAdmin', () => {
    // Belt to ESLint's no-restricted-imports braces.
    const violations: string[] = [];
    for (const f of publicTsx) {
      const src = fs.readFileSync(f, 'utf8');
      if (/from\s+['"](@\/app\/admin|[./]+admin\/)/.test(src)) violations.push(rel(f));
    }
    expect(violations, 'public code importing from src/app/admin — firewall breach').toEqual([]);
  });
});

describe('Design-system census (admin side of the firewall)', () => {
  it('AdminCss_ReadsPublicTokens_OnlyInSanctionedFiles', () => {
    // Sanctioned: admin.css (the --admin-preview-* alias block) and the
    // public styleguide's own stylesheet (its whole job is public context).
    // The next/font variables (--font-playfair/-lora/-open-sans) are
    // infrastructure, not palette, and are allowed everywhere.
    const SANCTIONED_FILES = new Set(['admin.css', 'public-styleguide.module.css']);
    const PUBLIC_TOKEN = /var\(--(navy|forest|khaki|bark|cream|newsprint|warm-white|rule|text-(head|body|meta)|border-(light|mid)|fs-[a-z0-9]+|sp-\d+|rad-[a-z]+|status-[a-z-]+|on-navy-[a-z]+|font-(display|body|ui|mono)|shadow-(card|hover)|transition|focus-ring)\b/g;
    const adminCss = walk(path.join(APP, 'admin')).filter((f) => f.endsWith('.css'));
    const violations: string[] = [];
    for (const f of adminCss) {
      if (SANCTIONED_FILES.has(path.basename(f))) continue;
      const src = fs.readFileSync(f, 'utf8');
      for (const m of src.matchAll(PUBLIC_TOKEN)) {
        violations.push(`${rel(f)}: ${m[0]}`);
      }
    }
    expect(violations, 'admin CSS reading public tokens outside the sanctioned files').toEqual([]);
  });
});
