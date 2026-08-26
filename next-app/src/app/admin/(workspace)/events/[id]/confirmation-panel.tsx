'use client';

/**
 * The signup builder's "Confirmation email" block (Plans/Signup-Confirmation-
 * Email.md): off by default; when on, a Family receipt and a Leader
 * notification, each picking a library template (kind-filtered) or a per-event
 * customization written in the shared message editor. One Save for the whole
 * block through updateConfirmation, per the Save standard.
 */
import { useCallback, useEffect, useId, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  DEFAULT_TEMPLATES,
  MAX_LEADER_RECIPIENTS,
  isEmail,
  normaliseEmail,
  renderMessage,
  resolveMessage,
  type Audience,
  type ConfirmationContext
} from '@/lib/signup-confirmation';
import { listSignupHouseholds, previewConfirmationContext, updateConfirmation } from '../actions';
import type { EmailTemplateRow } from '../../advancement/lookups/email-template-actions';
import { MessageEditorDialog } from '../../_components/message-editor-dialog';
import { Notice } from '../../_components/notice';
import { Badge } from '../../_components/badge';
import { DiscardButton, SaveButton, SaveFeedback, useDraftSnapshot, useSavePhase } from '../../_components/save-state';
import { FormPanel, FormSection } from '../../../_components/form-panel';
import { HelpBadge } from '../../../_components/help-badge';
import { Button } from '../../../_components/button';
import styles from '../events-admin.module.css';

type Rec = Record<string, unknown>;
const b = (v: unknown) => v === true;
const s = (v: unknown) => (v == null ? '' : String(v));
const n = (v: unknown) => (v == null || v === '' ? null : Number(v));

interface Draft {
  enabled: boolean;
  familyEnabled: boolean;
  familyTemplateId: number | null;
  familySubject: string | null;
  familyBody: string | null;
  leaderEnabled: boolean;
  leaderTemplateId: number | null;
  leaderSubject: string | null;
  leaderBody: string | null;
  leaderUseFamily: boolean;
  recipients: string[];
}

function fromRow(signup: Rec): Draft {
  const list = Array.isArray(signup.confirm_recipients) ? (signup.confirm_recipients as string[]) : [];
  return {
    enabled: b(signup.confirm_family_enabled) || b(signup.confirm_leader_enabled),
    familyEnabled: b(signup.confirm_family_enabled),
    familyTemplateId: n(signup.confirm_family_template_id),
    familySubject: signup.confirm_family_subject == null ? null : s(signup.confirm_family_subject),
    familyBody: signup.confirm_family_body == null ? null : s(signup.confirm_family_body),
    leaderEnabled: b(signup.confirm_leader_enabled),
    leaderTemplateId: n(signup.confirm_leader_template_id),
    leaderSubject: signup.confirm_leader_subject == null ? null : s(signup.confirm_leader_subject),
    leaderBody: signup.confirm_leader_body == null ? null : s(signup.confirm_leader_body),
    leaderUseFamily: b(signup.confirm_leader_use_family),
    recipients: Array.from({ length: MAX_LEADER_RECIPIENTS }, (_, i) => list[i] ?? '')
  };
}

/** Per-field problems for the five address inputs — mirrors validateLeaderRecipients. */
export function recipientErrors(list: string[]): (string | null)[] {
  const seen = new Set<string>();
  return list.map((raw) => {
    const e = normaliseEmail(raw);
    if (!e) return null;
    if (!isEmail(e)) return 'Not an email address.';
    if (seen.has(e)) return 'Listed twice.';
    seen.add(e);
    return null;
  });
}

