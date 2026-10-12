import type { AuditDetail } from '@/lib/audit';

/**
 * The field-level audit diff for a page save (Plans/Content-Managed-Pages.md; same from/to shape every audited
 * area uses — lib/audit AuditDetail). Only fields that actually changed appear. The long markdown fields are
 * clipped: the audit row says WHAT changed and roughly from what, not a second copy of the page.
 */
export interface PageEditFields {
  title: string;
  headline: string;
  lede: string;
  bodyMd: string;
  sidebarMd: string;
  metaDescription: string;
}

export interface StoredPageFields {
  title: string;
  headline: string;
  lede: string;
  body_md: string;
  sidebar_md: string;
  meta_description: string;
}

const CLIP = 240;
const show = (v: string) => {
  const t = v.trim();
  if (!t) return '—';
  return t.length > CLIP ? `${t.slice(0, CLIP)}…` : t;
};

export function diffSitePage(was: StoredPageFields, next: PageEditFields): AuditDetail[] {
  const pairs: [string, string, string][] = [
    ['Title', was.title, next.title],
    ['Headline', was.headline, next.headline],
    ['Lede', was.lede, next.lede],
    ['Body', was.body_md, next.bodyMd],
    ['Sidebar', was.sidebar_md, next.sidebarMd],
    ['Meta description', was.meta_description, next.metaDescription]
  ];
  return pairs.filter(([, a, b]) => a !== b).map(([field, a, b]) => ({ field, from: show(a), to: show(b) }));
}
