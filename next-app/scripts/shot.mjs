// Browser check of a page on the LOCAL dev server: signs in as a local leader, opens the page at desktop and phone
// widths, runs optional steps, saves screenshots, and reports console errors and failed requests.
//
//   node scripts/shot.mjs /admin/health-forms?person=39
//   node scripts/shot.mjs /events/12 --anon                       (signed out)
//   node scripts/shot.mjs /admin/x --steps steps.json --widths 1280 --browser firefox --out <dir>
//
// Needs: local Supabase running (Docker), and `npx next dev -p 3012` in another shell (never alongside a build).
// Screenshots go to next-app/.shots/ (gitignored) unless --out is given; the script prints each file it wrote.
//
// Steps (JSON array, run in order on each width) — each item is one of:
//   { "click": "Show more…" }                    a button or link by its accessible name (exact)
//   { "click": "Edit note", "role": "button" }   …restricted to one role
//   { "fill": "Things we should know", "value": "text" }   a field by its label
//   { "wait": "From the family" }                until this text is visible
//   { "press": "Escape" }                        a key
//   { "shot": "after-edit" }                     a screenshot named <width>-after-edit.png
//   { "full": true }                             following shots are full-page
//
// Anything the steps write to the database stays written: put it back afterwards (see Agents memory, test data).
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, firefox } from 'playwright-core';
import { DEFAULT_PERSON, mintLogin } from './dev-login.mjs';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 ? argv[i + 1] : fallback;
};
const path = argv.find((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--')) ?? '/admin';
const port = Number(opt('port', 3012));
const widths = String(opt('widths', '1280,375')).split(',').map(Number);
const out = resolve(opt('out', new URL('../.shots', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')));
const steps = opt('steps') ? JSON.parse(readFileSync(opt('steps'), 'utf8')) : [];
const browserName = opt('browser', 'chrome');
const base = `http://localhost:${port}`;

async function serverUp() {
  try {
    const r = await fetch(`${base}/`, { redirect: 'manual' });
    return r.status > 0;
  } catch {
    return false;
  }
}

async function run() {
  if (!(await serverUp())) throw new Error(`Nothing is answering on ${base}. Start it: cd next-app && npx next dev -p ${port}`);
  mkdirSync(out, { recursive: true });
  const step = (m) => console.error(`· ${m}`);
  step(`launching ${browserName}`);
  const browser = browserName === 'firefox' ? await firefox.launch({ headless: true }) : await chromium.launch({ channel: 'chrome', headless: true });
  const problems = [];
  const written = [];
  let storageState;
  try {
    if (!flag('anon')) {
      step('minting a local sign-in');
      const login = await mintLogin({ personId: Number(opt('as', DEFAULT_PERSON)), nextPath: path, port });
      try {
        const ctx = await browser.newContext();
        ctx.setDefaultTimeout(60_000);
        const page = await ctx.newPage();
        step('signing in');
        await page.goto(login.link);
        await page.getByRole('button', { name: /^Continue/ }).click();
        await page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 60_000 });
        storageState = await ctx.storageState();
        await ctx.close();
      } finally {
        await login.cleanup();
      }
    }
    for (const width of widths) {
      const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 812 : 900 }, storageState });
      ctx.setDefaultTimeout(60_000);
      const page = await ctx.newPage();
      page.on('console', (m) => m.type() === 'error' && problems.push(`[${width}] console: ${m.text()}`));
      page.on('pageerror', (e) => problems.push(`[${width}] page error: ${e.message}`));
      page.on('response', (r) => r.status() >= 500 && problems.push(`[${width}] ${r.status()} ${r.url()}`));
      step(`opening ${path} at ${width}px`);
      await page.goto(`${base}${path}`, { waitUntil: 'load', timeout: 120_000 });
      let fullPage = flag('full');
      const shoot = async (name) => {
        const file = resolve(out, `${width}-${name}.png`);
        // caret 'initial': Playwright's default hides the caret with an injected style, which React reports as a hydration mismatch.
        await page.screenshot({ path: file, fullPage, caret: 'initial' });
        written.push(file);
      };
      await shoot('page');
      for (const s of steps) {
        if (s.full !== undefined) fullPage = !!s.full;
        else if (s.click) await (s.role ? page.getByRole(s.role, { name: s.click, exact: true }) : page.getByRole('button', { name: s.click, exact: true }).or(page.getByRole('link', { name: s.click, exact: true }))).first().click();
        else if (s.fill) await page.getByLabel(s.fill, { exact: true }).fill(String(s.value ?? ''));
        else if (s.wait) await page.getByText(s.wait).first().waitFor({ timeout: 60_000 });
        else if (s.press) await page.keyboard.press(s.press);
        else if (s.shot) {
          await page.waitForTimeout(300);
          await shoot(s.shot);
        } else throw new Error(`Unknown step: ${JSON.stringify(s)}`);
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  for (const f of written) console.log(f);
  console.log(problems.length ? `\n${problems.length} problem(s):\n${problems.join('\n')}` : '\nNo console errors or 5xx responses.');
}

run().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
