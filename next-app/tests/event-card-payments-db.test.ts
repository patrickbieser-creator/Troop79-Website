import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { bucketIdsNow, deleteNewEmptyBuckets } from './helpers/bucket-cleanup';
import { createTestEvent, createTestScout, deleteTestEvent, deleteTestScout, type TestEvent, type TestScout } from './helpers/signup-fixtures';
import type { StripeEventLike, StripeLike } from '../src/lib/wreaths/card-payments';
import { cardLinesFor, closeOpenEventCheckouts, handleEventStripeEvent, loadPartyMoney, startEventCardCheckout } from '../src/lib/event-pay/card';

/**
 * Event fees by card against the real local database (lib/event-pay/card, 2026-11-13). Stripe is a fake at the
 * module edge: sessions open → expired / complete, idempotency keys return the same session, the PaymentIntent
 * carries the session's metadata and the settled fee.
 */
const admin = adminClient();
const EVT = () => `evt_vitest_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
const KEY = 'vitest-party';
let scouts: TestScout[] = [];
const events: TestEvent[] = [];
let bucketsBefore: Set<number>;

type FakeSession = { id: string; url: string; status: 'open' | 'expired' | 'complete'; amount_total: number; currency: string; client_reference_id: string; metadata: Record<string, string>; params: Record<string, unknown> };

function fakeStripe(opts: { fee?: number | null } = {}) {
  const sessions = new Map<string, FakeSession>();
  const byKey = new Map<string, FakeSession>();
  const piMeta = new Map<string, Record<string, string>>();
  let n = 0;
  const stripe: StripeLike & { sessions: typeof sessions } = {
    sessions,
    checkout: {
      sessions: {
        create: async (params, o) => {
          const hit = byKey.get(o.idempotencyKey);
          if (hit) return hit;
          n += 1;
          const items = params.line_items as { price_data: { unit_amount: number }; quantity: number }[];
          const s: FakeSession = {
            id: `cs_test_ev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${n}`,
            url: `https://checkout.stripe.test/ev/${n}`,
            status: 'open',
            amount_total: items.reduce((t, i) => t + i.price_data.unit_amount * i.quantity, 0),
            currency: 'usd',
            client_reference_id: String(params.client_reference_id),
            metadata: params.metadata as Record<string, string>,
            params
          };
          sessions.set(s.id, s);
          byKey.set(o.idempotencyKey, s);
          piMeta.set(`pi_test_${s.id}`, (params.payment_intent_data as { metadata: Record<string, string> }).metadata);
          return s;
        },
        retrieve: async (id) => {
          const s = sessions.get(id);
          if (!s) throw new Error('No such checkout.session');
          return s;
        },
        expire: async (id) => {
          const s = sessions.get(id);
          if (!s || s.status !== 'open') throw new Error('Only open sessions can be expired');
          s.status = 'expired';
          return s;
        }
      }
    },
    paymentIntents: {
      retrieve: async (id) => ({
        id,
        metadata: piMeta.get(id) ?? {},
        latest_charge: opts.fee === null ? { id: 'ch_x', balance_transaction: null } : { id: 'ch_x', balance_transaction: { fee: opts.fee ?? 146 } }
      })
    },
    balanceTransactions: { retrieve: async () => ({ fee: opts.fee ?? 146 }) },
    refunds: { create: async () => ({ id: 're_test' }) }
  };
  return stripe;
}

const deps = (stripe: StripeLike, live = true) => ({ supabase: admin, stripe, live, siteUrl: 'https://events.test', today: () => '2026-11-13', ip: null });

/** A fresh event with a $20 tier and both scouts attending: $40 owed. */
async function makeSignup(): Promise<{ event: TestEvent; entryIds: number[] }> {
  const event = await createTestEvent(admin);
  events.push(event);
  const { data: price, error: priceError } = await admin
    .from('event_prices')
    .insert({ event_signup_id: event.eventSignupId, label: 'Scouts', amount: 20, per: 'event', applies_to: 'both' })
    .select('id')
    .single();
  if (priceError) throw new Error(priceError.message);
  const { data, error } = await admin.rpc('submit_household_signup', {
    p_event_signup_id: event.eventSignupId,
    p_entries: scouts.map((s, i) => ({ key: `s${i}`, person_kind: 'scout', person_id: s.personId, status: 'yes', price_id: price!.id, answers: [] })),
    p_actor: 'vitest',
    p_allowed_person_ids: scouts.map((s) => s.personId)
  });
  if (error) throw new Error(error.message);
  return { event, entryIds: (data as { entry_id: number }[]).map((r) => r.entry_id) };
}

