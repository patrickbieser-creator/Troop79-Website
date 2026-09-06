'use client';

import { useState } from 'react';
import { Button } from '../../../_components/button';
import { siteUrl } from '@/lib/site-url';
import styles from '../events-admin.module.css';

/**
 * The ready-made "Register Now" URL for the Bugle
 * (Plans/Bugle-Register-Now-Links.md, decision B11).
 *
 * EmailOctopus substitutes each recipient's own address for the merge tag
 * when it sends, and the site's intake (/signin/hint) turns that into
 * "Continue as {name}? Email me a code" on this event's signup page. The
 * tag is spelled once, here, so it is never typed by hand into a template.
 * Verify the tag name against the EmailOctopus editor the first time.
 */
export const BUGLE_MERGE_TAG = '{{EmailAddress}}';

export function bugleRegisterLink(calendarEntryId: number, origin: string = siteUrl()): string {
  const next = encodeURIComponent(`/events/${calendarEntryId}/signup`);
  return `${origin}/signin/hint?for=${BUGLE_MERGE_TAG}&next=${next}`;
}

export function BugleLinkField({ calendarEntryId }: { calendarEntryId: number }) {
  const [copied, setCopied] = useState(false);
  const link = bugleRegisterLink(calendarEntryId);

  function copy() {
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className={styles.fullField}>
      <span className={`adminLabel ${styles.fieldLabel}`}>Bugle &ldquo;Register Now&rdquo; link</span>
      <div className={styles.bugleLinkRow}>
        <input type="text" readOnly value={link} aria-label="Bugle Register Now link" onFocus={(e) => e.currentTarget.select()} />
        <Button type="button" variant="secondary" size="sm" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <span className={styles.addHint}>
        Paste as the button link in EmailOctopus. It fills in each family&rsquo;s own address, so a parent
        lands on this signup one tap from a sign-in code &mdash; no troop password, no name search.
      </span>
    </div>
  );
}
