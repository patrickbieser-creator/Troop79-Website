/**
 * /member/teaching — What I can teach (Phase 0b of Plans/Meeting-Requests-And-Teaching-Offers.md).
 *
 * Adults (leaders and parents alike, no leader code needed) check every skill they can teach at a troop meeting;
 * Junior Leaders (First Class and up, or 9th grade and up unless the roster says no) check the skills scouts may
 * teach, with how many of each skill's rank requirements they've finished. It mirrors Admin › Lookups: the same rows,
 * one writer, counted for the Meeting Plan right away. Merit badge counselor status is read-only here, because it
 * comes from council registration.
 *
 * Access is a VERIFIED identity, the same as the rest of /member. A leader proxy-viewing a family sees it read-only.
 */
import Link from 'next/link';
import { getIdentitySessionIfValid } from '@/lib/family-access';
import { isEpochCurrent } from '@/lib/identity-session';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveMemberViewer } from '@/lib/member-viewer';
import { centralToday } from '@/lib/dates';
import { loadTeachingProfile } from '@/lib/teaching-skills';
import { PageHeader } from '@/app/_components/page-header';
import { PageShell } from '@/app/_components/page-shell';
import { Button } from '@/app/_components/button';
import surface from '@/app/_components/card.module.css';
import { MemberProxyBanner } from '../member-proxy-banner';
import memberStyles from '../member.module.css';
import { TeachingForm } from './teaching-form';
import styles from './teaching.module.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'What I can teach — Scout Troop 79'
};

export default async function TeachingPage({ searchParams }: { searchParams: Promise<{ viewScout?: string }> }) {
  const { viewScout } = await searchParams;
  const supabase = createAdminClient();
  const viewer = await resolveMemberViewer(supabase, viewScout);
  const proxy = viewer.kind === 'proxy' ? viewer : null;
  const session = await getIdentitySessionIfValid();

  if (viewer.kind === 'proxy-available') {
    return (
      <>
        <PageHeader kicker="Members" title="What I can teach" />
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
            <p>Sign in to tell leaders what you can teach at a troop meeting.</p>
            <p>
              <Button variant="primary" href={`/signin?next=${encodeURIComponent('/member/teaching')}`}>
                Sign in
              </Button>
            </p>
          </div>
        </PageShell>
      </>
    );
  }

  const personId = proxy ? proxy.personId : session!.personId;
  const loaded = await loadTeachingProfile(supabase, personId, centralToday());
  // Same rule as the action: a scout sign-in never gets the adult list.
  const profile = !proxy && loaded.kind === 'adult' && session!.subjectKind !== 'adult' ? { ...loaded, kind: 'none' as const } : loaded;
  const back = proxy ? `/member?viewScout=${proxy.personId}` : '/member';
  const junior = profile.kind === 'junior';

  return (
    <>
      <PageHeader kicker="Members" title="What I can teach" />
      <PageShell>
        <MemberProxyBanner viewer={viewer} />
        {profile.kind === 'none' ? (
          <p className={memberStyles.intro}>
            This page is for adults and Junior Leaders (First Class and up, or 9th grade and up). Keep going: you&rsquo;ll
            get here. <Link href={back}>← Back to Members</Link>
          </p>
        ) : (
          <>
            <p className={memberStyles.intro}>
              Check what you can teach at a troop meeting.{' '}
              {junior
                ? 'As a Junior Leader you can teach younger scouts the skills you’ve finished yourself.'
                : 'Leaders use this to match you with what scouts ask for.'}{' '}
              <Link href={back}>← Back to Members</Link>
            </p>
            <div className={`${surface.card} ${styles.panel}`}>
              {junior && (
                <p className={styles.fine}>
                  Woods Tools, Fire Safety and Aquatics are taught by adults (Guide to Safe Scouting), and so is First Aid
                  (troop rule).
                </p>
              )}
              <TeachingForm skills={profile.skills} junior={junior} readOnly={proxy != null} />
            </div>
            {profile.kind === 'adult' && (
              <div className={`${surface.card} ${styles.panel}`}>
                <h2 className={styles.subHead}>Merit badge counselor</h2>
                <p className={styles.fine}>
                  {profile.counselorFor.length
                    ? `You’re a registered counselor for ${profile.counselorFor.join(', ')}.`
                    : 'You’re not registered as a merit badge counselor. That comes from council registration, not from here.'}
                </p>
              </div>
            )}
          </>
        )}
      </PageShell>
    </>
  );
}
