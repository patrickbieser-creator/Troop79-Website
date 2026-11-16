/**
 * /admin/advancement/approvals/[id] — one approved proof submission, read-only (Patrick, 2026-11-15).
 *
 * Everything the record holds: the scout and requirement, who filed it and how, the proof itself (write-up, link,
 * photos), who approved it and when, and the ledger entry the approval wrote — including whether that entry has
 * since been deleted, and by whom.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { requireCapability } from '@/lib/require-capability';
import { loadApprovalDetail } from '@/lib/proof-approvals';
import { splitFiledByLine } from '@/lib/library';
import { fmtDate, fmtDateTime } from '@/lib/format-date';
import { FormPanel } from '../../../../_components/form-panel';
import { PageTitle } from '../../../_components/page-title';
import styles from '../approvals.module.css';

export const metadata = {
  title: 'Approval — Troop 79 Admin'
};

const PROOF_TYPE_LABEL = { photo: 'Photo', report: 'Write-up', link: 'Link' } as const;
const VIA_LABEL = { family: 'Family', scout: 'Scout' } as const;

export default async function ApprovalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireCapability('advancement.write');
  const { id } = await params;
  const num = Number(id);
  if (!Number.isInteger(num) || num <= 0) notFound();
  const d = await loadApprovalDetail(createAdminClient(), num);
  if (!d) notFound();

  const s = d.submission;
  const { filedBy, body } = splitFiledByLine(s.body_md);

  return (
    <>
      <PageTitle
        back={{ label: 'Approvals', href: '/admin/advancement/approvals' }}
        title={`${d.scoutName} — ${d.requirement}`}
      />
      <div className={styles.panels}>
        <FormPanel title="Submission">
          <dl className={styles.dl}>
            <dt>Scout</dt>
            <dd>{d.scoutName}</dd>
            <dt>Requirement</dt>
            <dd>{d.requirementHref ? <Link href={d.requirementHref}>{d.requirement}</Link> : d.requirement}</dd>
            <dt>Submitted</dt>
            <dd>{fmtDateTime(s.created_at)}</dd>
            <dt>Submitted by</dt>
            <dd>{d.submitterName ?? <span className={styles.muted}>Not recorded</span>}</dd>
            <dt>Filed as</dt>
            <dd>{VIA_LABEL[s.submitted_via]}</dd>
            {filedBy && (
              <>
                <dt>Filed for</dt>
                <dd>{filedBy}</dd>
              </>
            )}
            <dt>Proof</dt>
            <dd>{PROOF_TYPE_LABEL[s.proof_type]}</dd>
            {body && (
              <>
                <dt>Write-up</dt>
                <dd>
                  <p className={styles.writeup}>{body}</p>
                </dd>
              </>
            )}
            {s.link_url && (
              <>
                <dt>Link</dt>
                <dd>
                  <a href={s.link_url} target="_blank" rel="noopener noreferrer">
                    {s.link_url} ↗
                  </a>
                </dd>
              </>
            )}
            {(s.media?.length ?? 0) > 0 && (
              <>
                <dt>Photos</dt>
                <dd>
                  {d.photoUrls.length > 0 ? (
                    <div className={styles.thumbRow}>
                      {d.photoUrls.map((url) => (
                        <a
                          key={url}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.thumbLink}
                          title="Open the full-size photo in a new tab"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={url} alt="Proof submitted by the scout or family" className={styles.thumb} />
                        </a>
                      ))}
                    </div>
                  ) : (
                    <span className={styles.muted}>Photo unavailable</span>
                  )}
                </dd>
              </>
            )}
          </dl>
        </FormPanel>

        <FormPanel title="Approval">
          <dl className={styles.dl}>
            <dt>Approved by</dt>
            <dd>{s.reviewed_by ?? '—'}</dd>
            <dt>Approved</dt>
            <dd>{fmtDateTime(s.reviewed_at)}</dd>
            {s.feedback_md && (
              <>
                <dt>Note</dt>
                <dd>
                  <p className={styles.writeup}>{s.feedback_md}</p>
                </dd>
              </>
            )}
          </dl>
        </FormPanel>

        <FormPanel title="Ledger entry">
          {d.ledger ? (
            <dl className={styles.dl}>
              <dt>Status</dt>
              <dd>
                {d.ledger.deletedAt ? (
                  <span className={styles.deleted}>
                    Deleted {fmtDateTime(d.ledger.deletedAt)}
                    {d.ledger.deletedBy ? ` by ${d.ledger.deletedBy}` : ''}
                  </span>
                ) : (
                  'On the record'
                )}
              </dd>
              {d.ledger.deletedReason && (
                <>
                  <dt>Reason</dt>
                  <dd>{d.ledger.deletedReason}</dd>
                </>
              )}
              <dt>Date</dt>
              <dd>{fmtDate(d.ledger.date)}</dd>
              <dt>Signed</dt>
              <dd>{d.ledger.by ?? '—'}</dd>
              <dt>Entered by</dt>
              <dd>
                {d.ledger.enteredBy ?? '—'}
                {d.ledger.enteredAt ? `, ${fmtDateTime(d.ledger.enteredAt)}` : ''}
              </dd>
              <dt>Entry</dt>
              <dd>#{d.ledger.id}</dd>
            </dl>
          ) : (
            <p className={styles.muted}>No ledger entry is linked to this approval.</p>
          )}
        </FormPanel>
      </div>
    </>
  );
}
