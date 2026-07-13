/**
 * True when pointed at the local Docker Supabase instance rather than the
 * hosted production database. Driven by the actual DB target (not
 * NODE_ENV) so it stays correct even for a local production build.
 */
export const IS_DEV_DB = /127\.0\.0\.1|localhost/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '');