const start = (s: { event: TestEvent; entryIds: number[] }, stripe: StripeLike, live = true) =>
  startEventCardCheckout(
    { signupId: s.event.eventSignupId, eventId: s.event.calendarEntryId, householdKey: KEY, entryIds: s.entryIds, startedByPersonId: scouts[0].personId, payerEmail: 'payer@example.test' },
    deps(stripe, live)
  );

const payments = async (event: TestEvent) =>
  ((await admin.from('event_card_payments').select('*').eq('event_signup_id', event.eventSignupId).order('id')).data ?? []) as {
    id: number; status: string; due_cents: number; fee_cents: number; total_cents: number; stripe_session_id: string | null; stripe_payment_intent_id: string | null; stripe_fee: number | null; flag_reason: string | null;
  }[];
const ledger = async (event: TestEvent) =>
  ((await admin.from('financial_transactions').select('amount, kind, method, ledger_role, signup_entry_id, account').eq('calendar_entry_id', event.calendarEntryId).order('id')).data ?? []) as {
    amount: number; kind: string; method: string; ledger_role: string; signup_entry_id: number | null; account: string;
  }[];
const rolesOf = async (event: TestEvent) => (await ledger(event)).map((r) => `${r.ledger_role}:${Number(r.amount)}`);

function completed(session: FakeSession, over: Record<string, unknown> = {}): StripeEventLike {
  return { id: EVT(), type: 'checkout.session.completed', data: { object: { ...session, payment_intent: `pi_test_${session.id}`, payment_status: 'paid', ...over } } };
}

/** Starts a checkout and returns its fake session. */
async function opened(s: { event: TestEvent; entryIds: number[] }, stripe: ReturnType<typeof fakeStripe>): Promise<FakeSession> {
  const r = await start(s, stripe);
  if (!r.ok) throw new Error(r.error);
  const row = (await payments(s.event)).at(-1)!;
  return stripe.sessions.get(row.stripe_session_id ?? '')!;
}

beforeAll(async () => {
  bucketsBefore = await bucketIdsNow(admin);
  scouts = [await createTestScout(admin, 'CardA'), await createTestScout(admin, 'CardB')];
});
afterAll(async () => {
  for (const event of events) {
    const ids = (await payments(event)).map((p) => p.id);
    await admin.from('financial_transactions').delete().eq('calendar_entry_id', event.calendarEntryId);
    if (ids.length) {
      await admin.from('audit_log').delete().eq('entity_type', 'event_card_payment').in('entity_id', ids.map(String));
      await admin.from('event_card_payments').delete().in('id', ids);
    }
    await deleteTestEvent(admin, event);
  }
  await admin.from('stripe_events').delete().like('id', 'evt_vitest_%');
  for (const s of scouts) await deleteTestScout(admin, s);
  await deleteNewEmptyBuckets(admin, bucketsBefore);
});

describe('cardLinesFor', () => {
  it('Lines_AreEachAttendingEntrysOpenBalance', async () => {
    const s = await makeSignup();
    expect((await cardLinesFor(admin, s.entryIds)).map((l) => l.cents)).toEqual([2000, 2000]);
  });

  it('Lines_LeaveOutAnEntryNotGoing', async () => {
    const s = await makeSignup();
    await admin.from('signup_entries').update({ status: 'no' }).eq('id', s.entryIds[1]);
    expect((await cardLinesFor(admin, s.entryIds)).map((l) => l.entry_id)).toEqual([s.entryIds[0]]);
  });
});

