#!/usr/bin/env node
/**
 * BREAK GLASS — mint a sign-in code for a named person, straight against the
 * database (Plans/Unified-Identity-And-Capabilities.md Phase E,
 * Open Question 3).
 *
 * WHY A SCRIPT AND NOT A WEB PATH. Once LEADER_PASSWORD retires, a lost phone
 * plus a broken mailer is otherwise unrecoverable. The obvious fix — an
 * env-gated emergency password on /admin — is a permanently-live endpoint on
 * the public internet guarding total access. This needs database credentials
 * that only the site owner holds, adds ZERO web-facing attack surface, and
 * reuses login_tokens unchanged.
 *
 * It prints a code and a link. It does NOT send email: the whole point is
 * that it works when email doesn't.
 *
 * Usage, from next-app/:
 *   node scripts/break-glass.mjs --list
 *   node scripts/break-glass.mjs --person "Patrick B"
 *   node scripts/break-glass.mjs --person-id 82
 *
 * Reads .env.local by default. To target production, point the Supabase env
 * vars at it explicitly for the one invocation — deliberately not a flag, so
 * nobody reaches production by muscle memory.
 */

import { createClient } from '@supabase/supabase-js';

const TTL_MINUTES = 30; // longer than the 15-minute email flow: someone is
                        // reading this down a phone line.

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

try {
  process.loadEnvFile('.env.local');
} catch {
  // Fine — the vars may already be in the environment.
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const pepper = process.env.IDENTITY_TOKEN_PEPPER;
if (!url || !key) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  process.exit(1);
}
if (!pepper) {
  console.error('IDENTITY_TOKEN_PEPPER must be set — it is what makes the code verifiable.');
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false }
});

async function sha256Hex(raw) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${raw}${pepper}`));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function randomHex(bytes) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomCode() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return String(a[0] % 1_000_000).padStart(6, '0');
}

async function eligiblePeople() {
  const [{ data: dir }, { data: members }] = await Promise.all([
    supabase.from('person_directory').select('person_id, display_name, tab'),
    supabase.from('household_members').select('person_id')
  ]);
  const inHousehold = new Set((members ?? []).map((m) => m.person_id));
  return (dir ?? []).filter((d) => inHousehold.has(d.person_id));
}

const listOnly = process.argv.includes('--list');
const wantName = arg('--person');
const wantId = arg('--person-id');

const people = await eligiblePeople();

if (listOnly || (!wantName && !wantId)) {
  console.log('\nPeople who can be issued a sign-in code:\n');
  for (const p of people.sort((a, b) => a.display_name.localeCompare(b.display_name))) {
    console.log(`  ${String(p.person_id).padStart(5)}  ${p.display_name}${p.tab === 'active_scout' ? '  (scout)' : ''}`);
  }
  console.log('\nThen: node scripts/break-glass.mjs --person-id <id>\n');
  process.exit(0);
}

let target = null;
if (wantId) {
  target = people.find((p) => String(p.person_id) === String(wantId)) ?? null;
} else {
  const needle = wantName.trim().toLowerCase();
  const matches = people.filter((p) => p.display_name.toLowerCase().includes(needle));
  if (matches.length > 1) {
    console.error(`"${wantName}" matches ${matches.length} people — use --person-id:`);
    for (const m of matches) console.error(`  ${m.person_id}  ${m.display_name}`);
    process.exit(1);
  }
  target = matches[0] ?? null;
}

if (!target) {
  console.error('No eligible person matched. Run with --list to see the options.');
  process.exit(1);
}

const rawToken = randomHex(16);
const rawCode = randomCode();
const { error } = await supabase.from('login_tokens').insert({
  person_id: target.person_id,
  channel: 'email',
  sent_to: 'break-glass (issued by hand)',
  token_hash: await sha256Hex(rawToken),
  code_hash: await sha256Hex(rawCode),
  expires_at: new Date(Date.now() + TTL_MINUTES * 60_000).toISOString(),
  // Audit: this is the column that says a human issued it rather than the app.
  created_by_leader: 'break-glass script'
});
if (error) {
  console.error('Could not create the token:', error.message);
  process.exit(1);
}

// Found the hard way 2026-08-16: the web app's sign-in email had this exact
// bug — a silent `|| 'http://localhost:3000'` fallback — and it pointed at
// localhost in production for over a week with no server-side trace,
// because a link to localhost never reaches production logs at all. This
// script is a bad place to repeat that guess: it's read down a phone line
// or texted to someone locked out, at exactly the moment a broken link is
// least likely to be caught before it's used. Local dev (the common case —
// .env.local's Supabase URL is the local Docker stack) still needs no
// configuration; production only reaches this branch when the operator has
// already pointed the Supabase vars at it on purpose (this file's own
// header), and at that point guessing wrong is worse than refusing.
let site = process.env.NEXT_PUBLIC_SITE_URL;
if (!site) {
  if (url.includes('127.0.0.1') || url.includes('localhost')) {
    site = 'http://localhost:3000';
  } else {
    console.error(
      'NEXT_PUBLIC_SITE_URL must be set when pointing this script at production — ' +
        'otherwise the printed link is unusable. Set it to https://www.troop-79.com ' +
        'for this one invocation.'
    );
    process.exit(1);
  }
}
console.log(`
  Person : ${target.display_name} (${target.person_id})
  Code   : ${rawCode}
  Link   : ${site}/signin/verify?token=${rawToken}
  Expires: ${TTL_MINUTES} minutes

  Read the code aloud, or send the link. Single use, and redeeming it
  invalidates every other outstanding token for this person.
`);
