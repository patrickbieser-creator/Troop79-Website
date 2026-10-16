import { adminClient } from './admin-client';

/**
 * A throwaway wreath sale for the db tests: its own year, three items, two sellers, fixed cutoffs. Everything is
 * created under the test sale's id and removed through it (orders and lines first, then the sale, which cascades
 * to items and sellers), so no test depends on, or leaves behind, the real 2026 sale (db-test-fixture-hygiene).
 *
 * Sellers point at two EXISTING active scouts' people rows — the fixture only ever inserts wreath_* rows.
 */
export const R1 = '2026-10-26T04:59:00.000Z'; // Sun Oct 25 23:59 CDT
export const R2 = '2026-11-16T05:59:00.000Z'; // Sun Nov 15 23:59 CST
export const NOW_R1 = Date.parse('2026-10-20T15:00:00.000Z');
export const NOW_R2 = Date.parse('2026-11-02T15:00:00.000Z');
export const NOW_AFTER = Date.parse('2026-11-20T15:00:00.000Z');

export interface WreathFixture {
  saleId: number;
  year: number;
  item: { w20: number; w36: number; easel: number };
  /** catalog numbers used by the fixture items */
  cat: { w20: number; w36: number; easel: number };
  sellerA: { personId: number; slug: string; first: string; last: string };
  sellerB: { personId: number; slug: string; first: string; last: string };
  cleanup: () => Promise<void>;
}

export async function makeWreathFixture(status: 'draft' | 'open' | 'closed' = 'open'): Promise<WreathFixture> {
  const admin = adminClient();
  const year = 3000 + Math.floor(Math.random() * 6000);
  const { data: sale, error } = await admin
    .from('wreath_sales')
    .insert({ year, status, round1_cutoff: R1, round2_cutoff: R2, distribution_date: '2026-11-21', distribution_window: '2:30 to 4:30 PM', distribution_place: 'Test lot' })
    .select('id')
    .single();
  if (error || !sale) throw new Error(`fixture sale: ${error?.message}`);
  const saleId = sale.id as number;

  const items = [
    { catalog_number: 1, name: 'Wreath', size: '20″', price: 26, unit_cost: 16.07, donatable: true },
    { catalog_number: 3, name: 'Wreath', size: '36″', price: 42, unit_cost: 27.87, donatable: false },
    { catalog_number: 15, name: 'Easel', size: '30″', price: 10, unit_cost: 5.85, donatable: false }
  ].map((i, n) => ({ ...i, sale_id: saleId, sort_order: n }));
  const { data: itemRows, error: ie } = await admin.from('wreath_items').insert(items).select('id, catalog_number');
  if (ie || !itemRows) throw new Error(`fixture items: ${ie?.message}`);
  const idOf = (c: number) => (itemRows as { id: number; catalog_number: number }[]).find((r) => r.catalog_number === c)!.id;

  const { data: scouts } = await admin
    .from('scouts')
    .select('person_id, first_name, last_name')
    .eq('active', true)
    .not('person_id', 'is', null)
    .order('person_id')
    .limit(2);
  const [a, b] = (scouts ?? []) as { person_id: number; first_name: string; last_name: string }[];
  if (!a || !b) throw new Error('fixture needs two active scouts with people rows');
  const sellers = [
    { sale_id: saleId, person_id: a.person_id, slug: 'vitest-a' },
    { sale_id: saleId, person_id: b.person_id, slug: 'vitest-b' }
  ];
  const { error: se } = await admin.from('wreath_sellers').insert(sellers);
  if (se) throw new Error(`fixture sellers: ${se.message}`);

  return {
    saleId,
    year,
    item: { w20: idOf(1), w36: idOf(3), easel: idOf(15) },
    cat: { w20: 1, w36: 3, easel: 15 },
    sellerA: { personId: a.person_id, slug: 'vitest-a', first: a.first_name, last: a.last_name },
    sellerB: { personId: b.person_id, slug: 'vitest-b', first: b.first_name, last: b.last_name },
    cleanup: async () => {
      // Audit rows the admin actions wrote about THIS sale's rows (test-owned ids only), then the rows themselves.
      const ids = async (table: string) =>
        ((await admin.from(table).select('id').eq('sale_id', saleId)).data ?? []).map((r) => String((r as { id: number }).id));
      const orderIdStrings = await ids('wreath_orders');
      const audited: [string, string[]][] = [
        ['wreath_order', orderIdStrings],
        ['wreath_seller', await ids('wreath_sellers')],
        ['wreath_item', await ids('wreath_items')],
        ['wreath_sale', [String(saleId)]]
      ];
      for (const [type, entityIds] of audited) {
        if (entityIds.length) await admin.from('audit_log').delete().eq('area', 'wreaths').eq('entity_type', type).in('entity_id', entityIds);
      }
      // Ledger rows Mark paid booked for THIS sale's orders (the FK is ON DELETE RESTRICT — a paid order's money is real).
      const orderIds = orderIdStrings.map(Number);
      if (orderIds.length) await admin.from('financial_transactions').delete().in('wreath_order_id', orderIds);
      await admin.from('wreath_orders').delete().eq('sale_id', saleId);
      await admin.from('wreath_sales').delete().eq('id', saleId);
    }
  };
}
