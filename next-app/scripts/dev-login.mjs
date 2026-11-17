// Local-only sign-in for browser checks: mints a one-use login link for a person on the LOCAL database, the same way
// lib/identity-challenge does (sha256 of token + IDENTITY_TOKEN_PEPPER). Refuses to touch anything but a local Supabase.
//
//   node scripts/dev-login.mjs [--as <personId>] [--next </path>] [--port 3012]
//
// Prints only the link. Default person 82 = Patrick's leader row on the local mirror (66 is a duplicate without the
// leader roles). The token expires in 20 minutes; shot.mjs deletes its own as soon as it has signed in.
import { createHash, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export const DEFAULT_PERSON = 82;

export function localClient() {
  try {
    process.loadEnvFile(new URL('../.env.local', import.meta.url));
  } catch {
    throw new Error('next-app/.env.local is missing.');
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(url)) throw new Error('dev-login only runs against a LOCAL Supabase. NEXT_PUBLIC_SUPABASE_URL is not local.');
  if (!process.env.IDENTITY_TOKEN_PEPPER) throw new Error('IDENTITY_TOKEN_PEPPER is not set in .env.local.');
  return createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/** Mints a login link. Returns { link, raw, tokenId, cleanup } — call cleanup() once signed in. */
export async function mintLogin({ personId = DEFAULT_PERSON, nextPath = '/admin', port = 3012 } = {}) {
  const sb = localClient();
  const { data: person, error: pe } = await sb.from('people').select('id, display_name').eq('id', personId).maybeSingle();
  if (pe) throw new Error(`Local database not reachable: ${pe.message}. Is Docker / supabase running?`);
  if (!person) throw new Error(`No person ${personId} on the local database.`);
  // A run that was killed never cleaned up: clear every earlier dev-login token first.
  await sb.from('login_tokens').delete().eq('sent_to', 'dev-login@localhost.test');
  const raw = randomBytes(32).toString('base64url'); // the shape lib/identity-challenge mints (43 chars)
  const hash = (s) => createHash('sha256').update(`${s}${process.env.IDENTITY_TOKEN_PEPPER}`).digest('hex');
  const { data, error } = await sb
    .from('login_tokens')
    .insert({
      person_id: personId,
      channel: 'email',
      token_hash: hash(raw),
      code_hash: hash(`code-${raw}`),
      next_path: nextPath,
      expires_at: new Date(Date.now() + 20 * 60_000).toISOString(),
      sent_to: 'dev-login@localhost.test'
    })
    .select('id')
    .single();
  if (error) throw new Error(`Couldn't mint a login: ${error.message}`);
  return {
    link: `http://localhost:${port}/signin/verify?token=${raw}`,
    name: person.display_name,
    cleanup: async () => {
      await sb.from('login_tokens').delete().eq('id', data.id);
    }
  };
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('dev-login.mjs')) {
  mintLogin({ personId: Number(arg('as', DEFAULT_PERSON)), nextPath: arg('next', '/admin'), port: Number(arg('port', 3012)) })
    .then(({ link }) => console.log(link))
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
