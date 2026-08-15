'use client';

/**
 * The shared markdown editing surface: a source textarea and a live
 * ArticleBody preview, exported both pre-composed and as separate halves.
 *
 * WHY THIS EXISTS (D-088). Three bespoke markdown editors had grown — the News
 * article editor, the smaller library post editor, and the calendar workbench's
 * story panel — and the recorded rule was "extract a shared one if a third
 * consumer appears; don't add a third". The workbench was that third consumer,
 * so this component was built; this pass finishes the job by moving the other
 * two onto it.
 *
 * WHY THREE EXPORTS. The article editor's preview is a full-height column of
 * the PAGE, sitting beside a left column that carries the whole details form —
 * not a pane tucked beneath a body field. Collapsing it into `MarkdownSplitPane`
 * would have squeezed both halves into the left column, so the two halves are
 * exported separately and the article editor composes them into its own page
 * shell. Every consumer still shares one textarea, one preview, one insertion
 * model, one cheat sheet:
 *
 *   MarkdownSource    — toolbar + textarea + inline prompts + cheat sheet
 *   MarkdownPreview   — the live ArticleBody surface (+ optional title line)
 *   MarkdownSplitPane — the two side by side with a preview toggle
 *
 * ArticleBody renders identically as a Server Component and inside a Client
 * Component, which is what makes one preview honest for all of them.
 */

import { useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react';
import { ArticleBody, type EditableBlockInfo } from '@/lib/article-body/ArticleBody';
import styles from './markdown-split-pane.module.css';

/**
 * Imperative handle for toolbars that write into the body — "Insert Gallery",
 * "Insert Table", and the edit-in-place splice from a preview block's Edit
 * button. Callers hold a ref rather than reimplementing cursor math; the
 * article editor's version of `insertAtCursor` is the one that moved here.
 */
export interface MarkdownEditorHandle {
  /** Insert at the caret, normalizing to exactly one blank line either side. */
  insertAtCursor(token: string): void;
  /** Replace an exact source span — used to re-splice an edited block token. */
  replaceRange(start: number, end: number, token: string): void;
  focus(): void;
}

interface SourceProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  /** Rows for the textarea — callers with a taller panel pass more. */
  rows?: number;
  /** Accessible name for the textarea. */
  ariaLabel?: string;
  /** Insert buttons rendered above the textarea. */
  toolbar?: ReactNode;
  /** Inline prompts (gallery-link / video forms) rendered under the toolbar. */
  children?: ReactNode;
  /** Show the collapsible markdown cheat sheet beneath the textarea. */
  cheatSheet?: boolean;
  className?: string;
  textareaClassName?: string;
  id?: string;
  ref?: Ref<MarkdownEditorHandle>;
}

export function MarkdownSource({
  value,
  onChange,
  placeholder,
  rows = 18,
  ariaLabel = 'Body markdown source',
  toolbar,
  children,
  cheatSheet = false,
  className,
  textareaClassName,
  id,
  ref
}: SourceProps) {
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(
    ref,
    () => ({
      insertAtCursor(token: string) {
        const el = areaRef.current;
        const start = el?.selectionStart ?? value.length;
        const end = el?.selectionEnd ?? value.length;
        const before = value.slice(0, start).replace(/\n*$/, '');
        const after = value.slice(end).replace(/^\n*/, '');
        const beforePart = before ? before + '\n\n' : '';
        const afterPart = after ? '\n\n' + after : '';
        onChange(beforePart + token + afterPart);
        const cursorPos = beforePart.length + token.length;
        requestAnimationFrame(() => {
          el?.focus();
          el?.setSelectionRange(cursorPos, cursorPos);
        });
      },
      replaceRange(start: number, end: number, token: string) {
        onChange(value.slice(0, start) + token + value.slice(end));
      },
      focus() {
        areaRef.current?.focus();
      }
    }),
    [value, onChange]
  );

  return (
    <div className={`${styles.sourceCol} ${className ?? ''}`}>
      {toolbar && <div className={styles.toolbar}>{toolbar}</div>}
      {children}
      <textarea
        id={id}
        ref={areaRef}
        className={`${styles.source} ${textareaClassName ?? ''}`}
        value={value}
        rows={rows}
        placeholder={placeholder ?? 'Markdown — **bold**, [links](/), lists, tables…'}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
      />
      {cheatSheet && <MarkdownCheatSheet />}
    </div>
  );
}

interface PreviewProps {
  value: string;
  /**
   * Render a title line above the body. Pass '' for "untitled" — omit the prop
   * entirely (the workbench, the library form) for body-only previews.
   */
  title?: string;
  onEditBlock?: (info: EditableBlockInfo) => void;
  /** Replaces the default preview chrome when the caller owns the surface. */
  className?: string;
  emptyNote?: string;
}

export function MarkdownPreview({ value, title, onEditBlock, className, emptyNote }: PreviewProps) {
  return (
    <div className={className ?? styles.preview} aria-live="polite">
      {title !== undefined && (
        <div className={styles.previewTitle}>{title || 'Untitled'}</div>
      )}
      {value.trim() ? (
        <ArticleBody body={value} onEditBlock={onEditBlock} />
      ) : (
        <p className={styles.previewEmpty}>{emptyNote ?? 'Nothing to preview yet.'}</p>
      )}
    </div>
  );
}

export function MarkdownCheatSheet() {
  return (
    <details className={styles.cheatSheet}>
      <summary>Markdown cheat sheet</summary>
      <div className={styles.cheatSheetGrid}>
        <code>## Heading</code>
        <span>Section heading</span>
        <code>**bold**</code>
        <span>Bold text</span>
        <code>*italic*</code>
        <span>Italic text</span>
        <code>[text](url)</code>
        <span>Link</span>
        <code>- item</code>
        <span>Bulleted list</span>
        <code>{'| a | b |\\n| --- | --- |'}</code>
        <span>Table (use the Insert Table button)</span>
      </div>
    </details>
  );
}

interface SplitProps extends Omit<SourceProps, 'ariaLabel'> {
  label?: string;
  onEditBlock?: (info: EditableBlockInfo) => void;
  emptyNote?: string;
}

export function MarkdownSplitPane({
  label = 'Body',
  onEditBlock,
  emptyNote,
  ...source
}: SplitProps) {
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
        <MarkdownSource {...source} ariaLabel={`${label} markdown source`} />
        {showPreview && (
          <MarkdownPreview value={source.value} onEditBlock={onEditBlock} emptyNote={emptyNote} />
        )}
      </div>
    </div>
  );
}
