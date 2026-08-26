'use client';

/**
 * Search & AI visibility — the editable half of the SEO work (Patrick,
 * 2026-08-22: "implement and make available editing of the robots.txt").
 *
 * Same contract as SiteTextEditor: one field per key, blank = the built-in
 * default (shown as the placeholder), Save writes the whole set through one
 * server action. Two things here are not plain text and are called out in the
 * UI rather than left to be discovered:
 *
 *   - robots.txt is served verbatim at /robots.txt, so what is typed here is
 *     byte-for-byte what a crawler reads. The Sitemap: line is appended
 *     automatically unless the body already declares one.
 *   - "List individual scout pages" is a PRIVACY switch, not a tuning knob.
 *     It ships off and is worded so that is unmistakable.
 */

import { useState, useTransition } from 'react';
import { DiscardButton, SaveButton, SaveFeedback, useDraftSnapshot, useSavePhase } from '../../_components/save-state';
import { SEO_KEYS, SEO_DEFAULTS, seoFlagOn, type SeoSettingKey } from '@/lib/seo';
import styles from './lookups.module.css';
import { Notice } from '../../_components/notice';
import { FormPanel } from '../../../_components/form-panel';

type ActionResult = { ok: boolean; error?: string };

export function SeoEditor({
  values,
  onSave
}: {
  /** Stored overrides only — keys missing here are on the default. */
  values: Partial<Record<SeoSettingKey, string>>;
  onSave: (fd: FormData) => Promise<ActionResult>;
}) {
  const [draft, setDraft] = useState<Partial<Record<SeoSettingKey, string>>>(() => ({ ...values }));
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();
  // Save standard (2026-08-24): off and "Saved" until a value differs.
  const { dirty, markSaved, saved: savedDraft } = useDraftSnapshot(draft);
  const feedback = useSavePhase();

  function set(key: SeoSettingKey, value: string) {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  function save() {
    setErr(null);
    setSaved(false);
    const fd = new FormData();
    for (const def of SEO_KEYS) fd.set(def.key, (draft[def.key] ?? '').trim());
    feedback.start();
    startTransition(async () => {
      const res = await onSave(fd);
      if (!res.ok) {
        feedback.fail();
        setErr(res.error ?? 'Save failed');
        return;
      }
      markSaved();
      feedback.done();
      setSaved(true);
    });
  }

  return (
    <FormPanel>
      <p className={styles.helpText}>
        What search engines and AI assistants read about the troop. The site publishes a{' '}
        <a href="/sitemap.xml" target="_blank" rel="noreferrer">
          sitemap
        </a>{' '}
        and a{' '}
        <a href="/robots.txt" target="_blank" rel="noreferrer">
          robots.txt
        </a>{' '}
        automatically from what is here &mdash; both update as soon as you save, with no deploy.
        Leave any field blank to use the built-in value.
      </p>

      <div className={styles.fieldGrid}>
        {SEO_KEYS.map((def) => {
          const current = draft[def.key] ?? '';
          if (def.flag) {
            const on = seoFlagOn(current || SEO_DEFAULTS[def.key]);
            return (
              <label key={def.key} className={`${styles.editField} ${styles.editFieldFull}`}>
                <span className={styles.editLabel}>{def.label}</span>
                <span>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => set(def.key, e.target.checked ? 'on' : 'off')}
                    aria-label={def.label}
                  />{' '}
                  {on ? 'On — scout pages are listed for search engines' : 'Off — scout pages are not listed'}
                </span>
                <span className={styles.helpText}>{def.hint}</span>
              </label>
            );
          }
          return (
            <label
              key={def.key}
              className={`${styles.editField} ${def.multiline ? styles.editFieldFull : ''}`}
            >
              <span className={styles.editLabel}>{def.label}</span>
              {def.multiline ? (
                <textarea
                  className={styles.editInput}
                  rows={def.rows ?? 3}
                  value={current}
                  placeholder={SEO_DEFAULTS[def.key]}
                  onChange={(e) => set(def.key, e.target.value)}
                  aria-label={def.label}
                  spellCheck={false}
                />
              ) : (
                <input
                  type="text"
                  className={styles.editInput}
                  value={current}
                  placeholder={SEO_DEFAULTS[def.key] || '—'}
                  onChange={(e) => set(def.key, e.target.value)}
                  aria-label={def.label}
                />
              )}
              <span className={styles.helpText}>{def.hint}</span>
            </label>
          );
        })}
      </div>

      {err && <Notice variant="error">{err}</Notice>}
      {saved && (
        <Notice variant="success">
          Saved &mdash; /robots.txt and /sitemap.xml serve the new values immediately.
        </Notice>
      )}
      <div className={styles.editActions}>
        <DiscardButton dirty={dirty} pending={isPending} onClick={() => { setDraft(savedDraft); setErr(null); }} />
        <SaveButton
          dirty={dirty}
          pending={isPending}
          dirtyLabel="Save search settings"
          onClick={save}
        />
        <SaveFeedback phase={feedback.phase} />
      </div>
    </FormPanel>
  );
}
