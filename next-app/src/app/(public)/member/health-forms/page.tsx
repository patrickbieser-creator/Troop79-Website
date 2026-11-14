/**
 * /member/health-forms — a family's health records (Plans/Health-Forms.md, release 1). Activates the "Health forms"
 * card on /member.
 *
 * A verified ADULT sees and manages their own records and their children's; a scout is told to ask a parent, and
 * nobody sees another family's (lib/health-access). Files are encrypted by the site and kept in private storage;
 * each View goes through /api/health-files and is written to the access log, which the family can read below.
 */
import { createAdminClient } from '@/lib/supabase/server';
import { getIdentitySessionIfValid } from '@/lib/family-access';
import { healthFamilyAccess } from '@/lib/health-access';
import { healthFilesConfigured } from '@/lib/health-files';
import { healthOpensFor, listHealthPages } from '@/lib/health-store';
import { HEALTH_KIND, isHealthKind } from '@/lib/health-records';
import { centralToday } from '@/lib/dates';
import { fmtDateTime } from '@/lib/format-date';
import { PageHeader } from '@/app/_components/page-header';
import { PageShell } from '@/app/_components/page-shell';
import { Button } from '@/app/_components/button';
import { Notice } from '@/app/_components/notice';
import memberStyles from '../member.module.css';
import { HealthForms, type HealthPerson } from './health-forms';
import { removeHealthPageAction, saveHealthDatesAction, uploadHealthPageAction } from './actions';
import styles from './health-forms.module.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Health forms — Scout Troop 79',
  robots: { index: false, follow: false }
};

function Gate({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader kicker="Members" title="Health forms" />
      <PageShell width="narrow">
        <div className={memberStyles.gate}>{children}</div>
      </PageShell>
    </>
  );
}

export default async function HealthFormsPage() {
  const access = await healthFamilyAccess();
  if (!access) {
    const session = await getIdentitySessionIfValid();
    if (session?.subjectKind === 'scout') {
      return (
        <Gate>
          <p>Health forms are kept by parents. Ask a parent to sign in and add yours.</p>
        </Gate>
      );
    }
    return (
      <Gate>
        <p>Sign in to add your family&rsquo;s health forms and insurance cards, and to see what the troop has on file.</p>
        <p>
          <Button variant="primary" href={`/signin?next=${encodeURIComponent('/member/health-forms')}`}>
            Sign in
          </Button>
        </p>
      </Gate>
    );
  }
  if (!healthFilesConfigured()) {
    return (
      <Gate>
        <p>Health form uploads aren&rsquo;t switched on yet. Until they are, hand the paper forms to a leader as usual.</p>
      </Gate>
    );
  }

  const supabase = createAdminClient();
  const [{ data: peopleRows }, { data: scoutRows }, pages, opens] = await Promise.all([
    supabase.from('people').select('id, display_name').in('id', access.personIds),
    supabase.from('scouts').select('person_id').in('person_id', access.personIds),
    listHealthPages(supabase, access.personIds),
    healthOpensFor(supabase, access.personIds)
  ]);
  const nameOf = new Map(((peopleRows ?? []) as { id: number; display_name: string }[]).map((p) => [Number(p.id), p.display_name]));
  const scoutIds = new Set(((scoutRows ?? []) as { person_id: number }[]).map((s) => Number(s.person_id)));
  // Children first (they are why most parents are here), then the adult.
  const people: HealthPerson[] = access.personIds
    .filter((id) => nameOf.has(id))
    .map((id) => ({ personId: id, name: nameOf.get(id)!, isScout: scoutIds.has(id) }))
    .sort((a, b) => Number(b.isScout) - Number(a.isScout) || a.name.localeCompare(b.name));

  return (
    <>
      <PageHeader kicker="Members" title="Health forms" />
      <PageShell>
        <p className={memberStyles.intro}>
          Add a photo or PDF of each page. Only you, and the few leaders who look after health records, can open them.
        </p>
        <Notice tone="info" className={styles.list}>
          Every outing needs the BSA health form (Parts A and B) and an insurance card for each person going. The form is
          good for 12 months from the later signature date.
        </Notice>
        <HealthForms
          people={people}
          pages={pages}
          today={centralToday()}
          actions={{ upload: uploadHealthPageAction, saveDates: saveHealthDatesAction, remove: removeHealthPageAction }}
        />
        <section className={styles.opens} aria-labelledby="health-opens">
          <h2 id="health-opens" className={styles.opensHead}>
            Who opened these
          </h2>
          {opens.length === 0 ? (
            <p className={memberStyles.note}>Nobody has opened a file yet. Every time someone does, it is listed here.</p>
          ) : (
            <ul className={styles.opensList}>
              {opens.map((o, i) => (
                <li key={i}>
                  {fmtDateTime(o.at)} · {o.viewerName} opened {(nameOf.get(o.personId) ?? 'a family member').split(' ')[0]}&rsquo;s{' '}
                  {isHealthKind(o.kind) ? HEALTH_KIND[o.kind].label : 'record'}
                </li>
              ))}
            </ul>
          )}
        </section>
      </PageShell>
    </>
  );
}
