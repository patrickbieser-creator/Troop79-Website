import type { Metadata } from 'next';
import { GoogleAnalytics, GoogleTagManager } from '@next/third-parties/google';
import { Playfair_Display, Lora, Open_Sans } from 'next/font/google';
import './globals.css';

/* Self-hosted via next/font (Phase 0a, Plans/Public-Design-System.md): kills the
   render-blocking fonts.googleapis.com request and gives every face size-adjusted
   fallback metrics (no CLS). All three are variable fonts, so the full weight
   range the old <link> requested (Playfair 400/700/900, Lora 400/600 + italic,
   Open Sans 300-700) is covered without enumerating weights. The exposed CSS
   variables feed the --font-display/--font-body/--font-ui tokens in globals.css. */
const playfair = Playfair_Display({ subsets: ['latin'], variable: '--font-playfair', display: 'swap' });
const lora = Lora({ subsets: ['latin'], style: ['normal', 'italic'], variable: '--font-lora', display: 'swap' });
const openSans = Open_Sans({ subsets: ['latin'], variable: '--font-open-sans', display: 'swap' });

export const metadata: Metadata = {
  title: 'Scout Troop 79 — Milwaukee, WI',
  description:
    'News, calendar, advancement, and merit badge progress for Scout Troop 79 in Milwaukee, Wisconsin.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const gtmId = process.env.NEXT_PUBLIC_GTM_CONTAINER_ID;
  const gaId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

  return (
    <html lang="en" className={`${playfair.variable} ${lora.variable} ${openSans.variable}`}>
      <body>{children}</body>
      {/* Mutually exclusive by design: once GTM is configured (its container owns the GA4
          config tag), the direct gtag.js snippet stops rendering entirely so pageviews are
          never counted twice. Only loads when its env var is set — keeps local dev/preview
          traffic out of real analytics. */}
      {gtmId ? <GoogleTagManager gtmId={gtmId} /> : gaId && <GoogleAnalytics gaId={gaId} />}
    </html>
  );
}
