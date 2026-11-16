'use client';

/**
 * The body of the admin Health Forms sheet (Plans/Admin-Health-Forms.md, phase 2: view only). What the family told
 * us, who to call, each document with its status and pages, and the review. Writes (upload, replace, remove, Mark
 * complete) arrive in phase 3. Status rules come from lib/health-records; nothing is re-derived here.
 */
import { HEALTH_KIND, HEALTH_KINDS, HEALTH_STATUS_LABEL, kindStatus, pageName } from '@/lib/health-records';
import type { HealthRecordView } from '@/lib/health-store';
import { fmtDate } from '@/lib/format-date';
import { Badge } from '../_components/badge';
import styles from './health-forms.module.css';

const digits = (phone: string) => phone.replace(/[^\d+]/g, '');

export function HealthSheet({ record, today }: { record: HealthRecordView; today: string }) {
  return (
    <div className={styles.sheet}>
      <dl className={styles.dl}>
        <dt>What the family told us</dt>
        <dd>
          {record.told ?? <span className={styles.muted}>Nothing written.</span>}
          <span className={styles.hint}>Typed by the family, not read from the form.</span>
        </dd>
        {record.contacts.length > 0 && (
          <>
            <dt>Who to call</dt>
            <dd>
              <ul className={styles.contacts}>
                {record.contacts.map((c) => (
                  <li key={c.personId}>
                    {c.name}
                    {c.phone ? (
                      <>
                        {' · '}
                        {c.phone}{' '}
                        <a href={`tel:${digits(c.phone)}`}>Call</a> <a href={`sms:${digits(c.phone)}`}>Text</a>
                      </>
                    ) : (
                      <span className={styles.muted}> · no phone on file</span>
                    )}
                  </li>
                ))}
              </ul>
            </dd>
          </>
        )}
      </dl>

      <ul className={styles.docs}>
        {HEALTH_KINDS.map((k) => {
          const mine = record.pages.filter((p) => p.kind === k);
          const status = kindStatus(k, mine, today);
          const expires = mine.map((p) => p.expiresOn).filter((d): d is string => !!d).sort()[0];
          const notNeeded = mine.length === 0 && !HEALTH_KIND[k].required;
          return (
            <li key={k} className={styles.doc}>
              <div className={styles.docHead}>
                <span className={styles.docName}>{HEALTH_KIND[k].label}</span>
                {notNeeded ? (
                  <Badge variant="muted">Not needed</Badge>
                ) : (
                  <Badge variant={status === 'on_file' ? 'success' : status === 'expires_soon' ? 'warning' : 'danger'}>
                    {HEALTH_STATUS_LABEL[status]}
                  </Badge>
                )}
                {expires && <span className={styles.muted}>Good until {fmtDate(expires)}</span>}
              </div>
              {mine.length > 0 && (
                <ul className={styles.pages}>
                  {mine.map((p) => (
                    <li key={p.id}>
                      <a href={`/api/health-files/${p.id}`} target="_blank" rel="noopener noreferrer">
                        {p.contentType === 'application/pdf' ? 'Download' : 'View'} {pageName(k, p.page).toLowerCase()}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      <p className={styles.review}>
        {record.review ? `Reviewed by ${record.review.byName} · ${fmtDate(record.review.at)}` : 'Not reviewed yet.'}
      </p>
    </div>
  );
}
