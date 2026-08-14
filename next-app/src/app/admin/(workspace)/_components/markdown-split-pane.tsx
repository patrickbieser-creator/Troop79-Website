'use client';

/**
 * Shared split-pane markdown editor: source on the left, live ArticleBody
 * preview on the right.
 *
 * WHY THIS EXISTS (D-088). Two bespoke split panes had already grown — the News
 * article editor and the smaller library post editor — and the recorded rule
 * was "extract a shared one if a third consumer appears; don't add a third".
 * The calendar workbench's story panel is that third consumer, so the shared
 * component is being built rather than copied into.
 *
 * This is the extraction's first half: the workbench uses it now. The article
 * and library editors still carry their own panes and should be migrated onto
 * this one — the article editor's body surface is interwoven with article-only
 * concerns (hero/media/gallery insertion), which is exactly why it was not
 * extracted the first time and why it wants its own pass rather than a rushed
 * one here.
 *
 * ArticleBody renders identically as a Server Component and inside a Client
 * Component, which is what makes one preview honest for both.
 */

import { useState } from 'react';
import { ArticleBody } from '@/lib/article-body/ArticleBody';
import styles from './markdown-split-pane.module.css';

interface Props {
  value: string;
  onChange: (next: string) => void;
  /** Placeholder for the source pane. */
  placeholder?: string;
  /** Rows for the textarea — callers with a taller panel pass more. */
  rows?: number;
  label?: string;
}

export function MarkdownSplitPane({
  value,
  onChange,
  placeholder,
  rows = 18,
  label = 'Body'
}: Props) {
  // Preview is collapsible rather than always-on: on a narrow admin panel the
  // side-by-side layout squeezes the source pane to uselessness.
  const [showPreview, setShowPreview] = useState(true);

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <span className={styles.label}>{label}</span>
        <button
          type="button"
          className={styles.toggle}
          onClick={() => setShowPreview((v) => !v)}
          aria-pressed={showPreview}
        >
          {showPreview ? 'Hide preview' : 'Show preview'}
        </button>
      </div>
      <div className={showPreview ? styles.panes : styles.panesSingle}>
        <textarea
          className={styles.source}
          value={value}
          rows={rows}
          placeholder={placeholder ?? 'Markdown — **bold**, [links](/), lists, tables…'}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} markdown source`}
        />
        {showPreview && (
          <div className={styles.preview} aria-live="polite">
            {value.trim() ? (
              <ArticleBody body={value} />
            ) : (
              <p className={styles.previewEmpty}>Nothing to preview yet.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
