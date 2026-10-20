/**
 * /member/registration — each person's national Scouting America
 * registration, and when it renews. Activates the "Registration" card on
 * /member, a "Soon" placeholder until 2026-10-20.
 *
 * Read-only. The dates come from the troop's last saved BSA roster
 * (/admin/advancement/bsa-roster); renewing happens at my.scouting.org.
 * Scope: an adult sees themselves and their children, a scout themselves, a
 * leader proxy-viewing sees the chosen scout.
 */
import { getIdentitySessionIfValid } from '@/lib/family-access';
import { isEpochCurrent } from '@/lib/identity-session';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveMemberViewer } from '@/lib/member-viewer';
import { resolveFamilyScope } from '@/lib/household-scope';
import { loadRegistrationsFor } from '@/lib/bsa-roster-db';
import { dueState } from '@/lib/bsa-roster';
import { registrationLine, RENEW_URL, visibleRegistrations } from '@/lib/member-registration';
import { centralToday } from '@/lib/dates';
import { fmtDate } from '@/lib/format-date';
import { PageHeader } from '@/app/_components/page-header';
import { PageShell } from '@/app/_components/page-shell';
import { Button } from '@/app/_components/button';
import { Badge } from '@/app/_components/badge';
import surface from '@/app/_components/card.module.css';
import { MemberProxyBanner } from '../member-proxy-banner';
import memberStyles from '../member.module.css';
import styles from './registration.module.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Registration — Scout Troop 79'
};

export default async function RegistrationPage({ searchParams }: { searchParams: Promise<{ viewScout?: string }> }) {
  const { viewScout } = await searchParams;
  const supabase = createAdminClient();
  const viewer = await resolveMemberViewer(supabase, viewScout);
  const proxy = viewer.kind === 'proxy' ? viewer : null;
  const session = await getIdentitySessionIfValid();

  if (viewer.kind === 'proxy-available') {
    return (
      <>
        <PageHeader kicker="Members" title="Registration" />
        <PageShell>
          <MemberProxyBanner viewer={viewer} />
        </PageShell>
      </>
    );
  }

  if (!proxy && (!session || !(await isEpochCurrent(supabase, session)))) {
    return (
      <>
        <PageHeader kicker="Members" title="Sign In" />
        <PageShell width="narrow">
          <div className={memberStyles.gate}>
            <p>Sign in to see your family&rsquo;s Scouting America registration and when it renews.</p>
            <p>
              <Button variant="primary" href={`/signin?next=${encodeURIComponent('/member/registration')}`}>
                Sign in
              </Button>
            </p>
          </div>
        </PageShell>
      </>
    );
  }

  const scope = proxy ? [proxy.personId] : await resolveFamilyScope(supabase, session!.personId, session!.subjectKind ?? 'scout');
  const registrations = visibleRegistrations(await loadRegistrationsFor(supabase, scope), proxy ? proxy.personId : session!.personId);
  const today = centralToday();
  const asOf = registrations.map((r) => r.asOf).filter(Boolean).sort().at(-1);

  return (
    <>
      <PageHeader kicker="Members" title="Registration" />
      <PageShell>
        <MemberProxyBanner viewer={viewer} />
        <p className={memberStyles.intro}>
          Everyone in Scouting registers with the national office once a year. Renewing happens at my.scouting.org.
        </p>
        <div className={styles.list}>
          {registrations.map((r) => {
            const state = dueState(r.expires, today);
            return (
              <div key={r.personId} className={`${surface.card} ${styles.person}`}>
                <p className={styles.name}>
                  {r.name}
                  {state === 'expired' && <Badge tone="danger">Expired</Badge>}
                  {state === 'soon' && <Badge tone="warning">Due soon</Badge>}
                </p>
                <p className={styles.line}>{registrationLine(r, today)}</p>
                {r.positions.length > 0 && <p className={styles.detail}>{r.positions.join(', ')}</p>}
                {r.autoRenewOptedOut && <p className={styles.detail}>Auto-renew is off.</p>}
                {(state === 'expired' || state === 'soon') && (
                  <p className={styles.renew}>
                    <Button variant="secondary" href={RENEW_URL}>
                      Renew at my.scouting.org
                    </Button>
                  </p>
                )}
              </div>
            );
          })}
        </div>
        <p className={memberStyles.note}>
          {asOf ? `From the troop’s BSA roster of ${fmtDate(asOf)}. ` : ''}
          New scouts show up once the troop&rsquo;s registration goes through. Something look wrong? Tell a leader.
        </p>
      </PageShell>
    </>
  );
}
