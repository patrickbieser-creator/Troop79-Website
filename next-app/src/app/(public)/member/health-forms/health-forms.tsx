'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/app/_components/button';
import { Badge, type BadgeTone } from '@/app/_components/badge';
import { DateField } from '@/app/_components/date-field';
import surface from '@/app/_components/card.module.css';
import { fmtDate } from '@/lib/format-date';
import {
  HEALTH_KIND,
  HEALTH_KINDS,
  HEALTH_STATUS_LABEL,
  effectiveOn,
  expiresOn,
  kindStatus,
  nextPage,
  pageName,
  personStatus,
  type HealthKind,
  type HealthPage,
  type HealthStatus
} from '@/lib/health-records';
import { shrinkPhoto } from './shrink-photo';
import type { HealthResult } from './actions';
import styles from './health-forms.module.css';

/**
 * A family's health records (Plans/Health-Forms.md, release 1): one card per person, one block per document, one
 * line per page with View, Replace and Remove. Adding is one tap: choose or take a photo and it is saved; there is
 * no draft to lose. A dated document asks for the two signature dates and shows what they come to.
 */
export interface HealthPerson {
  personId: number;
  name: string;
  isScout: boolean;
}

export interface HealthActions {
  upload: (fd: FormData) => Promise<HealthResult>;
  saveDates: (input: { personId: number; kind: string; parentSigned: string | null; doctorSigned: string | null }) => Promise<HealthResult>;
  remove: (id: string) => Promise<HealthResult>;
}

const TONE: Record<HealthStatus, BadgeTone> = { on_file: 'success', expires_soon: 'warning', expired: 'danger', missing: 'danger' };

export function HealthForms({ people, pages, today, actions }: { people: HealthPerson[]; pages: HealthPage[]; today: string; actions: HealthActions }) {
  return (
    <div className={styles.list}>
      {people.map((p) => {
        const mine = pages.filter((x) => x.personId === p.personId);
        const status = personStatus(mine, today);
        return (
          <section key={p.personId} className={`${surface.card} ${styles.person}`} aria-label={p.name}>
            <h2 className={styles.name}>
              {p.name}
              <Badge tone={TONE[status]}>{status === 'on_file' ? 'On file' : status === 'missing' ? 'Something missing' : HEALTH_STATUS_LABEL[status]}</Badge>
            </h2>
            {HEALTH_KINDS.map((k) => (
              <DocumentBlock key={k} person={p} kind={k} pages={mine.filter((x) => x.kind === k)} today={today} actions={actions} />
            ))}
          </section>
        );
      })}
    </div>
  );
}

