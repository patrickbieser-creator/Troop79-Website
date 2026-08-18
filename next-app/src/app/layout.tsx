import type { Metadata } from 'next';
import { GoogleAnalytics, GoogleTagManager } from '@next/third-parties/google';
import './globals.css';

export const metadata: Metadata = {
  title: 'Scout Troop 79 — Milwaukee, WI',
  description:
    'News, calendar, advancement, and merit badge progress for Scout Troop 79 in Milwaukee, Wisconsin.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const gtmId = process.env.NEXT_PUBLIC_GTM_CONTAINER_ID;
  const gaId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900&family=Lora:ital,wght@0,400;0,600;1,400&family=Open+Sans:wght@300;400;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
      {/* Mutually exclusive by design: once GTM is configured (its container owns the GA4
          config tag), the direct gtag.js snippet stops rendering entirely so pageviews are
          never counted twice. Only loads when its env var is set — keeps local dev/preview
          traffic out of real analytics. */}
      {gtmId ? <GoogleTagManager gtmId={gtmId} /> : gaId && <GoogleAnalytics gaId={gaId} />}
    </html>
  );
}
