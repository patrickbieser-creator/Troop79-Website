/**
 * Lookups & Admin is a landing page of links (Patrick, 2026-10-28: too many cards to scroll). Each card opens on its own
 * at /admin/advancement/lookups?card=<id>, expanded. The query keeps every card on the one path, so the editors'
 * revalidatePath('/admin/advancement/lookups') still refreshes whichever card is open. Pure: ids, groups, words.
 */
export interface LookupCardDef {
  id: string;
  title: string;
  /** One line on the landing page: what it's for. */
  blurb: string;
  /** Menu Monster content: shown only to people who may moderate the Library. */
  stores?: boolean;
}

export interface LookupGroup {
  title: string;
  /** The admin hub's earth tone for the section it belongs to (Advancement moss, Content sky, People & Setup stone). */
  tint: 'moss' | 'sky' | 'stone';
  cards: LookupCardDef[];
}

export const LOOKUP_GROUPS: LookupGroup[] = [
  {
    title: 'Advancement catalog',
    tint: 'moss',
    cards: [
      { id: 'merit-badges', title: 'Merit Badge Catalog', blurb: 'Badges, Scoutbook IDs, counselors and each badge’s requirement tree' },
      { id: 'requirement-codes', title: 'Internal Requirement Codes', blurb: 'Codes, labels, minutes to teach and class tags' },
      { id: 'requirement-classes', title: 'Requirement classes', blurb: 'Where a requirement can be done: meeting, campout, aquatics…' }
    ]
  },
  {
    title: 'Fast Entry pick lists',
    tint: 'moss',
    cards: [
      { id: 'events', title: 'Events', blurb: 'The Events tab pull-down, each with its kind' },
      { id: 'service-projects', title: 'Service Projects', blurb: 'The Service tab pull-down' },
      { id: 'leadership-positions', title: 'Leadership Positions', blurb: 'The Leadership tab pull-down' }
    ]
  },
  {
    title: 'Meeting planner teaching',
    tint: 'moss',
    cards: [
      { id: 'skills', title: 'Skills', blurb: 'Teaching skills, and which older scouts may teach' },
      { id: 'adult-skills', title: 'Adult Skills', blurb: 'Adults who teach, and what' },
      { id: 'scout-instructors', title: 'Scout Instructors', blurb: 'Scouts who teach, and what' },
      { id: 'teaching-changes', title: 'Recent teaching-skill changes', blurb: 'What people changed on the member page; undo or mark reviewed' }
    ]
  },
  {
    title: 'Site content and email',
    tint: 'sky',
    cards: [
      { id: 'categories', title: 'Categories', blurb: 'The one taxonomy for events, albums and news' },
      { id: 'article-typography', title: 'Article Typography', blurb: 'How markdown stories are set' },
      { id: 'event-reminder', title: 'Event reminder email', blurb: 'The “Chase the non-responders” wording' },
      { id: 'email-templates', title: 'Email templates', blurb: 'Confirmation emails the signup builder picks from' },
      { id: 'search-visibility', title: 'Search & AI visibility', blurb: 'robots.txt, the sitemap, what search engines are told' }
    ]
  },
  {
    title: 'Families and stores',
    tint: 'stone',
    cards: [
      { id: 'households', title: 'Households', blurb: 'Household names; who belongs is set on the Roster' },
      { id: 'stores', title: 'Menu Monster stores', blurb: 'The store pull-down in the price book', stores: true }
    ]
  }
];

export const LOOKUPS_PATH = '/admin/advancement/lookups';
export const lookupCardHref = (id: string) => `${LOOKUPS_PATH}?card=${id}`;

/** The groups a viewer sees: the stores card only for Library moderators; a group left empty goes. */
export function visibleLookupGroups(canEditStores: boolean): LookupGroup[] {
  return LOOKUP_GROUPS.map((g) => ({ ...g, cards: g.cards.filter((c) => canEditStores || !c.stores) })).filter((g) => g.cards.length);
}

/** The card a ?card= id names, if this viewer may open it. */
export function findLookupCard(id: string, canEditStores: boolean): LookupCardDef | null {
  return visibleLookupGroups(canEditStores).flatMap((g) => g.cards).find((c) => c.id === id) ?? null;
}
