import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Content audit trail coverage guard (Patrick, 2026-08-30): every server-
 * action file in the four audited content areas must import and call
 * lib/audit's recordAudit. This can't prove every mutation inside a file is
 * instrumented, but it catches the failure mode that actually happens — a
 * whole file (usually a new one) shipping with no auditing at all. When a
 * new action file is added to news/calendar/roster/library, add it here.
 *
 * events/actions.ts (the signup workbench) is deliberately absent — family
 * logistics and payments, not website content. Advancement and finance are
 * excluded by design: they have ledgers of record.
 */

const AUDITED_ACTION_FILES = [
  'src/app/admin/(workspace)/news/articles/actions.ts',
  'src/app/admin/(workspace)/news/media/actions.ts',
  'src/app/admin/(workspace)/news/media-manager/actions.ts',
  'src/app/admin/(workspace)/news/photo-albums/actions.ts',
  'src/app/admin/(workspace)/calendar/actions.ts',
  'src/app/admin/(workspace)/library/actions.ts',
  'src/app/admin/(workspace)/library/menu-monster/actions.ts',
  'src/app/admin/(workspace)/advancement/roster/person-actions.ts',
  'src/app/admin/(workspace)/advancement/roster/change-request-actions.ts',
  'src/app/admin/(workspace)/advancement/roster/guest-actions.ts',
  'src/app/admin/(workspace)/advancement/roster/patrols/actions.ts',
  'src/app/admin/(workspace)/advancement/roster/[personId]/scout-status-actions.ts',
  'src/app/admin/(workspace)/advancement/lookups/actions.ts',
  'src/app/admin/(workspace)/advancement/lookups/household-actions.ts',
  'src/app/admin/(workspace)/advancement/roster-import/actions.ts'
];

/**
 * Action files in an audited area that are READ-ONLY by design — they call
 * requireCapability and return data, never write. Exempt from the rule
 * above, and pinned to stay that way: the day one of them grows a write is
 * the day it belongs in AUDITED_ACTION_FILES instead.
 */
const READ_ONLY_ACTION_FILES = [
  'src/app/admin/(workspace)/advancement/roster/[personId]/history-actions.ts'
];

describe('content audit trail — every audited action file records to it', () => {
  for (const file of AUDITED_ACTION_FILES) {
    it(`${file.split('/').slice(-2).join('/')} imports and calls recordAudit`, () => {
      const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
      expect(src, `${file} must import recordAudit from '@/lib/audit'`).toMatch(
        /import \{[^}]*recordAudit[^}]*\} from '@\/lib\/audit'/
      );
      expect(src, `${file} must call recordAudit at least once`).toMatch(/await recordAudit\(/);
    });
  }
});

describe('content audit trail — read-only action files stay read-only', () => {
  for (const file of READ_ONLY_ACTION_FILES) {
    it(`${file.split('/').slice(-2).join('/')} performs no write`, () => {
      const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
      expect(src, `${file} is exempt from recordAudit only while it writes nothing`).not.toMatch(
        /\.(insert|update|upsert|delete|rpc)\(/
      );
    });
  }
});
