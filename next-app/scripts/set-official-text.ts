/**
 * Upserts verbatim official BSA requirement text into requirement_official_text,
 * keyed by (source, parent_id, code) — same natural key the admin editor's
 * updateReqCode action uses, not the requirement row's bigserial id.
 *
 * Run: npm run set-official-text -- <path-to-json>
 *
 * JSON input shape:
 *   {
 *     "source": "rank",
 *     "parentId": "tenderfoot",
 *     "text": { "1a": "...", "1b": "...", ... }
 *   }
 *
 * Requires local Supabase running (`supabase start` from next-app/) OR a
 * cloud project URL + service role key in .env.local. Uses the SERVICE ROLE
 * key (bypasses RLS) — only run server-side.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is required in .env.local');
  process.exit(1);
}

interface Input {
  source: 'rank' | 'mb';
  parentId: string;
  text: Record<string, string>;
}

async function main() {
  const jsonPath = process.argv[2];
  if (!jsonPath) {
    console.error('Usage: npm run set-official-text -- <path-to-json>');
    process.exit(1);
  }
  const input = JSON.parse(readFileSync(resolve(jsonPath), 'utf-8')) as Input;
  if (input.source !== 'rank' && input.source !== 'mb') {
    console.error('source must be "rank" or "mb"');
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY!);

  const table = input.source === 'rank' ? 'rank_requirements' : 'merit_badge_requirements';
  const parentField = input.source === 'rank' ? 'rank_id' : 'mb_id';
  const { data: existing, error: fetchErr } = await supabase
    .from(table)
    .select('code')
    .eq(parentField, input.parentId);
  if (fetchErr) {
    console.error(fetchErr.message);
    process.exit(1);
  }
  const existingCodes = new Set((existing ?? []).map((r) => r.code as string));

  const unknown = Object.keys(input.text).filter((c) => !existingCodes.has(c));
  if (unknown.length > 0) {
    console.error(
      `Refusing to import — these codes don't exist in ${table} for ${input.parentId}: ${unknown.join(', ')}`
    );
    process.exit(1);
  }

  const rows = Object.entries(input.text).map(([code, official_text]) => ({
    source: input.source,
    parent_id: input.parentId,
    code,
    official_text
  }));

  const { error } = await supabase
    .from('requirement_official_text')
    .upsert(rows, { onConflict: 'source,parent_id,code' });
  if (error) {
    console.error(error.message);
    process.exit(1);
  }

  const missing = [...existingCodes].filter((c) => !(c in input.text));
  console.log(`Imported ${rows.length} of ${existingCodes.size} codes for ${input.source}:${input.parentId}.`);
  if (missing.length > 0) {
    console.log(`Not yet supplied: ${missing.join(', ')}`);
  }
}

main();
