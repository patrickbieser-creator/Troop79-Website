'use client';

/**
 * The ⋯ control at the end of a list row (the approved scout-workspace style):
 * a plain disclosure — one button with aria-expanded that opens a short list of
 * actions. Items are links (href) or buttons (onSelect). Escape, a press
 * outside, or focus moving away closes it; Escape returns focus to the ⋯
 * button. Deliberately not role="menu": that role promises arrow-key roving
 * the control doesn't have. Used by My menus and the Plan tab.
 */

import Link from 'next/link';
import { useDisclosure } from './use-disclosure';
import s from './workspace.module.css';

export type RowMenuItem = { label: string; href?: string; onSelect?: () => void; danger?: boolean };

export function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  const { open, wrapRef, triggerRef, onBlur, toggle, close } = useDisclosure();

  return (
    <div className={s.menuWrap} ref={wrapRef} onBlur={onBlur}>
      <button type="button" ref={triggerRef} className={s.menuBtn} aria-label={label} aria-expanded={open} onClick={toggle}>
        <span aria-hidden="true">⋯</span>
      </button>
      {open && (
        <div className={s.menuPop}>
          {items.map((it) =>
            it.href != null ? (
              <Link key={it.label} href={it.href} className={s.menuItem} onClick={close}>
                {it.label}
              </Link>
            ) : (
              <button
                key={it.label}
                type="button"
                className={`${s.menuItem} ${it.danger ? s.menuDanger : ''}`}
                onClick={() => {
                  close();
                  it.onSelect?.();
                }}
              >
                {it.label}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