function DocumentBlock({ person, kind, pages, today, actions }: { person: HealthPerson; kind: HealthKind; pages: HealthPage[]; today: string; actions: HealthActions }) {
  const def = HEALTH_KIND[kind];
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [parentSigned, setParentSigned] = useState('');
  const [doctorSigned, setDoctorSigned] = useState('');
  const picker = useRef<HTMLInputElement>(null);
  const target = useRef<number | null>(null);

  const status = kindStatus(kind, pages, today);
  const expires = pages.map((p) => p.expiresOn).filter((d): d is string => !!d).sort()[0] ?? null;
  const free = nextPage(kind, pages);
  const typedEffective = effectiveOn(parentSigned || null, doctorSigned || null);
  const optional = !def.required && pages.length === 0;

  const run = (work: () => Promise<HealthResult>) =>
    start(async () => {
      setError(null);
      const res = await work().catch(() => ({ ok: false as const, error: 'Couldn’t save that. Try again in a minute.' }));
      if (!res.ok) setError(res.error);
      else {
        setConfirming(null);
        router.refresh();
      }
    });

  const choose = (page: number) => {
    target.current = page;
    picker.current?.click();
  };

  const onFile = (file: File | undefined) => {
    const page = target.current;
    if (!file || page == null) return;
    run(async () => {
      const small = await shrinkPhoto(file);
      if (!small) return { ok: false, error: 'That photo couldn’t be read. Try taking it again, or choose a PDF.' };
      const fd = new FormData();
      fd.set('personId', String(person.personId));
      fd.set('kind', kind);
      fd.set('page', String(page));
      fd.set('file', small);
      if (def.dated) {
        fd.set('parentSigned', parentSigned);
        fd.set('doctorSigned', doctorSigned);
      }
      return actions.upload(fd);
    });
  };

  return (
    <div className={styles.doc}>
      <div className={styles.docHead}>
        <h3 className={styles.docLabel}>{def.label}</h3>
        {optional ? <span className={styles.optional}>Not needed for most outings</span> : <Badge tone={TONE[status]}>{HEALTH_STATUS_LABEL[status]}</Badge>}
      </div>
      <p className={styles.hint}>
        {expires ? `Good until ${fmtDate(expires)}. ` : ''}
        {def.hint}
      </p>

      {pages.length > 0 && (
        <ul className={styles.pages}>
          {pages.map((p) => (
            <li key={p.id} className={styles.page}>
              <span className={styles.pageName}>
                {pageName(kind, p.page)}
                <span className={styles.pageMeta}>added {fmtDate(p.uploadedAt)}</span>
              </span>
              {confirming === p.id ? (
                <span className={styles.pageActs}>
                  <span className={styles.confirmText}>Remove this page? It is deleted for good.</span>
                  <Button variant="danger" size="sm" disabled={busy} onClick={() => run(() => actions.remove(p.id))}>
                    Remove
                  </Button>
                  <Button variant="ghost" disabled={busy} onClick={() => setConfirming(null)}>
                    Keep
                  </Button>
                </span>
              ) : (
                <span className={styles.pageActs}>
                  <a className={styles.view} href={`/api/health-files/${p.id}`} target="_blank" rel="noopener noreferrer">
                    View
                  </a>
                  <Button variant="ghost" disabled={busy} onClick={() => choose(p.page)} aria-label={`Replace ${pageName(kind, p.page)} of ${def.label} for ${person.name}`}>
                    Replace
                  </Button>
                  <Button variant="dangerGhost" disabled={busy} onClick={() => setConfirming(p.id)} aria-label={`Remove ${pageName(kind, p.page)} of ${def.label} for ${person.name}`}>
                    Remove
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {def.dated && (free != null || pages.length > 0) && (
        <div className={styles.dates}>
          <label className={styles.dateField}>
            <span>Date the parent signed</span>
            <DateField value={parentSigned} onChange={setParentSigned} />
          </label>
          <label className={styles.dateField}>
            <span>Date the doctor signed</span>
            <DateField value={doctorSigned} onChange={setDoctorSigned} />
          </label>
          {typedEffective && <p className={styles.goodUntil}>Good until {fmtDate(expiresOn(typedEffective)!)}</p>}
          {pages.length > 0 && typedEffective && (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => run(() => actions.saveDates({ personId: person.personId, kind, parentSigned: parentSigned || null, doctorSigned: doctorSigned || null }))}
            >
              Save dates
            </Button>
          )}
        </div>
      )}

      <div className={styles.add}>
        {def.pageNames
          ? def.pageNames.map((name, i) =>
              pages.some((p) => p.page === i + 1) ? null : (
                <Button key={name} variant="secondary" size="sm" disabled={busy} onClick={() => choose(i + 1)} aria-label={`Add the ${name.toLowerCase()} of the ${def.label.toLowerCase()} for ${person.name}`}>
                  + {name}
                </Button>
              )
            )
          : free != null && (
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => choose(free)} aria-label={`Add a page to ${def.label} for ${person.name}`}>
                {pages.length === 0 ? '+ Add a photo or PDF' : '+ Add another page'}
              </Button>
            )}
        {busy && (
          <span role="status" className={styles.saving}>
            Saving…
          </span>
        )}
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <input
        ref={picker}
        type="file"
        accept="image/*,application/pdf"
        className={styles.picker}
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}