describe('startEventCardCheckout', () => {
  it('Start_RefusesWhenCardPaymentIsNotLive', async () => {
    const s = await makeSignup();
    expect((await start(s, fakeStripe(), false)).ok).toBe(false);
  });

  it('Start_RefusesWhenNothingIsOwed', async () => {
    const s = await makeSignup();
    await admin.from('signup_entries').update({ amount_override: 0 }).in('id', s.entryIds);
    expect(await start(s, fakeStripe())).toEqual({ ok: false, error: 'Nothing is owed on this signup.' });
  });

  it('Start_RefusesASignupThatIsNotThisEvents', async () => {
    const s = await makeSignup();
    const r = await startEventCardCheckout(
      { signupId: s.event.eventSignupId, eventId: s.event.calendarEntryId + 999999, householdKey: KEY, entryIds: s.entryIds, startedByPersonId: null },
      deps(fakeStripe())
    );
    expect(r.ok).toBe(false);
  });

  it('Start_ChargesWhatIsOwedPlusTheCardFee', async () => {
    const s = await makeSignup();
    const session = await opened(s, fakeStripe());
    const [row] = await payments(s.event);
    expect([session.amount_total, row.due_cents, row.fee_cents, row.total_cents, row.status]).toEqual([4151, 4000, 151, 4151, 'open']);
  });

  it('Start_SendsStripeFirstNamesOnly', async () => {
    const s = await makeSignup();
    const session = await opened(s, fakeStripe());
    expect(JSON.stringify(session.params.line_items)).not.toContain('CardA');
  });

  it('Start_ReturnsToTheSignupPage', async () => {
    const s = await makeSignup();
    const session = await opened(s, fakeStripe());
    expect(session.params.success_url).toBe(`https://events.test/events/${s.event.calendarEntryId}/signup?household=${KEY}&card=return`);
  });

  it('Start_Again_ExpiresTheEarlierSession', async () => {
    const s = await makeSignup();
    const stripe = fakeStripe();
    const first = await opened(s, stripe);
    await opened(s, stripe);
    expect([first.status, (await payments(s.event)).map((p) => p.status)]).toEqual(['expired', ['expired', 'open']]);
  });

  it('Start_Waits_WhileAnEarlierSessionIsCompleting', async () => {
    const s = await makeSignup();
    const stripe = fakeStripe();
    const first = await opened(s, stripe);
    first.status = 'complete';
    expect((await start(s, stripe)).ok).toBe(false);
  });
});

describe('startEventCardCheckout — never two payable sessions', () => {
  it('TwoStartsAtOnce_LeaveExactlyOneOpenSession', async () => {
    const s = await makeSignup();
    const stripe = fakeStripe();
    const results = await Promise.all([start(s, stripe), start(s, stripe)]);
    const open = [...stripe.sessions.values()].filter((x) => x.status === 'open').length;
    expect([results.filter((r) => r.ok).length, open, (await payments(s.event)).filter((p) => p.status === 'open').length]).toEqual([1, 1, 1]);
  });

  it('Start_WhenStripeCannotSayIfTheEarlierSessionIsClosed_Refuses', async () => {
    const s = await makeSignup();
    const stripe = fakeStripe();
    await opened(s, stripe);
    stripe.checkout.sessions.retrieve = async () => {
      throw new Error('network');
    };
    const r = await start(s, stripe);
    expect([r.ok, (await payments(s.event)).map((p) => p.status)]).toEqual([false, ['open']]);
  });

  it('Start_WhenStripeWillNotExpireTheEarlierSession_Refuses', async () => {
    const s = await makeSignup();
    const stripe = fakeStripe();
    await opened(s, stripe);
    stripe.checkout.sessions.expire = async () => {
      throw new Error('network');
    };
    const r = await start(s, stripe);
    expect([r.ok, (await payments(s.event)).map((p) => p.status)]).toEqual([false, ['open']]);
  });
});

describe('closeOpenEventCheckouts', () => {
  it('Close_ExpiresThePartysOpenSession', async () => {
    const s = await makeSignup();
    const stripe = fakeStripe();
    const session = await opened(s, stripe);
    await closeOpenEventCheckouts(s.event.eventSignupId, KEY, deps(stripe));
    expect([session.status, (await payments(s.event))[0].status]).toEqual(['expired', 'expired']);
  });
});

