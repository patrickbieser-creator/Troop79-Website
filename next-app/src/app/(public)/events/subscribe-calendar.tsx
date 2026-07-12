'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './events.module.css';

const CALENDAR_NAME = 'Troop 79 Bugle Calendar';

export function SubscribeCalendar({ icsUrl, webcalUrl }: { icsUrl: string; webcalUrl: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const googleUrl = `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(icsUrl)}`;
  const outlookComUrl = `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(
    icsUrl
  )}&name=${encodeURIComponent(CALENDAR_NAME)}`;
  const outlook365Url = `https://outlook.office.com/calendar/0/addfromweb?url=${encodeURIComponent(
    icsUrl
  )}&name=${encodeURIComponent(CALENDAR_NAME)}`;

  async function copyLink() {
    await navigator.clipboard.writeText(icsUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className={styles.subscribeWrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.subscribeToggle}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zm0-12H5V6h14v2z" />
        </svg>
        Subscribe
        <svg
          className={styles.subscribeChevron}
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
          style={{ transform: open ? 'rotate(180deg)' : undefined }}
        >
          <path d="M7 10l5 5 5-5z" />
        </svg>
      </button>

      {open && (
        <div className={styles.subscribePanel} role="menu">
          <p className={styles.subscribePanelHint}>
            Syncs automatically whenever we publish changes.
          </p>
          <div className={styles.subscribeGrid}>
            <a className={styles.subscribeBtn} href={googleUrl} target="_blank" rel="noopener noreferrer">
              Google Calendar
            </a>
            <a className={styles.subscribeBtn} href={webcalUrl}>
              Apple Calendar
            </a>
            <a className={styles.subscribeBtn} href={outlookComUrl} target="_blank" rel="noopener noreferrer">
              Outlook.com
            </a>
            <a className={styles.subscribeBtn} href={outlook365Url} target="_blank" rel="noopener noreferrer">
              Outlook 365
            </a>
          </div>
          <div className={styles.subscribeDirect}>
            <code className={styles.subscribeUrl}>{icsUrl}</code>
            <button type="button" className={styles.subscribeCopyBtn} onClick={copyLink}>
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
