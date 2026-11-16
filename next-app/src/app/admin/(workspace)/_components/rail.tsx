'use client';

/**
 * The workspace rail and its area menus (Plans/Admin-Portal-Nav.md phase 3), replacing the section bar and tabs.
 *
 *   Home · Meetings · Advancement · Website Content · Money · People · Reports
 *   Pinned (the person's own, Edit pins)
 *   ───
 *   Setup · Everything A–Z
 *
 * A group is a button: a click (never hover) opens its menu as a panel beside the rail, over a scrim, four columns one
 * level deep. Escape or a click outside closes it and focus goes back to the group. An item navigates (through the
 * dirty-form guard) and closes. Each item has a quiet "+ Pin" / "Unpin" on hover or focus.
 *
 * Phones (<= 800px): the top bar's Menu button (RailMenuButton) opens the rail as a full-height sheet; a group opens
 * its menu as a full-screen sheet with a Back button. No <details> (D-070).
 *
 * The data comes from ./area-menu (a plain module); the layout builds it from the visible features.
 */
import { useEffect, useId, useOptimistic, useRef, useState, useTransition, type MouseEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { activeAreaFor, type AreaMenu, type MenuItem } from './area-menu';
import type { Area } from './feature-registry';
import { useGuardedNav } from './guarded-nav';
import { pinFeatureAction, unpinFeatureAction } from './pin-actions';
import { beaconNavOpen } from './nav-beacon';
import styles from './rail.module.css';

/** The phone Menu button and the rail talk through one window event; they sit in different parts of the layout. */
const TOGGLE_EVENT = 'admin-rail-toggle';
/** The rail announces its sheet's state back, so the button can say whether it is expanded. */
const STATE_EVENT = 'admin-rail-state';

export function RailMenuButton() {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const onState = (e: Event) => setExpanded((e as CustomEvent<boolean>).detail);
    window.addEventListener(STATE_EVENT, onState);
    return () => window.removeEventListener(STATE_EVENT, onState);
  }, []);
  return (
    <button
      type="button"
      id="admin-rail-menu-button"
      className={styles.menuButton}
      aria-controls="admin-rail"
      aria-expanded={expanded}
      onClick={() => window.dispatchEvent(new Event(TOGGLE_EVENT))}
    >
      Menu
    </button>
  );
}

type Counts = Partial<Record<Area, number>>;

/** Focus goes back to the group whose menu just closed. */
function focusGroup(area: Area) {
  document.querySelector<HTMLButtonElement>(`#admin-rail button[data-area="${area}"]`)?.focus();
}

function CountChip({ n }: { n: number | undefined }) {
  if (!n) return null;
  return (
    <span className={styles.count}>
      {n}
      <span className={styles.srOnly}> waiting</span>
    </span>
  );
}

type PinOp = { op: 'add'; item: MenuItem } | { op: 'remove'; key: string };

export interface RailProps {
  groups: AreaMenu[];
  pins: MenuItem[];
  setup: AreaMenu | null;
  /** Settles after the page renders: the rail never waits on the inbox queries. */
  counts: Promise<Counts>;
  /** False for a session with no person id: pins are personal. */
  canPin: boolean;
  devDb?: boolean;
}