describe('handleEventStripeEvent — payment', () => {
  it('Completed_BooksEachEntry_TheFeeCover_AndStripesFee', async () => {
    const s = await makeSignup();
    const stripe = fakeStripe({ fee: 146 });
    const session = await opened(s, stripe);
    const outcome = await handleEventStripeEvent(completed(session), deps(stripe));
    expect([outcome, await rolesOf(s.event)]).toEqual(['paid', ['payment:20', 'payment:20', 'fee_cover:1.51', 'fee:-1.46']]);
  });

  it('Completed_SettlesEachEntrysBalance', async () => {
    const s = await makeSignup();
    const stripe = fakeStripe();
    await handleEventStripeEvent(completed(await opened(s, stripe)), deps(stripe));
    const money = await loadPartyMoney(admin, [], s.entryIds);
    expect([money.paid, money.due]).toEqual([40, 0]);
  });

  it('Completed_Twice_BooksOnce', async () => {
    const s = await makeSignup();
    const stripe = fakeStripe();
    const session = await opened(s, stripe);
    const event = completed(session);
    await handleEventStripeEvent(event, deps(stripe));
    const outcomes = [await handleEventStripeEvent(event, deps(stripe)), await handleEventStripeEvent(completed(session), deps(stripe))];
    expect([outcomes, (await ledger(s.event)).length]).toEqual([['duplicate', 'already_paid'], 4]);
  });

  it('Completed_ForTheWrongAmount_IsFlaggedAndBooksNothing', async () => {
    const s = await makeSignup();
    const stripe = fakeStripe();
    const outcome = await handleEventStripeEvent(completed(await opened(s, stripe), { amount_total: 100 }), deps(stripe));
    expect([outcome, (await payments(s.event))[0].status, (await ledger(s.event)).length]).toEqual(['flagged_mismatch', 'flagged', 0]);
  });

  it('Completed_WithAMismatchedReference_IsIgnored', async () => {
    const s = await makeSignup();
    const stripe = fakeStripe();
    const outcome = await handleEventStripeEvent(completed(await opened(s, stripe), { client_reference_id: 'event-0' }), deps(stripe));
    expect([outcome, (await ledger(s.event)).length]).toEqual(['ignored', 0]);
  });

  it('Completed_AfterTheSessionWasExpiredHere_StillBooks', async () => {
    const s = await makeSignup();
    const stripe = fakeStripe();
    const session = await opened(s, stripe);
    await closeOpenEventCheckouts(s.event.eventSignupId, KEY, deps(stripe));
    expect(await handleEventStripeEvent(completed(session), deps(stripe))).toBe('paid');
  });

  it('AWreathSession_IsNotAnEventPayment', async () => {
    const event: StripeEventLike = { id: EVT(), type: 'checkout.session.completed', data: { object: { id: 'cs_x', payment_status: 'paid', metadata: { order_id: '1', order_number: 'W-1' } } } };
    expect(await handleEventStripeEvent(event, deps(fakeStripe()))).toBeNull();
  });

  it('Expired_ClosesTheOpenRow', async () => {
    const s = await makeSignup();
    const stripe = fakeStripe();
    const session = await opened(s, stripe);
    await handleEventStripeEvent({ id: EVT(), type: 'checkout.session.expired', data: { object: { ...session } } }, deps(stripe));
    expect((await payments(s.event))[0].status).toBe('expired');
  });
});

describe('handleEventStripeEvent — late fee', () => {
  it('ChargeUpdated_BooksTheFee_WhenItWasNotSettledAtPayment', async () => {
    const s = await makeSignup();
    const stripe = fakeStripe({ fee: null });
    const session = await opened(s, stripe);
    await handleEventStripeEvent(completed(session), deps(stripe));
    const outcome = await handleEventStripeEvent(
      { id: EVT(), type: 'charge.updated', data: { object: { payment_intent: `pi_test_${session.id}`, balance_transaction: { fee: 150 } } } },
      deps(stripe)
    );
    expect([outcome, await rolesOf(s.event)]).toEqual(['booked', ['payment:20', 'payment:20', 'fee_cover:1.51', 'fee:-1.5']]);
  });

  it('ChargeUpdated_WhenTheFeeIsAlreadyBooked_DoesNothing', async () => {
    const s = await makeSignup();
    const stripe = fakeStripe({ fee: 146 });
    const session = await opened(s, stripe);
    await handleEventStripeEvent(completed(session), deps(stripe));
    const outcome = await handleEventStripeEvent(
      { id: EVT(), type: 'charge.updated', data: { object: { payment_intent: `pi_test_${session.id}`, balance_transaction: { fee: 146 } } } },
      deps(stripe)
    );
    expect([outcome, (await ledger(s.event)).length]).toEqual(['noop', 4]);
  });

  it('ChargeUpdated_BeforeThePaymentLanded_ThrowsSoStripeRetries', async () => {
    const s = await makeSignup();
    const stripe = fakeStripe();
    const session = await opened(s, stripe);
    await expect(
      handleEventStripeEvent({ id: EVT(), type: 'charge.updated', data: { object: { payment_intent: `pi_test_${session.id}`, balance_transaction: 'txn_1' } } }, deps(stripe))
    ).rejects.toThrow(/not booked yet/);
  });

  it('ChargeUpdated_ForSomeoneElsesCharge_IsNotOurs', async () => {
    const event: StripeEventLike = { id: EVT(), type: 'charge.updated', data: { object: { payment_intent: 'pi_test_unknown', balance_transaction: 'txn_1' } } };
    expect(await handleEventStripeEvent(event, deps(fakeStripe()))).toBeNull();
  });
});

