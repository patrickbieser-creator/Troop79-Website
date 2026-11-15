'use client';

/**
 * The person record page, one form / one Save (Plans/Person-Record-One-Save.md; replaces
 * the per-section Edit model of Person-Editor-Rethink Direction A).
 *
 * Header (name, badges, one line of contact facts), then ONE sticky record bar — Save /
 * Discard changes and a status line on the left, Send sign-in link and More actions… on
 * the right — then the numbered sections in the main column and the rail (To finish,
 * Recent changes) beside them.
 *
 * Everything a leader can change here is ONE draft (record-draft.ts): fields, status,
 * emails, household, family links, roles and initials. Save sends the whole draft to
 * savePersonRecord, which diffs it against the saved record and commits it in one
 * database transaction. While the draft touches the household or family, a debounced
 * preview names the links the save would ALSO add or end ("Saving will also link …").
 * After a save, router.refresh() brings the new record and the draft resets to it.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { fmtDate } from '@/lib/format-date';
import { PageTitle } from '../../../_components/page-title';
import { Badge } from '../../../_components/badge';
import { Notice } from '../../../_components/notice';
import { DiscardButton, SaveButton, SaveFeedback, SaveProblem, useSavePhase } from '../../../_components/save-state';
import { useRegisterDirty } from '../../../_components/dirty-guard';
import { CrossoverCard } from './crossover-card';
import { HistoryDialog, type HistoryView } from './history-dialog';
import { SendSignInLink, type SendLinkResult } from './send-sign-in-link';
import { FamilyAddedNotice, PendingBanner } from './pending-banner';
import { currentValuesFor, type SectionKey } from './pending-map';
import { MoreActions } from './more-actions';
import { ContactSection, FamilySection, HealthSection, NameSection, RolesSection, describe, joinNames, uniqueLinks } from './record-sections';
import { diffDraft, draftFromRecord, draftKey, draftProblems, toFinish, type RecordDraft } from './record-draft';
import { previewPersonRecordSave, savePersonRecord, type LinkChange } from './save-record-actions';
import { TAB_LABEL, type PersonHistoryEntry, type PersonRecord as PersonRecordData, type RosterTab } from './record-types';
import { FormPanel } from '../../../../_components/form-panel';
import styles from './record.module.css';

const ROSTER = '/admin/advancement/roster';
const KIND_LABEL = { scout: 'Scout', leader: 'Leader', adult: 'Adult' } as const;

const str = (v: unknown) => (v == null ? '' : String(v));

export function PersonRecord({ record, from }: { record: PersonRecordData; from: RosterTab }) {
  const router = useRouter();
  const [base, setBase] = useState(record);
  const [draft, setDraftState] = useState<RecordDraft>(() => draftFromRecord(record));
  const [justSaved, setJustSaved] = useState(false);
  const saved = useMemo(() => draftFromRecord(base), [base]);
  const dirty = draftKey(draft) !== draftKey(saved);

  // New props after a save (router.refresh) or another change: the draft follows the
  // record unless the leader is mid-edit.
  if (record !== base) {
    setBase(record);
    if (!dirty || justSaved) {
      setDraftState(draftFromRecord(record));
      setJustSaved(false);
    }
  }

  useRegisterDirty(dirty);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const setDraft = useCallback((fn: (d: RecordDraft) => RecordDraft) => setDraftState((d) => fn(d)), []);

  const phase = useSavePhase();
  const [tried, setTried] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ variant: 'success' | 'error'; message: string } | null>(null);
  const [historyView, setHistoryView] = useState<HistoryView | null>(null);
  const [resolvedRequestId, setResolvedRequestId] = useState<number | null>(null);
  const [resolvedNoticeId, setResolvedNoticeId] = useState<number | null>(null);

  const problems = draftProblems(draft, base);
  const shownProblems = tried ? problems : [];
  const problemFor = (fieldId: string) => shownProblems.find((p) => p.fieldId === fieldId)?.message ?? null;

  const householdLabels = useMemo(() => new Map(base.households.map((h) => [String(h.id), h.label])), [base.households]);
  const schoolLabels = useMemo(() => new Map((base.schools ?? []).map((s) => [String(s.id), s.name])), [base.schools]);
  const diff = diffDraft(base, draft, {
    schoolName: (id) => schoolLabels.get(id) ?? 'a new school',
    householdLabel: (id) => householdLabels.get(id) ?? 'household'
  });
  const touchesFamily = !!diff.payload.household || !!diff.payload.relationships;

  // "Saving will also link …" and the remove-from-household question both come from the
  // database's own dry run, debounced while the draft changes.
  const [also, setAlso] = useState<LinkChange[]>([]);
  const [endable, setEndable] = useState<LinkChange[]>([]);
  const familyKey = JSON.stringify([draft.householdId, draft.endLinks, draft.family, draft.addMembers.map((m) => m.personId)]);
  const householdMoving = draft.householdId !== saved.householdId && !!saved.householdId;
  useEffect(() => {
    if (!touchesFamily) return;
    let live = true;
    const t = setTimeout(() => {
      void previewPersonRecordSave(base.personId, draft).then((r) => {
        if (live) setAlso(uniqueLinks(r.also));
      });
      if (householdMoving) {
        void previewPersonRecordSave(base.personId, { ...draft, endLinks: true }).then((r) => {
          if (live) setEndable(uniqueLinks(r.also.filter((l) => l.change === 'removed')));
        });
      }
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // familyKey stands in for the parts of the draft the preview reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyKey, base.personId, touchesFamily, householdMoving]);
  const alsoShown = touchesFamily ? also.filter((l) => !(l.change === 'removed' && !draft.endLinks)) : [];

  function focusField(fieldId: string) {
    const el = document.getElementById(fieldId) ?? document.querySelector<HTMLElement>(`[name="${fieldId}"]`);
    if (!el) return;
    el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    el.focus({ preventScroll: true });
  }

  function onBlocked() {
    setTried(true);
    if (problems[0]) focusField(problems[0].fieldId);
  }

  function discard() {
    setDraftState(saved);
    setTried(false);
    setSaveError(null);
    setAlso([]);
    setEndable([]);
  }

  function save() {
    setTried(true);
    setSaveError(null);
    setNotice(null);
    phase.start();
    void savePersonRecord(base.personId, draft)
      .then((res) => {
        if (!res.ok) {
          phase.fail();
          setSaveError(res.error);
          if (res.problems?.[0]) focusField(res.problems[0].fieldId);
          return;
        }
        phase.done();
        setTried(false);
        setJustSaved(true);
        setAlso([]);
        setEndable([]);
        const others = uniqueLinks(res.links).filter((l) => l.person_id !== base.personId && l.related_person_id !== base.personId);
        if (others.length > 0) {
          setNotice({ variant: 'success', message: `Saved. Also ${others[0].change === 'added' ? 'linked' : 'unlinked'} ${joinNames(others.map((l) => describe(l)))}.` });
        }
        router.refresh();
      })
      .catch(() => {
        phase.fail();
        setSaveError('Couldn’t save the record. Nothing was changed. Try again.');
      });
  }

  // The family's pending request / notice (unchanged review flow).
  const pending = base.pending && base.pending.id !== resolvedRequestId ? base.pending : null;
  const familyNotice = base.familyNotice && base.familyNotice.id !== resolvedNoticeId ? base.familyNotice : null;
  const pendingCurrent = pending ? currentValuesFor(base, pending.entityType) : null;
  function banner(section: SectionKey) {
    if (!pending || !pendingCurrent) return null;
    return (
      <PendingBanner
        request={pending}
        section={section}
        current={pendingCurrent}
        today={base.today}
        onResolved={() => {
          setResolvedRequestId(pending.id);
          router.refresh();
        }}
      />
    );
  }

  const { detail, scout, kind } = base;
  const f = detail.fields;
  const name = base.displayName;
  const isScout = kind === 'scout' && scout != null;
  const primary = base.emails.find((e) => e.isPrimary) ?? base.emails[0] ?? null;
  const phone = str(f.primary_phone);
  const bsa = str(f.bsa_member_id);
  const family = base.family ?? [];
  const childrenOf = family.filter((r) => r.links.some((l) => l.outgoing && (l.type === 'parent_of' || l.type === 'guardian_of')));
  const parents = family.filter((r) => r.links.some((l) => !l.outgoing && (l.type === 'parent_of' || l.type === 'guardian_of')));
  const currentTab: RosterTab = base.tab;
  const history = base.history ?? { latest: [], total: 0, withDetails: 0 };
  const last = history.latest[0];
  const emailsDirty = diff.changed.includes('Email addresses');
  const items = toFinish(base);
  const busy = phase.phase === 'saving';

  const contactBits: React.ReactNode[] = [];
  if (primary) contactBits.push(<a key="e" href={`mailto:${primary.email}`}>{primary.email}</a>);
  else if (isScout) {
    contactBits.push(
      <span key="e">Signs in through {parents.length ? joinNames(parents.map((p) => p.name)) : 'a parent (none linked)'}</span>
    );
  } else contactBits.push(<span key="e" className={styles.muted}>no email on file</span>);
  if (phone) contactBits.push(<a key="p" href={`tel:${phone}`}>{phone}</a>);
  if (bsa) contactBits.push(<span key="b">BSA {bsa}</span>);
  if (!isScout && childrenOf.length) contactBits.push(<span key="c">Parent of {joinNames(childrenOf.map((c) => c.name))}</span>);

  const changedCount = diff.changed.length;

  return (
    <>
      <PageTitle
        back={{ label: TAB_LABEL[from], href: `${ROSTER}?tab=${from}` }}
        title={name}
        sub={
          <>
            <span className={styles.badges}>
              <Badge variant={kind === 'adult' ? 'neutral' : 'info'}>{scout?.is_webelos ? 'Webelos' : KIND_LABEL[kind]}</Badge>
              {!scout?.is_webelos &&
                (base.status.active ? <Badge variant="success">Active</Badge> : <Badge variant="muted">Inactive</Badge>)}
              {isScout && base.rankLabel ? (
                <Link href="/advancement" title="Open advancement">
                  <Badge variant="neutral">{base.rankLabel}</Badge>
                </Link>
              ) : null}
              {base.isTest ? <Badge variant="warning">Test record</Badge> : null}
            </span>
            <span className={styles.contact}>
              {contactBits.map((b, i) => (
                <span key={i}>
                  {i > 0 ? ' · ' : ''}
                  {b}
                </span>
              ))}
            </span>
          </>
        }
      />

      <div className={[styles.bar, dirty ? styles.barDirty : ''].join(' ')} role="region" aria-label="Record actions">
        <SaveButton dirty={dirty} pending={busy} blocked={problems.length > 0} onBlocked={onBlocked} onClick={save} />
        <DiscardButton dirty={dirty} pending={busy} onClick={discard} />
        <span className={styles.barStatus} aria-live="polite">
          {saveError ? (
            <span className={styles.problem}>{saveError}</span>
          ) : shownProblems.length > 0 ? (
            <SaveProblem reason={shownProblems[0].message} more={shownProblems.length - 1} />
          ) : dirty ? (
            <>
              <strong>
                {changedCount} unsaved change{changedCount === 1 ? '' : 's'}:
              </strong>{' '}
              {diff.changed.join(', ')}
            </>
          ) : last ? (
            <>
              Last change {fmtDate(last.occurredAt)} by {last.actorLabel} ·{' '}
              <button type="button" className={styles.linkBtn} onClick={() => setHistoryView({ mode: 'log' })}>
                History ({history.total})
              </button>
            </>
          ) : (
            'No changes recorded yet'
          )}
          {alsoShown.length > 0 && (
            <span className={styles.also}>
              Saving will also {alsoShown.some((l) => l.change === 'added') ? 'link ' : ''}
              {joinNames(alsoShown.filter((l) => l.change === 'added').map((l) => describe(l)))}
              {alsoShown.some((l) => l.change === 'added') && alsoShown.some((l) => l.change === 'removed') ? ', and remove ' : ''}
              {!alsoShown.some((l) => l.change === 'added') && alsoShown.some((l) => l.change === 'removed') ? 'remove ' : ''}
              {joinNames(alsoShown.filter((l) => l.change === 'removed').map((l) => describe(l)))}.
            </span>
          )}
        </span>
        <span className={styles.barRight}>
          {(kind !== 'scout' || base.emails.length > 0) && (
            <SendSignInLink
              personId={base.personId}
              kind={kind}
              emails={base.emails}
              heldReason={emailsDirty ? 'Save the email changes first' : null}
              onResult={(r: SendLinkResult) => {
                setNotice(r);
                if (r.variant === 'success') router.refresh();
              }}
            />
          )}
          <MoreActions
            personId={base.personId}
            name={name}
            kind={kind}
            from={from}
            active={base.status.active}
            scout={scout}
            leaderCode={base.initials?.code ?? null}
            isTest={base.isTest ?? false}
            counts={{ emails: base.emails.length, relationships: detail.relationships.length, roles: detail.roles.length }}
            householdLabel={base.household?.label ?? null}
            disabled={dirty || busy}
            onNotice={setNotice}
          />
        </span>
      </div>
      <SaveFeedback phase={phase.phase} />

      {(currentTab !== from || notice) && (
        <div className={styles.noticeStack}>
          {notice && <Notice variant={notice.variant}>{notice.message}</Notice>}
          {currentTab !== from && (
            <Notice variant="info">
              {name} now appears under <strong>{TAB_LABEL[currentTab]}</strong>, not {TAB_LABEL[from]}.
            </Notice>
          )}
        </div>
      )}

      <div className={styles.cols}>
        <div className={styles.main}>
          {familyNotice && (
            <FamilyAddedNotice
              notice={familyNotice}
              name={name}
              onAcknowledged={() => {
                setResolvedNoticeId(familyNotice.id);
                router.refresh();
              }}
            />
          )}
          {isScout && (scout.is_webelos || scout.crossed_over_on) && (
            <CrossoverCard
              scoutId={scout.id}
              name={name}
              isWebelos={!!scout.is_webelos}
              crossedOverOn={scout.crossed_over_on ?? null}
              bsaMemberId={bsa || null}
              today={base.today}
            />
          )}
          <FormPanel className={styles.form} aria-label={`${name}’s record`}>
            {(() => {
              const props = { record: base, draft, saved, setDraft, problem: problemFor, disabled: busy, banner };
              return (
                <>
                  <NameSection {...props} num={1} />
                  <HealthSection {...props} num={2} />
                  <ContactSection {...props} num={3} />
                  <FamilySection {...props} num={4} from={from} endable={endable} />
                  {!isScout && <RolesSection {...props} num={5} />}
                </>
              );
            })()}
          </FormPanel>
        </div>

        <aside className={styles.rail} aria-label="About this record">
          <section className={styles.railCard} aria-labelledby="pr-todo-h">
            <h2 id="pr-todo-h">To finish</h2>
            {items.length > 0 ? (
              <ul className={styles.todo}>
                {items.map((it) => (
                  <li key={it.key}>
                    <button type="button" onClick={() => focusField(it.fieldId)}>
                      {it.label}
                      {it.optional ? <span className={styles.muted}> (optional)</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.todoDone}>Nothing left to fill in.</p>
            )}
          </section>
          <section className={styles.railCard} aria-labelledby="pr-recent-h">
            <h2 id="pr-recent-h">Recent changes</h2>
            {history.latest.length > 0 ? (
              <>
                <ul className={styles.recent}>
                  {history.latest.slice(0, 3).map((e: PersonHistoryEntry) => (
                    <li key={e.id}>
                      <button type="button" onClick={() => setHistoryView({ mode: 'detail', entry: e, fromLog: false })}>
                        <span className={styles.recentWhat}>{e.summary}</span>
                        <span className={styles.recentWhen}>
                          {fmtDate(e.occurredAt)} · {e.actorLabel}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <div className={styles.railMore}>
                  <button type="button" className={styles.linkBtn} onClick={() => setHistoryView({ mode: 'log' })}>
                    All {history.total} change{history.total === 1 ? '' : 's'}
                  </button>
                </div>
              </>
            ) : (
              <p className={styles.todoDone}>No changes recorded yet.</p>
            )}
          </section>
        </aside>
      </div>

      {historyView && (
        <HistoryDialog
          personId={base.personId}
          name={name}
          view={historyView}
          onView={setHistoryView}
          onClose={() => setHistoryView(null)}
        />
      )}
    </>
  );
}
