/**
 * Nightly: back up the LIVE production Troop 79 database, then — only when no schema
 * change is in flight — mirror production's data into the local dev Docker database.
 *
 *   node scripts/backup-prod.mts              # backup + sync (the scheduled job)
 *   node scripts/backup-prod.mts --no-sync    # backup only
 *   npm run backup:prod                      # same as the first line
 *
 * Options: --dir (backup root, default D:\Projects\Backups), --project (folder + file
 * prefix, default troop79), --container (local Postgres container, default
 * supabase_db_next-app), --keep (dumps to retain, default 30), --no-sync.
 *
 * Scheduled by Pen-Vision's scripts/register-backup-task.ps1 as the second action of
 * the "Pen-Vision Backup" task (daily 07:00, runs at next wake if missed). Same shape as
 * Pen-Vision's scripts/backup.ts: pg_dump runs INSIDE the local Postgres container (its
 * pg_dump 17.x matches the hosted server), nothing is installed on Windows, and the dump
 * is plain SQL with a DROP TABLE header so restoring into a fresh instance is one psql
 * command. Runs on Node's native TypeScript support; no build step, no dependencies.
 *
 * 1. BACKUP  pg_dump of production's `public` + `supabase_migrations` schemas (schema +
 *    data) → D:\Projects\Backups\troop79\troop79_YYYY-MM-DD_HH-MM.sql. Newest --keep
 *    kept; backup.log beside them. This is the disaster-recovery copy of the live site.
 *    The file holds every family's PII — it is outside the repo on purpose; do not
 *    move it anywhere that syncs off the machine without encryption.
 *
 * 2. GATE  the sync is SKIPPED (backup still made, exit 0) when any of these holds:
 *      - a migration file under supabase/migrations is not applied on production
 *        (written but not yet `db push`ed), or production has one the checkout lacks;
 *      - the local DB's applied migrations differ from production's (local is ahead
 *        or behind — a data-only load into a different shape fails or lies);
 *      - `git status` shows edits or untracked files under supabase/migrations
 *        (a migration is being authored right now);
 *      - a Troop79 `next dev` or `vitest` process is running (concurrent Claude
 *        sessions share this DB; truncating it mid-test-run would break the run).
 *
 * 3. SYNC  a second, data-only pg_dump of production is handed to the existing
 *    scripts/refresh-local-from-prod.sh (D-207) via --from=. That script truncates the
 *    dumped tables locally, loads with triggers and FK checks off
 *    (session_replication_role = replica), resets every sequence, and verifies row
 *    counts. On success the data dump is deleted (the step-1 file already holds the
 *    data); on failure it is kept under next-app/backups/ so the refresh can be rerun
 *    with --from= once the cause is fixed.
 *
 * Never writes to production. Never runs `db reset` (memory: never-reset-local-supabase).
 * Password: SUPABASE_DB_PASSWORD in next-app/.env.local, passed to the container as an
 * inherited env var (never on a command line, never logged).
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

// ── Config ────────────────────────────────────────────────────────────────

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
) as Record<string, string>;

const project = args.project ?? "troop79";
const container = args.container ?? "supabase_db_next-app";
const root = args.dir ?? "D:\\Projects\\Backups";
const keep = Math.max(1, Number(args.keep ?? 30));
const doSync = args["no-sync"] !== "true";

const PROD_REF = "qyovupepjdxikyepieps";
const PROD_URL = `postgresql://postgres.${PROD_REF}@aws-1-us-east-2.pooler.supabase.com:5432/postgres`;

const appRoot = resolve(dirname(resolve(process.argv[1])), "..");
const repoRoot = resolve(appRoot, "..");
const migrationsDir = join(appRoot, "supabase", "migrations");
const refreshScript = join(appRoot, "scripts", "refresh-local-from-prod.sh");
const gitBash = "C:\\Program Files\\Git\\bin\\bash.exe";

const dir = join(root, project);
mkdirSync(dir, { recursive: true });
const log = join(dir, "backup.log");

function record(line: string): void {
  appendFileSync(log, `${new Date().toISOString()} ${line}\n`);
  console.log(line);
}

function fail(reason: string): never {
  record(`FAIL ${reason}`);
  process.exit(1);
}

function firstLine(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).split("\n")[0];
}

// Local time, so the filename matches the clock on the wall: 2026-09-07_07-00
const now = new Date();
const pad = (n: number) => String(n).padStart(2, "0");
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;

// ── Password (from next-app/.env.local; never logged) ─────────────────────

function readDbPassword(): string {
  const envFile = join(appRoot, ".env.local");
  if (!existsSync(envFile)) fail(`${envFile} not found`);
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/);
    if (m) return m[1].trim().replace(/^"(.*)"$/, "$1");
  }
  return fail("SUPABASE_DB_PASSWORD is not set in next-app/.env.local");
}

// ── Docker helpers ────────────────────────────────────────────────────────

function docker(cmd: string[], opts: { pgPassword?: string; timeoutMs?: number } = {}): string {
  return execFileSync("docker", cmd, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 1024,
    timeout: opts.timeoutMs ?? 10 * 60 * 1000,
    // stderr is captured, not inherited: pg_dump --data-only always warns about the
    // people ↔ households circular FK (the refresh script loads with FK checks off, so
    // it's moot). On a non-zero exit the captured stderr still lands in the error message.
    stdio: ["ignore", "pipe", "pipe"],
    // `-e PGPASSWORD` (no value) tells docker to copy the variable from THIS process's
    // environment, so the secret never appears in a command line.
    env: opts.pgPassword ? { ...process.env, PGPASSWORD: opts.pgPassword } : process.env,
  });
}

function containerRunning(): boolean {
  try {
    return docker(["ps", "--format", "{{.Names}}"]).split(/\r?\n/).includes(container);
  } catch {
    return false;
  }
}

function pgDumpProd(pw: string, extra: string[]): string {
  return docker(
    ["exec", "-e", "PGPASSWORD", container, "pg_dump", PROD_URL, "--no-owner", "--no-privileges", ...extra],
    { pgPassword: pw },
  );
}

function psqlProd(pw: string, sql: string): string[] {
  return docker(["exec", "-e", "PGPASSWORD", container, "psql", PROD_URL, "-At", "-c", sql], { pgPassword: pw })
    .split(/\r?\n/)
    .filter(Boolean);
}

function psqlLocal(sql: string): string[] {
  return docker(["exec", container, "psql", "-U", "postgres", "-d", "postgres", "-At", "-c", sql])
    .split(/\r?\n/)
    .filter(Boolean);
}

// ── 1. Backup ─────────────────────────────────────────────────────────────

if (!containerRunning()) {
  fail(`local Postgres container ${container} is not running (pg_dump runs inside it). Is Docker up? Start it with: npx supabase start`);
}
const pw = readDbPassword();

let sql = "";
try {
  sql = pgDumpProd(pw, ["-n", "public", "-n", "supabase_migrations"]);
} catch (e) {
  fail(`pg_dump of production failed: ${firstLine(e)}`);
}

// Same restore-friendliness as Pen-Vision's backup.ts: drop each dumped table outright
// (policies, indexes, constraints go with it) so the file loads into an existing
// instance or a brand-new one, and don't trip on schemas every instance already has.
sql = sql.replace(/^CREATE SCHEMA (\S+);/gm, "CREATE SCHEMA IF NOT EXISTS $1;");
const tables = [...sql.matchAll(/^CREATE TABLE (\S+\.\S+) \(/gm)].map((m) => m[1]);
if (tables.length < 10) fail(`dump contains only ${tables.length} tables; refusing to keep it.`);
const file = join(dir, `${project}_${stamp}.sql`);
const header =
  `-- ${project} PRODUCTION backup (${PROD_REF}), ${now.toString()}\n` +
  `-- Contains real family PII. Restore: docker exec -i <container> psql -U postgres -d postgres -v ON_ERROR_STOP=1 < <this file>\n` +
  tables.map((t) => `DROP TABLE IF EXISTS ${t} CASCADE;`).join("\n") +
  "\n\n";
writeFileSync(file, header + sql);
const kb = Math.round(statSync(file).size / 1024);

const dumps = readdirSync(dir).filter((f) => f.startsWith(`${project}_`) && f.endsWith(".sql")).sort();
const stale = dumps.slice(0, Math.max(0, dumps.length - keep));
for (const f of stale) unlinkSync(join(dir, f));
record(`OK backup ${file} (${kb} KB, ${tables.length} tables)${stale.length ? `, pruned ${stale.length} older` : ""}`);

if (!doSync) {
  record("SKIP sync --no-sync");
  process.exit(0);
}

// ── 2. Gate: is a schema change in process? ───────────────────────────────

function versionsOnDisk(): Set<string> {
  return new Set(
    readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.match(/^(\d+)_/)?.[1])
      .filter((v): v is string => !!v),
  );
}

function diff(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter((v) => !b.has(v)).sort();
}

function migrationsDirty(): string[] {
  const out = execFileSync("git", ["-C", repoRoot, "status", "--porcelain", "--", "next-app/supabase/migrations"], {
    encoding: "utf8",
    timeout: 60 * 1000,
  });
  return out.split(/\r?\n/).filter(Boolean);
}

// Troop79's own `next dev` / vitest processes (their command lines carry the repo path);
// other projects' dev servers don't touch this database and are ignored.
function troop79Busy(): string[] {
  try {
    const out = execFileSync(
      "powershell",
      ["-NoProfile", "-Command", "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Select-Object -ExpandProperty CommandLine"],
      { encoding: "utf8", timeout: 60 * 1000 },
    );
    return out
      .split(/\r?\n/)
      .filter((l) => /Troop79-Website/i.test(l) && /vitest|next[\\/ ]dev|next[\\/]dist[\\/](bin[\\/]next|server)/i.test(l))
      .filter((l) => !/backup-prod\.ts/.test(l))
      .map((l) => l.trim().slice(0, 120));
  } catch {
    return [];
  }
}

const reasons: string[] = [];
try {
  const onDisk = versionsOnDisk();
  const prodApplied = new Set(psqlProd(pw, "select version from supabase_migrations.schema_migrations"));
  const localApplied = new Set(psqlLocal("select version from supabase_migrations.schema_migrations"));

  const unpushed = diff(onDisk, prodApplied);
  if (unpushed.length) reasons.push(`migration file(s) not applied on production: ${unpushed.join(", ")}`);
  const notInCheckout = diff(prodApplied, onDisk);
  if (notInCheckout.length) reasons.push(`production has migration(s) missing from this checkout: ${notInCheckout.join(", ")}`);
  const localAhead = diff(localApplied, prodApplied);
  if (localAhead.length) reasons.push(`local DB is ahead of production: ${localAhead.join(", ")}`);
  const localBehind = diff(prodApplied, localApplied);
  if (localBehind.length) reasons.push(`local DB is behind production (run: npx supabase migration up): ${localBehind.join(", ")}`);

  const dirty = migrationsDirty();
  if (dirty.length) reasons.push(`uncommitted changes under supabase/migrations: ${dirty.join("; ")}`);

  const busy = troop79Busy();
  if (busy.length) reasons.push(`Troop79 dev server or test run active: ${busy.join(" | ")}`);
} catch (e) {
  reasons.push(`gate check failed, not syncing: ${firstLine(e)}`);
}

if (reasons.length) {
  record(`SKIP sync — ${reasons.join("; ")}`);
  process.exit(0);
}

// ── 3. Sync production → local via the existing refresh script ────────────

let data = "";
try {
  data = pgDumpProd(pw, ["--data-only", "-n", "public"]);
} catch (e) {
  fail(`sync: data-only pg_dump of production failed: ${firstLine(e)}`);
}
if (!/^COPY public\./m.test(data)) fail("sync: data dump has no COPY blocks; refusing to load it.");

const dataDir = join(appRoot, "backups"); // gitignored — real family PII
mkdirSync(dataDir, { recursive: true });
const dataFileRel = `backups/prod-data-${stamp.replace(/[-_]/g, "")}.sql`;
const dataFile = join(appRoot, dataFileRel);
// The refresh script loads with triggers + FK checks off; it prepends this line itself
// if missing, but being explicit keeps the file self-describing.
writeFileSync(dataFile, `SET session_replication_role = replica;\n${data}`);

const bash = existsSync(gitBash) ? gitBash : "bash";
const run = spawnSync(bash, [refreshScript, `--from=${dataFileRel}`], {
  cwd: appRoot,
  encoding: "utf8",
  maxBuffer: 256 * 1024 * 1024,
  timeout: 15 * 60 * 1000,
  env: { ...process.env, MSYS_NO_PATHCONV: "1" },
});
const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
const syncLog = join(dir, `sync_${stamp}.log`);
writeFileSync(syncLog, output);

if (run.status === 0) {
  unlinkSync(dataFile);
  const summary = output.split(/\r?\n/).find((l) => l.startsWith("✓")) ?? "refresh script reported success";
  record(`OK sync ${summary.replace(/ Dump kept at .*$/, "")} (log: ${syncLog})`);
} else {
  const tail = output.trim().split(/\r?\n/).slice(-3).join(" / ");
  fail(`sync: refresh-local-from-prod.sh exited ${run.status ?? "signal"} — ${tail}. Data dump kept at ${dataFile}; rerun with: npm run refresh-local-from-prod -- --from=${dataFileRel}`);
}
