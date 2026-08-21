/**
 * Current / Archived tabs for the News list.
 *
 * Replaces a "Show archived" checkbox that MIXED archived posts into the
 * current list rather than switching to them — so the only way to see the
 * archive was to also see everything else, and there was no way to look at just
 * what had been archived. Tabs say which set you are in, and give each a count.
 *
 * Renders the shared TabStrip (Phase A, 2026-08-21) in link mode — list state
 * lives in the URL on this screen (bookmarkable, same convention as the
 * ledger). This file used to carry its own copy of the pill-tab markup,
 * deliberately byte-identical to Calendar's; the shared component is that
 * sameness made structural. Cost of the swap: TabStrip is a client component,
 * so these tabs now hydrate — a small price this file previously avoided,
 * accepted for one-tab-strip-everywhere.
 */

import { TabStrip } from '../../_components/tab-strip';

interface Props {
  archived: boolean;
  currentCount: number;
  archivedCount: number;
  /** Current query string, so switching tabs keeps search and status. */
  hrefFor: (archived: boolean) => string;
}

export function ArticlesTabs({ archived, currentCount, archivedCount, hrefFor }: Props) {
  return (
    <TabStrip
      ariaLabel="Post archive state"
      activeKey={archived ? 'archived' : 'current'}
      items={[
        { key: 'current', label: 'Current', count: currentCount, href: hrefFor(false) },
        { key: 'archived', label: 'Archived', count: archivedCount, href: hrefFor(true) }
      ]}
    />
  );
}
