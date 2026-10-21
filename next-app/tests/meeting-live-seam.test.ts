import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Once Meeting Live has started, the saved placement is the truth for that meeting (Decision 8): every reader of the
 * match goes through loadMatchOrPlacement (lib/meeting-live), never straight to the matcher. The tech-lead's P4 spec
 * names the three readers: the member page, the agenda tray, and the v1 Admin This Sunday tab (until P5 retires it).
 */
const READERS = [
  'src/app/(public)/member/meeting/page.tsx',
  'src/app/admin/(workspace)/advancement/meetings/load-agenda.ts',
  'src/app/admin/(workspace)/advancement/meeting-plan/this-sunday.tsx'
];
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

describe('the match-or-placement seam', () => {
  for (const file of READERS) {
    it(`Reader_GoesThroughTheSeam (${file.split('/').slice(-2).join('/')})`, () => {
      const s = src(file);
      expect([/loadLiveMatch\s*\(/.test(s), /loadMatchOrPlacement\s*\(/.test(s)]).toEqual([false, true]);
    });
  }
});
