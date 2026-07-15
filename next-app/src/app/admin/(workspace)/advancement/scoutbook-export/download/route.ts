import { cookies } from 'next/headers';
import { LEADER_COOKIE, verifySession } from '@/lib/leader-session';
import { createAdminClient } from '@/lib/supabase/server';
import { centralToday } from '@/lib/dates';
import { loadScoutbookExport, formatScoutbookFile } from '@/lib/scoutbook-export';

export async function GET(request: Request) {
  const jar = await cookies();
  const session = await verifySession(jar.get(LEADER_COOKIE.name)?.value);
  if (!session || session.role !== 'leader') {
    return new Response('Leaders only', { status: 403 });
  }

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
