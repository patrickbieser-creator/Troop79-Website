import { describe, it, expect } from 'vitest';
import { LOOKUP_GROUPS, findLookupCard, lookupCardHref, visibleLookupGroups } from '../src/app/admin/(workspace)/advancement/lookups/lookup-cards';

/** Lookups & Admin landing page (Patrick, 2026-10-28): grouped links, each card opening on its own. */
describe('lookup cards', () => {
  it('EveryCard_HasAUniqueId', () => {
    const ids = LOOKUP_GROUPS.flatMap((g) => g.cards.map((c) => c.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('Card_OpensOnTheLookupsPathByQuery', () => {
    expect(lookupCardHref('requirement-classes')).toBe('/admin/advancement/lookups?card=requirement-classes');
  });

  it('StoresCard_IsHidden_WithoutLibraryModeration', () => {
    const ids = (canEdit: boolean) => visibleLookupGroups(canEdit).flatMap((g) => g.cards.map((c) => c.id));
    expect([ids(false).includes('stores'), ids(true).includes('stores')]).toEqual([false, true]);
  });

  it('UnknownOrHiddenCard_IsNotFound', () => {
    expect([findLookupCard('nope', true), findLookupCard('stores', false), findLookupCard('events', false)?.title]).toEqual([null, null, 'Events']);
  });
});
