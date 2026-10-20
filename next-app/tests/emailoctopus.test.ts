import { describe, it, expect, vi } from 'vitest';
import { EmailOctopusClient, EmailOctopusError } from '../src/lib/emailoctopus';

/**
 * EmailOctopus API v2 client. `fetch` is injected, so these never reach the
 * network; the request shapes are the documented v2 ones.
 */
function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}
const contact = (id: string, email: string, status: string) => ({
  id,
  email_address: email,
  fields: { FirstName: 'A', LastName: 'B' },
  tags: [],
  status,
  created_at: '2026-01-01T00:00:00Z'
});

describe('EmailOctopusClient', () => {
  it('Client_SendsTheBearerKey', async () => {
    const fetchFn = vi.fn(async () => json({ data: [], paging: { next: null } }));
    await new EmailOctopusClient('key-123', 'list-1', fetchFn).listContacts();
    const init = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer key-123');
  });

  it('Client_ReadsEveryPage_AndEveryStatus', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      const u = new URL(url);
      const status = u.searchParams.get('status');
      if (status === 'subscribed' && !u.searchParams.get('starting_after')) {
        return json({ data: [contact('1', 'a@x.org', 'subscribed')], paging: { next: { url: 'x', starting_after: 'cur1' } } });
      }
      if (status === 'subscribed') return json({ data: [contact('2', 'b@x.org', 'subscribed')], paging: { next: null } });
      if (status === 'unsubscribed') return json({ data: [contact('3', 'c@x.org', 'unsubscribed')], paging: {} });
      return json({ data: [], paging: {} });
    });
    const all = await new EmailOctopusClient('k', 'list-1', fetchFn).listContacts();
    expect(all.map((c) => `${c.email}:${c.status}`)).toEqual(['a@x.org:subscribed', 'b@x.org:subscribed', 'c@x.org:unsubscribed']);
  });

  it('Client_CreatesASubscribedContact_WithNameFields', async () => {
    const fetchFn = vi.fn(async () => json(contact('9', 'n@x.org', 'subscribed'), 201));
    await new EmailOctopusClient('k', 'list-1', fetchFn).createContact('n@x.org', 'Ann', 'Lee');
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect([url, init.method, JSON.parse(init.body as string)]).toEqual([
      'https://api.emailoctopus.com/lists/list-1/contacts',
      'POST',
      { email_address: 'n@x.org', fields: { FirstName: 'Ann', LastName: 'Lee' }, status: 'subscribed' }
    ]);
  });

  it('Client_UpdatesOnlyTheNameFields', async () => {
    const fetchFn = vi.fn(async () => json(contact('9', 'n@x.org', 'subscribed')));
    await new EmailOctopusClient('k', 'list-1', fetchFn).renameContact('9', 'Ann', 'Lee');
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect([url, init.method, JSON.parse(init.body as string)]).toEqual([
      'https://api.emailoctopus.com/lists/list-1/contacts/9',
      'PUT',
      { fields: { FirstName: 'Ann', LastName: 'Lee' } }
    ]);
  });

  it('Client_WaitsAndRetries_WhenRateLimited', async () => {
    let calls = 0;
    const fetchFn = vi.fn(async () => (++calls === 1 ? json({}, 429, { 'X-RateLimit-Retry-After': '0' }) : json(contact('9', 'n@x.org', 'subscribed'), 201)));
    await new EmailOctopusClient('k', 'list-1', fetchFn).createContact('n@x.org', 'Ann', 'Lee');
    expect(calls).toBe(2);
  });

  it('Client_ThrowsTheApiMessage_OnFailure', async () => {
    const fetchFn = vi.fn(async () => json({ title: 'Unauthorized', detail: 'Invalid API key.' }, 401));
    await expect(new EmailOctopusClient('k', 'list-1', fetchFn).listContacts()).rejects.toThrow(EmailOctopusError);
  });
});
