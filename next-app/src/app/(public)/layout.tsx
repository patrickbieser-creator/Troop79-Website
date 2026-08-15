import { SiteNav } from '../_components/site-nav';
import { SiteFooter } from '../_components/site-footer';
import { ArticleStyleTokens } from '@/lib/article-body/ArticleStyleTokens';

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Typography tokens for the markdown renderer, editable under Lookups &
          Admin. Mounted in the layout rather than per page so every surface
          that renders prose — news, event stories, the library — agrees. */}
      <ArticleStyleTokens />
      <SiteNav />
      {children}
      <SiteFooter />
    </>
  );
}
