import { SiteNav } from '../_components/site-nav';
import { PasskeyOfferGate } from '../_components/passkey-offer-gate';
import { SiteFooter } from '../_components/site-footer';
import { ArticleStyleTokens } from '@/lib/article-body/ArticleStyleTokens';
import { JsonLd } from '../_components/json-ld';
import { createAdminClient } from '@/lib/supabase/server';
import { siteUrl } from '@/lib/site-url';
import { loadSeoSettings, organizationJsonLd, websiteJsonLd } from '@/lib/seo';

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  /* Organization + WebSite structured data on EVERY public page (2026-08-22).
     Mounted in the layout for the same reason ArticleStyleTokens is: this is a
     site-wide fact, and a per-page copy would drift. Its content — address,
     meeting place, social profiles — is editable in Lookups & Admin. */
  const settings = await loadSeoSettings(createAdminClient());
  const origin = siteUrl();

  return (
    <>
      <JsonLd data={[organizationJsonLd(settings, origin), websiteJsonLd(origin)]} />
      {/* Typography tokens for the markdown renderer, editable under Lookups &
          Admin. Mounted in the layout rather than per page so every surface
          that renders prose — news, event stories, the library — agrees. */}
      <ArticleStyleTokens />
      <SiteNav />
      {/* One-time passkey offer after a code/link sign-in — on whatever page
          comes next (lib/passkey-offer.ts). Client-side so this layout never
          reads cookies() and the ISR pages stay static. */}
      <PasskeyOfferGate />
      {children}
      <SiteFooter />
    </>
  );
}
