import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { adminClient } from './helpers/admin-client';
import { makeWreathFixture, NOW_R1, type WreathFixture } from './helpers/wreath-fixture';
import { placeOrder } from '../src/lib/wreaths/place-order';
import { loadConfirmation, loadCurrentSale, loadStoreItems, resolveScoutLink } from '../src/lib/wreaths/public';
import { customerConfirmationEmail, scoutNoticeEmail } from '../src/lib/wreaths/emails';

/**
 * Wreath sale, Release A — what the public may see (Plans/Wreath-Sale.md, Privacy): no customer address, phone
 * or email on any public loader, a scout shown as first name + last initial only, a confirmation page keyed by an
 * unguessable token, and tables the API roles cannot touch.
 */
const admin = adminClient();
let fx: WreathFixture;
let orderToken = '';
let orderNumber = '';
let orderId = 0;
const PHONE = '414-555-0187';
const STREET = '2814 N Privacy Ave';
const EMAIL = 'private.buyer@example.test';

function localSql(sql: string): string {
  const cfg = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(cfg)?.[1] ?? 'next-app';
  const container = process.env.SUPABASE_DB_CONTAINER ?? `supabase_db_${projectId}`;
  return execFileSync('docker', ['exec', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-tAc', sql], { encoding: 'utf8' }).trim();
}

beforeAll(async () => {
  fx = await makeWreathFixture('open');
  const res = await placeOrder(
    {
      idempotencyKey: `vitest-public-${Date.now()}`,
      sellerSlug: fx.sellerA.slug,
      lines: [{ itemId: fx.item.w20, quantity: 2, donated: false }],
      gift: 5,
      coverFee: false,
      fulfillment: 'scout',
      customer: { name: 'Pat Privacy', email: EMAIL, phone: PHONE, street: STREET, city: 'Milwaukee', zip: '53211' },
      outsideAreaRelative: false,
      startedAt: NOW_R1 - 120_000,
      mountedAt: NOW_R1 - 60_000,
      website: ''
    },
    { supabase: admin, now: () => NOW_R1, ip: '10.8.0.1', send: vi.fn(async () => ({ status: 'sent', to: [] })), householdEmails: async () => [], siteUrl: 'https://wreaths.test', replyTo: 'troop@example.test', saleId: fx.saleId }
  );
  if (!res.ok) throw new Error(res.error);
  orderToken = res.token;
  orderNumber = res.orderNumber;
  orderId = (await admin.from('wreath_orders').select('id').eq('public_token', res.token).single()).data!.id;
});
afterAll(async () => {
  await fx.cleanup();
});

describe('public loaders', () => {
  it('PublicLoaders_NeverReturnCustomerPii_OrScoutSurname', async () => {
    const sale = await loadCurrentSale(admin, fx.saleId);
    const items = await loadStoreItems(admin, fx.saleId);
    const link = await resolveScoutLink(admin, fx.saleId, fx.sellerA.slug);
    const confirmation = await loadConfirmation(admin, orderToken);
    const everything = JSON.stringify({ sale, items, link, confirmation });
    for (const secret of [PHONE, STREET, EMAIL, 'Privacy', fx.sellerA.last, '16.07', 'unit_cost', 'unitCost', 'created_ip', 'idempotency']) {
      expect(everything, `leaked ${secret}`).not.toContain(secret);
    }
    // The scout reads as first name + last initial.
    expect(link).toMatchObject({ slug: fx.sellerA.slug, name: `${fx.sellerA.first} ${fx.sellerA.last[0]}.` });
    expect(items.map((i) => i.catalogNumber)).toEqual([1, 3, 15]);
  });

  it('PublicLoaders_SelectNoCustomerColumn_InTheirSource', () => {
    const src = readFileSync(new URL('../src/lib/wreaths/public.ts', import.meta.url), 'utf8');
    for (const col of ['customer_email', 'customer_phone', 'customer_address', 'customer_zip', 'customer_city', 'created_ip', 'unit_cost']) {
      expect(src, `public.ts mentions ${col}`).not.toContain(col);
    }
  });

  it('ConfirmationPage_RequiresUnguessableToken_AndOmitsAddressPhone', async () => {
    expect(await loadConfirmation(admin, orderNumber)).toBeNull();
    expect(await loadConfirmation(admin, String(orderId))).toBeNull();
    expect(await loadConfirmation(admin, '00000000-0000-4000-8000-000000000000')).toBeNull();
    expect(await loadConfirmation(admin, "'; drop table wreath_orders; --")).toBeNull();
    expect(await loadConfirmation(admin, '')).toBeNull();
    const c = await loadConfirmation(admin, orderToken);
    expect(c).toMatchObject({ orderNumber, firstName: 'Pat', paymentStatus: 'unpaid', fulfillment: 'scout', total: 57, gift: 5 });
    expect(c?.scoutName).toBe(`${fx.sellerA.first} ${fx.sellerA.last[0]}.`);
    expect(c?.items).toEqual([{ label: '20″ Wreath', quantity: 2, donated: false, amount: 52 }]);
    expect(Object.keys(c ?? {})).not.toEqual(expect.arrayContaining(['phone']));
  });

  it('UnknownOrRetiredSlug_FallsBackWithoutLeakingExistence', async () => {
    await admin.from('wreath_sellers').update({ active: false }).eq('sale_id', fx.saleId).eq('slug', fx.sellerB.slug);
    const retired = await resolveScoutLink(admin, fx.saleId, fx.sellerB.slug);
    const unknown = await resolveScoutLink(admin, fx.saleId, 'never-existed');
    const malformed = await resolveScoutLink(admin, fx.saleId, 'Not A/Slug?');
    await admin.from('wreath_sellers').update({ active: true }).eq('sale_id', fx.saleId).eq('slug', fx.sellerB.slug);
    expect(retired).toBeNull();
    expect(unknown).toBeNull();
    expect(malformed).toBeNull();
    expect(retired).toEqual(unknown);
  });

  it('Customer_SeesGeneralStore_WhenScoutSlugUnknown', async () => {
    expect(await resolveScoutLink(admin, fx.saleId, 'nobody-x')).toBeNull();
    const items = await loadStoreItems(admin, fx.saleId);
    expect(items.length).toBeGreaterThan(0);
  });

  it('StoreItems_ListOnlyActiveItems', async () => {
    await admin.from('wreath_items').update({ active: false }).eq('id', fx.item.easel);
    const items = await loadStoreItems(admin, fx.saleId);
    await admin.from('wreath_items').update({ active: true }).eq('id', fx.item.easel);
    expect(items.map((i) => i.catalogNumber)).toEqual([1, 3]);
  });
});

describe('schema posture', () => {
  it('WreathTables_HaveRlsAndNoAnonGrants', async () => {
    const tables = ['wreath_sales', 'wreath_items', 'wreath_sellers', 'wreath_orders', 'wreath_order_lines'];
    const rls = localSql(`select tablename || '=' || rowsecurity from pg_tables where schemaname = 'public' and tablename like 'wreath\\_%' order by 1`).split('\n').filter(Boolean);
    expect(rls).toEqual([...tables].sort().map((t) => `${t}=true`));
    expect(Number(localSql(`select count(*) from pg_policies where schemaname = 'public' and tablename like 'wreath\\_%'`))).toBe(0);
    expect(Number(localSql(`select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name like 'wreath\\_%' and grantee in ('anon', 'authenticated')`))).toBe(0);
    // The order function is not callable from the API roles.
    expect(Number(localSql(`select count(*) from information_schema.routine_privileges where routine_schema = 'public' and routine_name = 'wreath_place_order' and grantee in ('anon', 'authenticated', 'PUBLIC')`))).toBe(0);

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) throw new Error('anon key env missing — is .env.local present?');
    const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    for (const table of tables) {
      // The fixture guarantees rows exist, so an empty result (or an error) proves RLS, not an empty table.
      const { data, error } = await anon.from(table).select('*').limit(1);
      if (error === null) expect(data ?? [], `${table} via anon`).toHaveLength(0);
    }
    const rpc = await anon.rpc('wreath_place_order', { p: {} });
    expect(rpc.error).not.toBeNull();
  });

  it('SeededSale_IsADraftWith19ItemsAnd28Sellers_AndNoTestScout', async () => {
    const { data: sale } = await admin.from('wreath_sales').select('id, status, round1_cutoff, round2_cutoff').eq('year', 2026).single();
    expect(sale?.status).toBe('draft');
    expect(new Date(sale!.round1_cutoff).toISOString()).toBe('2026-10-26T04:59:00.000Z');
    expect(new Date(sale!.round2_cutoff).toISOString()).toBe('2026-11-16T05:59:00.000Z');
    const items = await admin.from('wreath_items').select('catalog_number, donatable, image_url').eq('sale_id', sale!.id);
    expect(items.data).toHaveLength(19);
    expect(items.data!.filter((i) => i.donatable).map((i) => i.catalog_number).sort((a, b) => a - b)).toEqual([1, 2]);
    expect(items.data!.every((i) => String(i.image_url).startsWith('https://'))).toBe(true);
    const sellers = await admin.from('wreath_sellers').select('person_id, slug').eq('sale_id', sale!.id);
    expect(sellers.data).toHaveLength(28);
    // Charlie Walters (people.id 39) is the test scout: never in the seed.
    expect(sellers.data!.map((s) => s.person_id)).not.toContain(39);
  });
});

describe('emails', () => {
  const ctx = {
    orderNumber: 'W-1099',
    customerName: '<script>alert("x")</script>',
    items: [{ label: '20″ Wreath', quantity: 2, donated: false, amount: 52 }],
    itemsSubtotal: 52,
    deliveryFee: 0,
    feeCovered: 0,
    gift: 5,
    total: 57,
    arrival: 'Pick up on <b>Saturday</b>.',
    orderUrl: 'https://wreaths.test/wreaths/order/abc',
    changesBy: 'Saturday, October 25'
  };

  it('OrderEmailHtml_EscapesCustomerInput', () => {
    const { html, subject } = customerConfirmationEmail(ctx);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>Saturday</b>');
    expect(html).toContain('&lt;script&gt;');
    expect(subject).toContain('W-1099');
    expect(subject).not.toContain('<');
  });

  it('ConfirmationEmail_TellsTheCustomerHowToPayTheTreasurer_WithTheOrderNumber', () => {
    const { text } = customerConfirmationEmail(ctx);
    expect(text).toContain('W-1099');
    expect(text).toContain('https://venmo.com/u/Patrick-Bieser-1');
    expect(text).toContain('patrickbieser@gmail.com');
    expect(text).toContain('$57.00');
    expect(text).not.toMatch(/qr/i);
  });

  it('ScoutNoticeEmail_EscapesCustomerInput_AndNamesTheDelivery', () => {
    const { html, subject } = scoutNoticeEmail({ ...ctx, scoutFirstName: 'Ben', customerPhone: '414-555-0100', customerAddress: '<img src=x onerror=1> 1 Main St' });
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script>');
    expect(subject).toContain('Ben');
  });
});