export function Rail({ groups, pins: savedPins, setup, counts, canPin, devDb = false }: RailProps) {
  const pathname = usePathname();
  const { navigate, dialog } = useGuardedNav();
  const [openArea, setOpenArea] = useState<Area | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  /** Read out after a pin or unpin lands (a polite live region): the change is otherwise silent. */
  const [announce, setAnnounce] = useState('');
  const [, startPin] = useTransition();
  const [pins, applyPin] = useOptimistic(savedPins, (cur: MenuItem[], p: PinOp) =>
    p.op === 'add' ? (cur.some((i) => i.key === p.item.key) ? cur : [...cur, p.item]) : cur.filter((i) => i.key !== p.key)
  );
  const pinned = new Set(pins.map((p) => p.key));
  const active = activeAreaFor(pathname);
  const panelRef = useRef<HTMLElement>(null);
  // The counts arrive after the page: read in an effect, never suspended on, so a click is never held up by them.
  const [countByArea, setCountByArea] = useState<Counts>({});
  useEffect(() => {
    let live = true;
    // Promise.resolve: on the client a server-passed promise is React's own thenable, whose then() returns nothing, so
    // chaining .catch straight onto it throws (it took /admin down in production, 2026-11-16).
    Promise.resolve(counts)
      .then((c) => {
        if (live) setCountByArea(c);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [counts]);
  const panelId = useId();

  // An opened menu takes focus to its first link, so the keyboard lands in it rather than on the next rail button.
  useEffect(() => {
    if (openArea) panelRef.current?.querySelector<HTMLElement>('[data-first-focus], a')?.focus();
  }, [openArea]);

  useEffect(() => {
    const toggle = () => setSheetOpen((o) => !o);
    window.addEventListener(TOGGLE_EVENT, toggle);
    return () => window.removeEventListener(TOGGLE_EVENT, toggle);
  }, []);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(STATE_EVENT, { detail: sheetOpen }));
    // The phone sheet takes focus to its first entry when it opens.
    if (sheetOpen) document.querySelector<HTMLElement>('#admin-rail a, #admin-rail button[data-area]')?.focus();
  }, [sheetOpen]);

  function closeSheet() {
    setSheetOpen(false);
    document.getElementById('admin-rail-menu-button')?.focus();
  }

  function closeMenu(returnFocus = true) {
    const was = openArea;
    setOpenArea(null);
    if (returnFocus && was) focusGroup(was);
  }

  useEffect(() => {
    if (!openArea && !sheetOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (openArea) {
        e.preventDefault();
        const was = openArea;
        setOpenArea(null);
        focusGroup(was);
      } else if (sheetOpen) {
        setSheetOpen(false);
        document.getElementById('admin-rail-menu-button')?.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openArea, sheetOpen]);

  function go(e: MouseEvent<HTMLAnchorElement>, href: string, key?: string) {
    // Shortcut tracking (decision 12): fire-and-forget, even for a new-tab click.
    if (key) beaconNavOpen(key);
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    setOpenArea(null);
    setSheetOpen(false);
    navigate(href);
  }

  function togglePin(item: MenuItem) {
    setPinError(null);
    const removing = pinned.has(item.key);
    startPin(async () => {
      applyPin(removing ? { op: 'remove', key: item.key } : { op: 'add', item });
      // The action revalidates the layout, so the saved pins arrive with its response; no separate refresh.
      const res = removing ? await unpinFeatureAction(item.key) : await pinFeatureAction(item.key);
      if (!res.ok) setPinError(res.error);
      else setAnnounce(`${removing ? 'Unpinned' : 'Pinned'} ${item.label}`);
    });
  }

  const menu = openArea === 'setup' ? setup : (groups.find((g) => g.area === openArea) ?? null);

  function groupButton(g: AreaMenu): ReactNode {
    const isActive = active === g.area;
    return (
      <button
        key={g.area}
        type="button"
        data-area={g.area}
        className={styles.railItem}
        data-active={isActive || undefined}
        data-open={openArea === g.area || undefined}
        aria-expanded={openArea === g.area}
        aria-controls={openArea === g.area ? panelId : undefined}
        onClick={() => setOpenArea((cur) => (cur === g.area ? null : g.area))}
      >
        <span>
          {g.title}
          {isActive ? <span className={styles.srOnly}> (current section)</span> : null}
        </span>
        <span className={styles.groupEnd}>
          <CountChip n={countByArea[g.area]} />
          <span className={styles.chevron} aria-hidden="true">
            ›
          </span>
        </span>
      </button>
    );
  }

  return (
    <div
      className={`${styles.shell} ${devDb ? styles.devDb : ''}`}
      data-sheet-open={sheetOpen || undefined}
    >
      <nav id="admin-rail" className={styles.rail} aria-label="Workspace">
        <div className={styles.sheetHead}>
          <span className={styles.sheetTitle}>Menu</span>
          <button type="button" className={styles.closeButton} onClick={closeSheet}>
            Close
          </button>
        </div>
        <Link
          href="/admin"
          className={styles.railItem}
          aria-current={active === 'home' ? 'page' : undefined}
          data-active={active === 'home' || undefined}
          onClick={(e) => go(e, '/admin')}
        >
          Home
        </Link>
        {groups.map(groupButton)}

        {pins.length > 0 || canPin ? (
          <div className={styles.pinHead}>
            <span id="admin-rail-pinned">Pinned</span>
            {pins.length > 0 ? (
              <Link href="/admin/pins" className={styles.pinEdit} onClick={(e) => go(e, '/admin/pins')}>
                Edit pins
              </Link>
            ) : null}
          </div>
        ) : null}
        {pins.length === 0 && canPin ? <p className={styles.pinEmpty}>Open a menu and choose + Pin to keep an item here.</p> : null}
        {pins.length > 0 ? (
          <ul className={styles.pinList} aria-labelledby="admin-rail-pinned">
            {pins.map((p) => (
              <li key={p.key}>
                <Link
                  href={p.href}
                  className={styles.railItem}
                  aria-current={pathname === p.href ? 'page' : undefined}
                  onClick={(e) => go(e, p.href, p.key)}
                >
                  {p.label}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}

        <hr className={styles.hairline} />
        {setup ? groupButton(setup) : null}
        <Link
          href="/admin/everything"
          className={styles.railItem}
          aria-current={pathname === '/admin/everything' ? 'page' : undefined}
          onClick={(e) => go(e, '/admin/everything')}
        >
          Everything A–Z
        </Link>
      </nav>

      {menu ? (
        <>
          <div className={styles.scrim} aria-hidden="true" onClick={() => closeMenu()} />
          <section ref={panelRef} id={panelId} className={styles.panel} aria-label={`${menu.title} menu`}>
            <div className={styles.panelHead}>
              <button type="button" className={styles.backButton} onClick={() => closeMenu()}>
                ← Back
              </button>
              <div className={styles.panelTitleBox}>
                <h2 className={styles.panelTitle}>{menu.title}</h2>
                {menu.homeHref && menu.homeLabel ? (
                  <Link href={menu.homeHref} className={styles.homeLink} data-first-focus onClick={(e) => go(e, menu.homeHref!)}>
                    Open {menu.homeLabel} →
                  </Link>
                ) : null}
              </div>
              <button type="button" className={styles.closeButton} onClick={() => closeMenu()} aria-label={`Close ${menu.title} menu`}>
                Close
              </button>
            </div>
            {pinError ? (
              <p className={styles.pinError} role="alert">
                {pinError}
              </p>
            ) : null}
            <div className={styles.columns}>
              {menu.columns.map((col) => (
                <div key={col.title} className={styles.column}>
                  <h3 className={styles.columnTitle}>{col.title}</h3>
                  {col.items.length === 0 ? <p className={styles.none}>None yet</p> : null}
                  <ul className={styles.items}>
                    {col.items.map((item) => (
                      <li key={item.key} className={styles.itemRow} data-season={item.season}>
                        <Link href={item.href} className={styles.item} onClick={(e) => go(e, item.href, item.key)}>
                          <span className={styles.itemLabel}>{item.label}</span>
                          {item.description ? <span className={styles.itemDesc}>{item.description}</span> : null}
                        </Link>
                        {canPin ? (
                          <button
                            type="button"
                            className={styles.pinButton}
                            data-pinned={pinned.has(item.key) || undefined}
                            aria-label={pinned.has(item.key) ? `Unpin ${item.label}` : `Pin ${item.label}`}
                            onClick={() => togglePin(item)}
                          >
                            {pinned.has(item.key) ? 'Unpin' : '+ Pin'}
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        </>
      ) : null}
      <p className={styles.srOnly} role="status" aria-live="polite">
        {announce}
      </p>
      {sheetOpen ? <div className={styles.sheetScrim} aria-hidden="true" onClick={closeSheet} /> : null}
      {dialog}
    </div>
  );
}
