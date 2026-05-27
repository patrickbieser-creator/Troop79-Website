/**
 * Homepage placeholder. The full Home / News Feed port lives at /index.html
 * in the prototype — this Next.js homepage is a stub until that page is
 * ported. For now it points visitors to the working /merit-badges route.
 */

import Link from 'next/link';

export default function Home() {
  return (
    <main
      style={{
        maxWidth: 760,
        margin: '0 auto',
        padding: '60px 24px',
        fontFamily: 'var(--font-body)'
      }}
    >
      <h1
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 40,
          fontWeight: 700,
          color: 'var(--text-head)',
          marginBottom: 16
        }}
      >
        Scout Troop 79
      </h1>
      <p style={{ fontSize: 17, lineHeight: 1.6, marginBottom: 24 }}>
        Production build is under construction. Until the rest of the site is ported, the
        live page that works is{' '}
        <Link
          href="/merit-badges"
          style={{
            color: 'var(--navy)',
            borderBottom: '1px solid var(--navy)',
            paddingBottom: 1
          }}
        >
          Merit Badge Progress
        </Link>
        .
      </p>
      <p style={{ fontSize: 13, color: 'var(--text-meta)', fontStyle: 'italic' }}>
        The static prototype at the project root remains the design reference. See
        README for how to run both side-by-side.
      </p>
    </main>
  );
}
