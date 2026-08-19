import { requireCapability } from '@/lib/require-capability';
import { createAdminClient } from '@/lib/supabase/server';
import { centralToday } from '@/lib/dates';
import { loadScoutbookExport, formatScoutbookFile } from '@/lib/scoutbook-export';

// Same legacy-check-never-converted bug as ../page.tsx — see that file's
// header comment. Route Handlers have no error.tsx boundary, so a refusal
// here surfaces as an uncaught-error 500, same as court-of-honor/export/route.ts.
export async function GET(request: Request) {
  await requireCapability('advancement.write');

  const url = new URL(request.url);
  const today = centralToday();
  const from = url.searchParams.get('from') || today;
  const to = url.searchParams.get('to') || today;

  const supabase = createAdminClient();
  const { rows } = await loadScoutbookExport(supabase, from, to);
  const body = formatScoutbookFile(rows);

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="troop79-scoutbook-advancement-${from}-to-${to}.txt"`
    }
  });
}