describe('handleEventStripeEvent — refund', () => {
  const refunded = (session: FakeSession, cents: number): StripeEventLike => ({
    id: EVT(),
    type: 'charge.refunded',
    data: { object: { payment_intent: `pi_test_${session.id}`, amount_refunded: cents } }
  });

  it('FullRefund_ReversesThePaymentsAndTheFeeCover_NotStripesFee', async () => {
    const s = await makeSignup();
    const stripe = fakeStripe({ fee: 146 });
    const session = await opened(s, stripe);
    await handleEventStripeEvent(completed(session), deps(stripe));
    const outcome = await handleEventStripeEvent(refunded(session, 4151), deps(stripe));
    expect([outcome, (await rolesOf(s.event)).slice(4).sort()]).toEqual(['refunded', ['fee_cover_refund:-1.51', 'refund:-20', 'refund:-20']]);
  });

  it('FullRefund_PutsTheBalanceBack', async () => {
    const s = await makeSignup();
    const stripe = fakeStripe();
    const session = await opened(s, stripe);
    await handleEventStripeEvent(completed(session), deps(stripe));
    await handleEventStripeEvent(refunded(session, 4151), deps(stripe));
    expect((await loadPartyMoney(admin, [], s.entryIds)).due).toBe(40);
  });

  it('PartialRefund_BooksNothing', async () => {
    const s = await makeSignup();
    const stripe = fakeStripe();
    const session = await opened(s, stripe);
    await handleEventStripeEvent(completed(session), deps(stripe));
    const outcome = await handleEventStripeEvent(refunded(session, 1000), deps(stripe));
    expect([outcome, (await ledger(s.event)).length, (await payments(s.event))[0].status]).toEqual(['partial', 4, 'paid']);
  });

  it('Refund_OfAFlaggedPayment_ClosesItAndBooksNothing', async () => {
    const s = await makeSignup();
    const stripe = fakeStripe();
    const session = await opened(s, stripe);
    await handleEventStripeEvent(completed(session, { amount_total: 100 }), deps(stripe));
    const outcome = await handleEventStripeEvent(refunded(session, 4151), deps(stripe));
    expect([outcome, (await payments(s.event))[0].status, (await ledger(s.event)).length]).toEqual(['flag_refunded', 'refunded', 0]);
  });

  it('FullRefund_SkipsARowTheTreasurerVoided', async () => {
    const s = await makeSignup();
    const stripe = fakeStripe();
    const session = await opened(s, stripe);
    await handleEventStripeEvent(completed(session), deps(stripe));
    await admin.from('financial_transactions').update({ voided_at: new Date().toISOString() }).eq('signup_entry_id', s.entryIds[0]).eq('ledger_role', 'payment');
    await handleEventStripeEvent(refunded(session, 4151), deps(stripe));
    expect((await ledger(s.event)).filter((r) => r.ledger_role === 'refund').map((r) => r.signup_entry_id)).toEqual([s.entryIds[1]]);
  });

  it('Refund_OfAnUnknownCharge_IsNotOurs', async () => {
    const event: StripeEventLike = { id: EVT(), type: 'charge.refunded', data: { object: { payment_intent: 'pi_test_unknown', amount_refunded: 100 } } };
    expect(await handleEventStripeEvent(event, deps(fakeStripe()))).toBeNull();
  });
});

describe('loadPartyMoney', () => {
  it('Balance_OfAScoutWithNoHistory_IsZero', async () => {
    expect((await loadPartyMoney(admin, [scouts[0].personId], [])).balances.get(scouts[0].personId)).toBe(0);
  });
});