export function ConfirmationPanel({
  signupId,
  calendarEntryId,
  signup,
  templates,
  previewCtx
}: {
  signupId: number;
  calendarEntryId: number;
  signup: Rec;
  templates: EmailTemplateRow[];
  previewCtx: ConfirmationContext;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => fromRow(signup));
  const snap = useDraftSnapshot(draft);
  const [pending, start] = useTransition();
  const feedback = useSavePhase();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Audience | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const ids = { master: useId(), fam: useId(), famTpl: useId(), lead: useId(), useFam: useId(), leadTpl: useId(), addr: useId() };

  useEffect(() => {
    if (editing) dialogRef.current?.showModal();
  }, [editing]);

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  // Preview as a real household on this signup (the dialog loads them lazily).
  const loadHouseholds = useCallback(() => listSignupHouseholds(signupId), [signupId]);
  const loadContext = useCallback((householdId: number) => previewConfirmationContext(signupId, householdId), [signupId]);
  const errs = recipientErrors(draft.recipients);
  const blocked = errs.some(Boolean);

  const templateFor = (audience: Audience): EmailTemplateRow | null => {
    const id = audience === 'family' ? draft.familyTemplateId : draft.leaderTemplateId;
    return templates.find((t) => t.id === id) ?? null;
  };
  const overrideFor = (audience: Audience) =>
    audience === 'family'
      ? { subject: draft.familySubject, body: draft.familyBody }
      : { subject: draft.leaderSubject, body: draft.leaderBody };
  const resolved = (audience: Audience) => resolveMessage(audience, overrideFor(audience), templateFor(audience));
  const customized = (audience: Audience) => !!(overrideFor(audience).subject && overrideFor(audience).body);

  function save() {
    setError(null);
    feedback.start();
    start(async () => {
      const on = draft.enabled;
      const res = await updateConfirmation(signupId, calendarEntryId, {
        familyEnabled: on && draft.familyEnabled,
        familyTemplateId: draft.familyTemplateId,
        familySubject: draft.familySubject,
        familyBody: draft.familyBody,
        leaderEnabled: on && draft.leaderEnabled,
        leaderTemplateId: draft.leaderTemplateId,
        leaderSubject: draft.leaderSubject,
        leaderBody: draft.leaderBody,
        leaderUseFamily: draft.leaderUseFamily,
        recipients: draft.recipients.filter((r) => r.trim())
      });
      if (!res.ok) {
        feedback.fail();
        setError(res.error ?? 'Could not save.');
        return;
      }
      snap.markSaved();
      feedback.done();
      router.refresh();
    });
  }

  function picker(audience: Audience, id: string) {
    const kind = audience === 'family' ? 'signup.family' : 'signup.leader';
    const current = audience === 'family' ? draft.familyTemplateId : draft.leaderTemplateId;
    const options = templates.filter((t) => t.kind === kind && (!t.retired_at || t.id === current));
    const isCustom = customized(audience);
    return (
      <>
        <label className={styles.fullField} htmlFor={id}>
          <span className={`adminLabel ${styles.fieldLabel}`}>Template</span>
          <select
            id={id}
            value={current ?? ''}
            onChange={(e) => {
              const v = e.target.value ? Number(e.target.value) : null;
              set(audience === 'family' ? { familyTemplateId: v } : { leaderTemplateId: v });
            }}
          >
            <option value="">Built-in default</option>
            {options.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.retired_at ? ' (retired)' : ''}
              </option>
            ))}
          </select>
        </label>
        <p className={styles.confirmSubject}>
          <span className={styles.addHint}>Subject: </span>
          {renderMessage(resolved(audience), previewCtx, audience).subject}
          {isCustom && (
            <>
              {' '}
              <Badge variant="muted">Customized</Badge>
            </>
          )}
        </p>
        <div className={styles.confirmActions}>
          <Button variant="secondary" size="sm" onClick={() => setEditing(audience)}>
            Customize for this event…
          </Button>
          {isCustom && (
            <Button
              variant="quiet"
              size="sm"
              onClick={() =>
                set(audience === 'family' ? { familySubject: null, familyBody: null } : { leaderSubject: null, leaderBody: null })
              }
            >
              Reset to template
            </Button>
          )}
        </div>
      </>
    );
  }

  const lastError = s(signup.confirm_last_error);

  return (
    <FormPanel
      title={<>Confirmation email <HelpBadge id="signup.confirmation" /></>}
      actions={
        <>
          <DiscardButton dirty={snap.dirty} pending={pending} onClick={() => setDraft(snap.saved)} />
          <SaveButton dirty={snap.dirty} pending={pending} blocked={blocked} blockedReason="Fix the leader addresses first" onClick={save} />
        </>
      }
    >
      <p className={styles.panelHint}>
        Sent automatically when a family submits, updates or cancels a signup. Pick a library template per audience, or
        customize the words for this event only.
      </p>
      {lastError && <Notice>Last send failed: {lastError}</Notice>}
      {error && <Notice>{error}</Notice>}
      <label className={styles.toggleRow} htmlFor={ids.master}>
        <input id={ids.master} type="checkbox" checked={draft.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        <span>
          <strong>Send confirmation emails</strong>
          <span className={styles.toggleHint}>Off: nothing is sent for this signup.</span>
        </span>
      </label>

      {draft.enabled && (
        <>
          <FormSection num={1} title="Family receipt">
            <label className={styles.toggleRow} htmlFor={ids.fam}>
              <input id={ids.fam} type="checkbox" checked={draft.familyEnabled} onChange={(e) => set({ familyEnabled: e.target.checked })} />
              <span>
                <strong>Email the family a receipt</strong>
                <span className={styles.toggleHint}>Every signed-up member with an email, plus the adult who submitted.</span>
              </span>
            </label>
            {draft.familyEnabled && picker('family', ids.famTpl)}
          </FormSection>

          <FormSection num={2} title="Leader notification">
            <label className={styles.toggleRow} htmlFor={ids.lead}>
              <input id={ids.lead} type="checkbox" checked={draft.leaderEnabled} onChange={(e) => set({ leaderEnabled: e.target.checked })} />
              <span>
                <strong>Notify leaders of each signup</strong>
              </span>
            </label>
            {draft.leaderEnabled && (
              <>
                <label className={styles.toggleRow} htmlFor={ids.useFam}>
                  <input
                    id={ids.useFam}
                    type="checkbox"
                    checked={draft.leaderUseFamily}
                    onChange={(e) => set({ leaderUseFamily: e.target.checked })}
                  />
                  <span>
                    <strong>Use the family message</strong>
                  </span>
                </label>
                {draft.leaderUseFamily ? (
                  <p className={styles.panelHint}>Leaders receive exactly what the family receives.</p>
                ) : (
                  picker('leader', ids.leadTpl)
                )}
                <div className={styles.fieldGrid}>
                  {draft.recipients.map((addr, i) => (
                    <label key={i} htmlFor={`${ids.addr}-${i}`}>
                      <span className={`adminLabel ${styles.fieldLabel}`}>Leader address {i + 1}</span>
                      <input
                        id={`${ids.addr}-${i}`}
                        type="email"
                        value={addr}
                        aria-invalid={errs[i] ? true : undefined}
                        onChange={(e) => {
                          const next = [...draft.recipients];
                          next[i] = e.target.value;
                          set({ recipients: next });
                        }}
                      />
                      {errs[i] && <span className={styles.err}>{errs[i]}</span>}
                    </label>
                  ))}
                </div>
                <p className={styles.addHint}>Reply-To is the first address.</p>
              </>
            )}
          </FormSection>
        </>
      )}

      {editing && (
        <MessageEditorDialog
          key={editing}
          ref={dialogRef}
          kind={editing === 'family' ? 'signup.family' : 'signup.leader'}
          title={editing === 'family' ? 'Customize the family receipt' : 'Customize the leader notification'}
          initial={customized(editing) ? (overrideFor(editing) as { subject: string; body: string }) : (templateFor(editing) ?? DEFAULT_TEMPLATES[editing])}
          previewCtx={previewCtx}
          loadHouseholds={loadHouseholds}
          loadContext={loadContext}
          onSave={async (subject, body) => {
            set(editing === 'family' ? { familySubject: subject, familyBody: body } : { leaderSubject: subject, leaderBody: body });
            return { ok: true };
          }}
          onClose={() => setEditing(null)}
        />
      )}
      <SaveFeedback phase={feedback.phase} />
    </FormPanel>
  );
}
