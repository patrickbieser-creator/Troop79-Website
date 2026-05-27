import { SiteNav } from '../_components/site-nav';
import { SiteFooter } from '../_components/site-footer';

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteNav />
      {children}
      <SiteFooter />
    </>
  );
}
