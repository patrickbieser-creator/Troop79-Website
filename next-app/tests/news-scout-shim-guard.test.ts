import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { satisfiesLegacyRole } from '../src/lib/require-role';
import type { AdminActor } from '../src/lib/admin-actor';
import type { Capability } from '../src/lib/capabilities';

/**
 * THE NEWS CONVERSION TRAP
 * (Plans/Unified-Identity-And-Capabilities.md Phase B2 / Phase C).
 *
 * Phase B1's transition shim maps a legacy SCOUT_PASSWORD session to
 * `news.write`, because drafting news is the only thing scouts do in /admin.
 * Patrick then collapsed news.author + news.publish into a single
 * `news.write` (2026-08-16), so that one capability now also covers
 * publishing, archiving, deleting and featuring.
 *
 * Those two facts combine into a live hazard: the moment someone converts
 * `publishArticle` (or archive/unarchive/delete/setFeatured) from
 * requireRole(['leader']) to requireCapability('news.write'), a bare
 * SCOUT_PASSWORD session gains the ability to publish and delete articles.
 * Nothing else in the codebase would notice — the change looks exactly like
 * the 58 safe conversions already made in Advancement.
 *
 * News is therefore deliberately NOT converted in Phase B2. Phase C
 * disentangles it properly: scout drafting moves to the public side as a
 * baseline action landing in `'pending'`, SCOUT_PASSWORD is deleted, and this
 * shim goes with it. These tests fail loudly if anyone converts News first.
 */

const NEWS_ACTIONS_DIR = 'src/app/admin/(workspace)/news';

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFilesUnder(full));
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

describe('news / legacy-scout shim interaction', () => {
  it('LegacyScoutActor_WouldSatisfyNewsWrite_WhichIsWhyNewsStaysOnRequireRole', () => {
    const scout: AdminActor = {
      kind: 'identity', // the shim's output shape, as requireRole() sees it
      label: 'shim probe',
      personId: 1,
      capabilities: new Set<Capability>(['news.write']),
      legacyRole: null
    };
    // This is the hazard in one line: holding news.write is enough for any
    // page guarded by requireCapability('news.write'), publish included.
    expect(scout.capabilities.has('news.write')).toBe(true);
    // ...while the role check that currently protects publish still refuses.
    expect(satisfiesLegacyRole(scout, 'leader')).toBe(false);
  });

  it('NewsActions_AreNotConvertedToCapabilityChecks_WhileScoutPasswordExists', () => {
    const offenders = tsFilesUnder(NEWS_ACTIONS_DIR).filter((f) =>
      readFileSync(f, 'utf8').includes("requireCapability('news.write')")
    );
    expect(
      offenders,
      'News is guarded by requireRole() on purpose — see this file’s header. ' +
        'Converting it to requireCapability(\'news.write\') lets a SCOUT_PASSWORD ' +
        'session publish and delete articles, because the Phase B1 shim maps ' +
        'legacy scouts to news.write. Do Phase C first (move scout drafting to ' +
        'the public side and delete SCOUT_PASSWORD), then convert.'
    ).toEqual([]);
  });

  it('LeaderOnlyNewsActions_StillExist_SoTheGuardHasSomethingToProtect', () => {
    // If these are ever renamed, the guard above silently protects nothing.
    const src = readFileSync(join(NEWS_ACTIONS_DIR, 'articles', 'actions.ts'), 'utf8');
    for (const fn of ['publishArticle', 'archiveArticle', 'deleteArticle', 'setFeatured']) {
      expect(src, `${fn} missing — re-check the news conversion hazard`).toContain(fn);
    }
  });
});
