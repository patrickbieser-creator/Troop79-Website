'use client';

/**
 * Editable site text — first the event-reminder follow-up email (Patrick,
 * 2026-08-21: "this should be in the lookups section of the admin so that
 * text can be edited"). Same shape as ArticleTokensEditor: one field per key,
 * blank = built-in default (shown as the placeholder and under the field),
 * Save writes the whole set through one server action. Placeholders like
 * {title} and {deadline} are filled when the email is sent — a typo'd
 * placeholder stays visible in the email rather than vanishing, so it gets
 * noticed.
 */

import { useState, useTransition } from 'react';
import { SaveButton, SaveFeedback, useSavedSnapshot, useSavePhase } from '../../_components/save-state';
import {
  SITE_TEXT_KEYS,
  SITE_TEXT_DEFAULTS,
  REMINDER_EMAIL_PLACEHOLDERS,
  type SiteTextKey
} from '@/lib/site-text';
import styles from './lookups.module.css';
import { Notice } from '../../_components/notice';

type ActionResult = { ok: boolean; error?: string };

export function SiteTextEditor({
  values,
  onSave
}: {
  /** Stored overrides only — keys missing here are on the default. */
  values: Partial<Record<SiteTextKey, string>>;
  onSave: (fd: FormData) => Promise<ActionResult>;
}) {
  const [draft, setDraft] = useState<Partial<Record<SiteTextKey, string>>>(() => ({ ...values }));
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();
  // Save standard (2026-08-24): off and "Saved" until a value differs.
  const { dirty, markSaved } = useSavedSnapshot(JSON.stringify(draft));
  const feedback = useSavePhase();

  function set(key: SiteTextKey, value: string) {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  function save() {
    setErr(null);
    setSaved(false);
    const fd = new FormData();
    for (const def of SITE_TEXT_KEYS) fd.set(def.key, (draft[def.key] ?? '').trim());
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
    <div>
      <p className={styles.helpText}>
        Sent from an event roster&rsquo;s &ldquo;Chase the non-responders&rdquo; panel to the
        parents of active scouts with no entry yet. Leave a field blank to use the built-in
        wording. Placeholders filled at send time: {REMINDER_EMAIL_PLACEHOLDERS.join(', ')}.
      </p>
      <div className={styles.editGrid}>
        {SITE_TEXT_KEYS.map((def) => {
          const current = draft[def.key] ?? '';
          return (
            <label key={def.key} className={`${styles.editField} ${def.multiline ? styles.editFieldFull : ''}`}>
              <span className={styles.editLabel}>{def.label}</span>
              {def.multiline ? (
                <textarea
                  className={styles.editInput}
                  rows={3}
                  value={current}
                  placeholder={SITE_TEXT_DEFAULTS[def.key]}
                  onChange={(e) => set(def.key, e.target.value)}
                  aria-label={def.label}
                />
              ) : (
                <input
                  type="text"
                  className={styles.editInput}
                  value={current}
                  placeholder={SITE_TEXT_DEFAULTS[def.key]}
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
      {saved && <Notice variant="success">Saved — the next reminder uses this wording.</Notice>}
      <div className={styles.editActions}>
        <SaveButton
          className={styles.editSaveBtn}
          dirty={dirty}
          pending={isPending}
          dirtyLabel="Save reminder email"
          onClick={save}
        />
        <SaveFeedback phase={feedback.phase} />
      </div>
    </div>
  );
}
