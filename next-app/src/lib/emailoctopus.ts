/**
 * EmailOctopus API v2 — the few calls the newsletter sync needs
 * (https://emailoctopus.com/api-documentation/v2). Server-only: the key comes
 * from EMAILOCTOPUS_API_KEY and never reaches a browser.
 *
 * Names live in the list's default FirstName / LastName fields. `fetch` is
 * injectable so tests never touch the network.
 */
import type { ListContact } from '@/lib/newsletter-sync';

const BASE = 'https://api.emailoctopus.com';
const STATUSES: ListContact['status'][] = ['subscribed', 'unsubscribed', 'pending'];

export class EmailOctopusError extends Error {}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

interface ApiContact {
  id: string;
  email_address: string;
  fields?: Record<string, unknown>;
  status: ListContact['status'];
}

const text = (v: unknown) => (typeof v === 'string' ? v : '');

/** The key and list from the environment, or null when either is missing. */
export function emailOctopusConfig(): { apiKey: string; listId: string } | null {
  const apiKey = process.env.EMAILOCTOPUS_API_KEY?.trim();
  const listId = process.env.EMAILOCTOPUS_LIST_ID?.trim();
  return apiKey && listId ? { apiKey, listId } : null;
}

export class EmailOctopusClient {
  constructor(
    private readonly apiKey: string,
    private readonly listId: string,
    private readonly fetchFn: FetchFn = (url, init) => fetch(url, init)
  ) {}

  private async request<T>(path: string, init: RequestInit = {}, attempt = 0): Promise<T> {
    const res = await this.fetchFn(`${BASE}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      cache: 'no-store'
    });
    if (res.status === 429 && attempt < 3) {
      // 10 requests a second with a burst of 100; wait as told, then try again.
      const wait = Number(res.headers.get('X-RateLimit-Retry-After') ?? res.headers.get('Retry-After') ?? '1');
      await new Promise((r) => setTimeout(r, Math.max(0, wait) * 1000));
      return this.request<T>(path, init, attempt + 1);
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new EmailOctopusError(`EmailOctopus ${res.status}: ${text(body.detail) || text(body.title) || res.statusText}`);
    }
    return body as T;
  }

  /** Every contact on the list, whatever its status. */
  async listContacts(): Promise<ListContact[]> {
    const out: ListContact[] = [];
    for (const status of STATUSES) {
      let after: string | null = null;
      do {
        const q = new URLSearchParams({ status, limit: '100' });
        if (after) q.set('starting_after', after);
        const page: { data: ApiContact[]; paging?: { next?: { starting_after?: string } | null } } = await this.request(
          `/lists/${this.listId}/contacts?${q}`
        );
        for (const c of page.data ?? []) {
          out.push({
            id: c.id,
            email: c.email_address,
            status: c.status,
            firstName: text(c.fields?.FirstName),
            lastName: text(c.fields?.LastName)
          });
        }
        after = page.paging?.next?.starting_after ?? null;
      } while (after);
    }
    return out;
  }

  async createContact(email: string, firstName: string, lastName: string): Promise<void> {
    await this.request(`/lists/${this.listId}/contacts`, {
      method: 'POST',
      body: JSON.stringify({ email_address: email, fields: { FirstName: firstName, LastName: lastName }, status: 'subscribed' })
    });
  }

  /** Names only: never the status, so a sync can't resubscribe anyone. */
  async renameContact(contactId: string, firstName: string, lastName: string): Promise<void> {
    await this.request(`/lists/${this.listId}/contacts/${contactId}`, {
      method: 'PUT',
      body: JSON.stringify({ fields: { FirstName: firstName, LastName: lastName } })
    });
  }
}
