import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { FinanceWorkspace } from '../src/app/admin/(workspace)/finance/finance-workspace';
import { financeModalFromParam } from '../src/app/admin/(workspace)/finance/finance-do';
import { FEATURES, hrefPath } from '../src/app/admin/(workspace)/_components/feature-registry';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/admin/finance'
}));

/**
 * Plans/Admin-Portal-Nav.md phase 2: every Actions ▾ item and buried tab opens straight from a link, so the menus,
 * search and A–Z can go to the task itself. The existing page reads the parameter and opens what it opens today.
 */

beforeAll(() => {
  // jsdom has no <dialog> modal API.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});

function renderLedger(initialModal: Parameters<typeof FinanceWorkspace>[0]['initialModal'], canManage = true) {
  return render(
    <FinanceWorkspace
      canManage={canManage}
      rows={[]}
      people={[]}
      reconciliation={[]}
      sort="date"
      dir="desc"
      filters={{}}
      buckets={[]}
      kinds={[]}
      initialModal={initialModal}
    />
  );
}

describe('finance ?do=', () => {
  it('FinanceDoReconcile_OpensReconcileDialog', () => {
    renderLedger(financeModalFromParam('reconcile', true));
    expect(screen.getByRole('heading', { name: 'Monthly reconciliation' })).toBeTruthy();
  });

  it('FinanceDoRecord_OpensRecordDialog', () => {
    renderLedger(financeModalFromParam('record', true));
    expect(screen.getByRole('heading', { name: 'Record a transaction' })).toBeTruthy();
  });

  it('FinanceNoDo_OpensNoDialog', () => {
    renderLedger(null);
    expect(screen.queryByRole('heading', { name: 'Monthly reconciliation' })).toBeNull();
  });

  it('UnknownDoParam_IsIgnored', () => {
    expect([financeModalFromParam('delete-everything', true), financeModalFromParam('', true), financeModalFromParam(undefined, true)]).toEqual([
      null,
      null,
      null
    ]);
  });

  it('DoParam_IgnoredWithoutFinanceManage', () => {
    expect(financeModalFromParam('record', false)).toBeNull();
  });

  it('DoParam_TakesTheFirstOfRepeatedValues', () => {
    expect(financeModalFromParam(['transfer', 'record'], true)).toBe('transfer');
  });
});

/** Every source file under an admin route's folder, as one string. */
function routeSource(path: string): string {
  const rel = path.replace(/^\/admin\/?/, '');
  const dir = join(__dirname, '..', 'src', 'app', 'admin', '(workspace)', ...rel.split('/').filter(Boolean));
  const read = (d: string): string =>
    readdirSync(d)
      .map((n) => join(d, n))
      .map((p) => (statSync(p).isDirectory() ? read(p) : /\.(tsx?|ts)$/.test(p) ? readFileSync(p, 'utf8') : ''))
      .join('\n');
  return read(dir);
}

describe('registry deep links', () => {
  it('Registry_DeepLinkParams_AreKnownToTheirPages', () => {
    // A ?tab= / ?do= / ?card= value the target page has never heard of opens its default view: a silent dead link.
    const unknown: string[] = [];
    for (const f of FEATURES) {
      const q = f.href.split('?')[1];
      if (!q || !f.href.startsWith('/admin')) continue;
      const src = routeSource(hrefPath(f.href));
      for (const [k, v] of new URLSearchParams(q)) {
        if (!['tab', 'do', 'card'].includes(k)) unknown.push(`${f.key}: unexpected parameter ${k}`);
        else if (!src.includes(`'${v}'`)) unknown.push(`${f.key}: ${k}=${v}`);
      }
    }
    expect(unknown).toEqual([]);
  });

  it('WreathsTabRose_SelectsRoseTab', () => {
    expect(routeSource('/admin/finance/wreaths')).toMatch(/key: 'rose'/);
  });

  it('RosterAssignPatrols_HasItsOwnRoute', () => {
    expect(FEATURES.find((f) => f.key === 'people.patrols')?.href).toBe('/admin/advancement/roster/patrols');
  });
});
