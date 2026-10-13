'use client';

/**
 * The admin section bar + per-section tabs (Plans/Admin-Home-And-Nav.md Wave 3), replacing the left rail.
 *
 *   SectionBar   Home · Advancement · Calendar & Content · Money · People · Tools. Text links on a white band under
 *                the admin header; the active section carries a gold underline (the rail's accent), so it never reads
 *                as the navy-underlined TabStrip beneath it. A section with no visible item is absent.
 *   SectionTabs  the active section's items as the shared TabStrip on a quieter grey band. A section with one visible
 *                item shows none (the page IS the section); Home shows none. The five reports are not tabs: the one
 *                "Reports" tab is active on the landing and on every report page (navHidden, nav-data).
 *   AdminNav     wires both to the pathname and to the dirty-form guard: every bar and tab link goes through
 *                useGuardedNav, the same mechanism as BackNav, so leaving a dirty form asks first.
 *
 * Phones (<= 800px): the bar and the strip each scroll sideways, auto-scrolled so the active entry is in view; the
 * page itself never scrolls sideways. The data and helpers live in ./nav-data (a plain module).
 */
import { useEffect, useRef, type MouseEvent } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { IS_DEV_DB } from '@/lib/dev-db';
import type { Capability } from '@/lib/capabilities';
import { TabStrip } from './tab-strip';
import { useGuardedNav } from './guarded-nav';
import { SECTIONS, visibleNavSections, sectionNav, type BarEntry, type TabEntry } from './nav-data';
import styles from './section-nav.module.css';

/** Keeps the active entry visible inside a sideways-scrolling row, without moving the page. */
function useScrollActiveIntoView(selector: string, dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = ref.current;
    const active = box?.querySelector<HTMLElement>(selector);
    if (box && active) box.scrollLeft = Math.max(0, active.offsetLeft - 24);
  }, [selector, dep]);
  return ref;
}

export function SectionBar({
  entries,
  onNavigate,
  devDb = false
}: {
  entries: BarEntry[];
  /** Plain left clicks go here instead of following the link (the dirty-form guard). */
  onNavigate?: (href: string) => void;
  devDb?: boolean;
}) {
  const active = entries.find((e) => e.active)?.key;
  const ref = useScrollActiveIntoView('[aria-current="page"]', active);
  function go(e: MouseEvent<HTMLAnchorElement>, href: string) {
    if (!onNavigate || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    onNavigate(href);
  }
  return (
    <nav className={`${styles.bar} ${devDb ? styles.barDevDb : ''}`} aria-label="Admin sections">
      <div className={styles.barScroll} ref={ref}>
        {entries.map((e) => (
          <Link
            key={e.key}
            href={e.href}
            className={styles.barLink}
            aria-current={e.active ? 'page' : undefined}
            onClick={(ev) => go(ev, e.href)}
          >
            {e.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

export function SectionTabs({
  label,
  tabs,
  activeKey,
  onNavigate
}: {
  /** The section's name, for the nav landmark: "Advancement pages". */
  label: string;
  tabs: TabEntry[];
  activeKey: string | null;
  onNavigate?: (href: string) => void;
}) {
  const ref = useScrollActiveIntoView('[aria-selected="true"]', activeKey);
  return (
    <nav className={styles.tabBand} aria-label={`${label} section`}>
      <div className={styles.tabScroll} ref={ref}>
        <TabStrip
          items={tabs.map((t) => ({ key: t.key, label: t.label, href: t.href }))}
          activeKey={activeKey ?? ''}
          ariaLabel={`${label} pages`}
          className={styles.tabs}
          onNavigate={onNavigate}
        />
      </div>
    </nav>
  );
}

export function AdminNav({ fullAdmin, capabilities }: { fullAdmin: boolean; capabilities: Capability[] }) {
  const pathname = usePathname();
  const { navigate, dialog } = useGuardedNav();
  const visible = visibleNavSections(SECTIONS, { fullAdmin, capabilities: new Set(capabilities) });
  const model = sectionNav(visible, pathname);
  const activeBar = model.bar.find((b) => b.active);
  return (
    <>
      <SectionBar entries={model.bar} onNavigate={navigate} devDb={IS_DEV_DB} />
      {model.tabs && activeBar ? (
        <SectionTabs label={activeBar.label} tabs={model.tabs} activeKey={model.activeKey} onNavigate={navigate} />
      ) : null}
      {dialog}
    </>
  );
}
