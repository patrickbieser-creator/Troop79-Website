import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Plans/Retire-Roster-Contact-Columns.md — the acceptance test. `people` is
 * now the only place a scout's or leader's contact/demographic facts are
 * read; the columns below stay on `scouts`/`leaders` only until the Push C
 * drop migration, and nothing in src/ may select them off those two tables
 * in the meantime.
 *
 * Loose by design (grep-shaped, not a parser): for every `from('scouts')` /
 * `from('leaders')` call, look at the next stretch of source for a
 * `.select('...')` string literal and fail if it names a moved column. A
 * `.select(SOME_CONSTANT)` built from a variable defined far from the call
 * isn't inspected — the known sites in this codebase all keep the column
 * list inline or right beside the from(), same as everywhere else in this
 * file's own reach.
 */

const SRC = path.join(__dirname, '..', 'src');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const files = walk(SRC);

/** Every select('...')/select("...") literal string DIRECTLY chained onto
 *  each from('<table>') call in `src` — only whitespace and `//` comment
 *  lines allowed between them, so an unrelated later query's select() in the
 *  same Promise.all block is never mistaken for this table's own read. */
function selectContentsNear(src: string, table: string): string[] {
  const out: string[] = [];
  const re = new RegExp(
    `from\\(['"]${table}['"]\\)\\s*(?:\\/\\/[^\\n]*\\n\\s*)*\\.select\\(\\s*(['"\`])([\\s\\S]*?)\\1`,
    'g'
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(m[2]);
  return out;
}

function readsColumn(selectContents: string[], column: string): boolean {
  const wordRe = new RegExp(`\\b${column}\\b`);
  return selectContents.some((s) => wordRe.test(s));
}

/** scouts columns retired to `people` — the DOOMED list from
 *  Plans/Retire-Roster-Contact-Columns.md. `household_id` is included: it
 *  moves to a household_members join, not to people, but the rule is the
 *  same — nothing selects it off scouts any more. */
const SCOUT_DOOMED = [
  'address_line1',
  'address_line2',
  'city',
  'state',
  'zip',
  'phone',
  'email',
  'health_form_date',
  'birthdate',
  'gender',
  'bsa_member_id',
  'things_we_should_know',
  'household_id'
];

/** leaders columns retired — `name` is deliberately absent: it stays as a
 *  trigger-derived login label, not a doomed column. */
const LEADER_DOOMED = [
  'address_line1',
  'address_line2',
  'city',
  'state',
  'zip',
  'phone',
  'email',
  'health_form_date',
  'birthdate',
  'bsa_member_id',
  'ypt_completed',
  'things_we_should_know',
  'scout_id'
];

function violationsFor(table: 'scouts' | 'leaders', doomed: readonly string[]): string[] {
  const violations: string[] = [];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    if (!src.includes(`from('${table}')`) && !src.includes(`from("${table}")`)) continue;
    const selects = selectContentsNear(src, table);
    if (selects.length === 0) continue;
    for (const col of doomed) {
      if (readsColumn(selects, col)) violations.push(`${path.relative(SRC, f)}: ${table}.${col}`);
    }
  }
  return violations;
}

describe('No code reads the retired roster contact columns', () => {
  it('NoScoutsSelect_ReadsAColumnMovedToPeople', () => {
    expect(violationsFor('scouts', SCOUT_DOOMED)).toEqual([]);
  });

  it('NoLeadersSelect_ReadsAColumnMovedOrDropped', () => {
    expect(violationsFor('leaders', LEADER_DOOMED)).toEqual([]);
  });
});

describe('no template-built selects on scouts/leaders', () => {
  it('NoScoutsOrLeadersSelect_IsBuiltFromAFieldListConstant', () => {
    // The profile page built its scouts select from EDITABLE_SCOUT_FIELDS
    // (a joined constant), which the literal-string check above cannot see —
    // it kept selecting dropped columns after Push C (found live 2026-08-26).
    const offenders: string[] = [];
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      const re = /\.from\('(scouts|leaders)'\)[\s\S]{0,120}?\.select\(`[^`]*\$\{/g;
      if (re.test(src)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});

describe('no select(*) on scouts/leaders', () => {
  it('NoScoutsOrLeadersRead_SelectsStar', () => {
    // select('*') is typed as "whatever the table had at type-generation
    // time", so a dropped column reads as undefined at runtime instead of
    // failing typecheck — two live regressions on 2026-08-26. Name the
    // columns (SCOUT_CORE_COLS) so the next drop is a compile error.
    const offenders: string[] = [];
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      const re = /\.from\('(scouts|leaders)'\)\s*(?:\/\/[^\n]*\n\s*)*\.select\(\s*['"`]\*['"`]/g;
      if (re.test(src)) offenders.push(path.relative(SRC, file));
    }
    expect(offenders).toEqual([]);
  });
});
