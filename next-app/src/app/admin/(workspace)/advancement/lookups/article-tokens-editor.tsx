'use client';

/**
 * Article typography panel.
 *
 * What "let me edit the markdown CSS" becomes when the CSS cannot safely be
 * edited: the values that stylesheet reads, each with a type that refuses
 * anything which isn't one. `17px` saves; `17px; background: url(...)` is
 * rejected before it reaches storage, and again before it reaches a page.
 *
 * Every field is optional. Blank means "use the default", and the default shows
 * as the placeholder — so the stylesheet stays the single source of truth for
 * what the site looks like out of the box, and Reset is just clearing a field.
 */

import { useState, useTransition } from 'react';
import { SaveButton, SaveFeedback, useSavePhase } from '../../_components/save-state';
import { ARTICLE_TOKENS, isValidTokenValue, type TokenValues } from '@/lib/article-tokens';
import styles from './lookups.module.css';
import { Notice } from '../../_components/notice';

type ActionResult = { ok: boolean; error?: string };

export function ArticleTokensEditor({
  values,
  onSave
}: {
  values: TokenValues;
  onSave: (fd: FormData) => Promise<ActionResult>;
}) {
  const [draft, setDraft] = useState<TokenValues>(() => ({ ...values }));
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Live client-side check so a bad value is obvious before saving; the server
  // re-checks regardless, since this one can be bypassed.
  const invalid = ARTICLE_TOKENS.filter((d) => {
    const v = (draft[d.key] ?? '').trim();
    return v !== '' && !isValidTokenValue(d, v);
  }).map((d) => d.key);

  function set(key: string, value: string) {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  const feedback = useSavePhase();

  function save() {
    setErr(null);
    setSaved(false);
    const fd = new FormData();
    for (const def of ARTICLE_TOKENS) fd.set(def.key, (draft[def.key] ?? '').trim());
    feedback.start();
    startTransition(async () => {
      const res = await onSave(fd);
      if (!res.ok) {
        feedback.fail();
        setErr(res.error ?? 'Save failed');
        return;
      }
      feedback.done();
      setSaved(true);
    });
  }

  const dirty = ARTICLE_TOKENS.some(
    (d) => (draft[d.key] ?? '') !== (values[d.key] ?? '')
  );

  return (
    <>
      <p className={styles.cardHint}>
        Typography for every markdown story &mdash; news posts, event write-ups and library
        narratives all share it. Leave a field blank to use the default shown in grey. Changes go
        live everywhere as soon as you save.
      </p>

      <div className={styles.tokenGrid}>
        {ARTICLE_TOKENS.map((def) => (
          <label key={def.key} className={styles.tokenField}>
            <span className={styles.tokenLabel}>{def.label}</span>
            {def.type === 'keyword' ? (
              <select
                className={styles.editInput}
                value={draft[def.key] ?? ''}
                onChange={(e) => set(def.key, e.target.value)}
              >
                <option value="">Default ({def.fallback})</option>
                {(def.options ?? []).map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                className={`${styles.editInput} ${
                  invalid.includes(def.key) ? styles.tokenInvalid : ''
                }`}
                value={draft[def.key] ?? ''}
                placeholder={def.fallback}
                aria-label={def.label}
                aria-invalid={invalid.includes(def.key)}
                onChange={(e) => set(def.key, e.target.value)}
              />
            )}
            <span className={styles.tokenHint}>{def.hint}</span>
          </label>
        ))}
      </div>

      {invalid.length > 0 && (
        <Notice>
          {invalid.length === 1 ? 'One value is not usable' : `${invalid.length} values are not usable`}
          {' '}&mdash; sizes need a unit (16px, 1.1rem, 90%) and line height is a plain number
          (1.6).
        </Notice>
      )}
      {err && <Notice>{err}</Notice>}

      <div className={styles.tokenActions}>
        {saved && <span className={styles.tokenSaved}>Saved &mdash; live on the site.</span>}
        <button
          type="button"
          className={styles.editBtn}
          onClick={() => {
            setDraft({});
            setSaved(false);
          }}
          disabled={isPending}
          title="Clear every field, restoring the built-in defaults"
        >
          Reset to defaults
        </button>
        <SaveButton
          className={styles.editSaveBtn}
          dirty={dirty}
          pending={isPending}
          dirtyLabel="Save styling"
          blocked={invalid.length > 0}
          blockedReason="Fix the highlighted values first"
          onClick={save}
        />
        <SaveFeedback phase={feedback.phase} />
      </div>
    </>
  );
}
