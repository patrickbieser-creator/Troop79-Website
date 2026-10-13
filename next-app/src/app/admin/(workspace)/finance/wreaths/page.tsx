/**
 * /admin/finance/wreaths — the wreath sale's admin (Plans/Wreath-Sale.md, Release A): Orders, Rose order, Sellers,
 * Items and Settings. finance.manage only, here and on every action. The books (per-scout totals, cost and profit,
 * the 70/30 split) and Close sale come in Release C.
 */
import { requireCapability } from '@/lib/require-capability';
import { createAdminClient } from '@/lib/supabase/server';
import { fmtDay } from '@/lib/format-date';
import { loadAdminItems, loadAdminOrders, loadAdminSale, loadAdminSellers, loadOrderHistory, loadRoseOrder, loadSellerCandidates } from '@/lib/wreaths/admin-data';
import { PageTitle } from '../../_components/page-title';
import { PublicPageLink } from '../../../_components/public-page-link';
import { TabStrip } from '../../_components/tab-strip';
import { Badge } from '../../_components/badge';
import { Notice } from '../../_components/notice';
import { ItemsTable } from './items-table';
import { OrdersPanel } from './orders-panel';
import { SellersPanel } from './sellers-panel';
import { SettingsForm } from './settings-form';
import styles from './wreaths.module.css';

export const metadata = { title: 'Wreath Sale — Troop 79' };
export const dynamic = 'force-dynamic';

const TABS = ['orders', 'rose', 'sellers', 'items', 'settings'] as const;
type Tab = (typeof TABS)[number];

export default async function WreathSalePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireCapability('finance.manage');
  const { tab: raw } = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(raw ?? '') ? (raw as Tab) : 'orders';
  const sb = createAdminClient();
  const sale = await loadAdminSale(sb);

  if (!sale) {
    return (
      <>
        <PageTitle back={null} title="Wreath Sale" />
        <Notice variant="warning">There is no wreath sale set up yet.</Notice>
      </>
    );
  }

  const [orders, sellers] = await Promise.all([loadAdminOrders(sb, sale.id), loadAdminSellers(sb, sale.id)]);
  const placed = orders.filter((o) => o.status === 'placed');
  const unpaid = placed.filter((o) => o.paymentStatus === 'unpaid').length;

  return (
    <>
      <PageTitle
        back={null}
        title={`Wreath Sale ${sale.year}`}
        sub={
          <>
            Orders, who sells, and what to order from Rose. {sale.status === 'open' ? <Badge variant="success">Open</Badge> : sale.status === 'draft' ? <Badge variant="warning">Draft: the store isn’t open yet</Badge> : <Badge variant="muted">Closed</Badge>}{' '}
            Round 1 closes {fmtDay(sale.round1Cutoff)}; Round 2 closes {fmtDay(sale.round2Cutoff)}.
          </>
        }
      >
        <PublicPageLink href="/wreaths" draft={sale.status === 'draft'} />
      </PageTitle>
      <div className={styles.tabs}>
        <TabStrip
          ariaLabel="Wreath sale"
          activeKey={tab}
          items={[
            { key: 'orders', label: 'Orders', count: placed.length, href: '/admin/finance/wreaths' },
            { key: 'rose', label: 'Rose order', href: '/admin/finance/wreaths?tab=rose' },
            { key: 'sellers', label: 'Sellers', count: sellers.filter((s) => s.active).length, href: '/admin/finance/wreaths?tab=sellers' },
            { key: 'items', label: 'Items', href: '/admin/finance/wreaths?tab=items' },
            { key: 'settings', label: 'Settings', href: '/admin/finance/wreaths?tab=settings' }
          ]}
        />
      </div>

      {tab === 'orders' && (
        <>
          {unpaid > 0 && (
            <p className={styles.note}>
              {unpaid} order{unpaid === 1 ? ' is' : 's are'} not paid yet. Check Venmo and PayPal for the order number in the payment note, then open the order to mark it paid.
            </p>
          )}
          <OrdersPanel
            orders={orders}
            history={Object.fromEntries(await loadOrderHistory(sb, orders.map((o) => o.id)))}
            sellers={sellers.filter((s) => s.active).map((s) => ({ personId: s.personId, name: s.name }))}
            deliveryZipPrefix={sale.deliveryZipPrefix}
          />
        </>
      )}
      {tab === 'rose' && <RoseTable rows={await loadRoseOrder(sb, sale.id)} />}
      {tab === 'sellers' && <SellersPanel saleId={sale.id} sellers={sellers} candidates={await loadSellerCandidates(sb, sale.id)} />}
      {tab === 'items' && <ItemsTable items={await loadAdminItems(sb, sale.id)} />}
      {tab === 'settings' && <SettingsForm sale={sale} />}
    </>
  );
}

function RoseTable({ rows }: { rows: Awaited<ReturnType<typeof loadRoseOrder>> }) {
  const r1 = rows.reduce((n, r) => n + r.round1, 0);
  const r2 = rows.reduce((n, r) => n + r.round2, 0);
  return (
    <>
      <p className={styles.note}>
        Count per catalog number, donated wreaths included and cancelled orders left out. Round 1 is the initial order, sent after its cutoff. Round 2 is the changes, sent after the second cutoff.
      </p>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>No.</th>
              <th>Item</th>
              <th className={styles.numCell}>Round 1 (initial)</th>
              <th className={styles.numCell}>Round 2 (changes)</th>
              <th className={styles.numCell}>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className={styles.empty}>
                  Nothing to order yet. Counts appear here as orders come in.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.catalogNumber}>
                <td className={styles.mono}>{r.catalogNumber}</td>
                <td>
                  {r.size} {r.name}
                </td>
                <td className={styles.numCell}>{r.round1 || '—'}</td>
                <td className={styles.numCell}>{r.round2 || '—'}</td>
                <td className={styles.numCell}>{r.total}</td>
              </tr>
            ))}
            {rows.length > 0 && (
              <tr className={styles.totalRow}>
                <td />
                <td>All items</td>
                <td className={styles.numCell}>{r1}</td>
                <td className={styles.numCell}>{r2}</td>
                <td className={styles.numCell}>{r1 + r2}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
