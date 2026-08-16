/**
 * /news/submit — hand a story to the leaders
 * (Plans/Unified-Identity-And-Capabilities.md Phase C).
 *
 * Open to any VERIFIED person, adult or scout. Proposing is baseline, not a
 * capability: the article lands 'pending' and a leader publishes it, so there
 * is nothing to grant and nothing to check beyond "do we know who you are".
 *
 * Signed out, or on the shared troop password only, this renders an
 * explanation and a sign-in link rather than a form — a scout who types up a
 * campout and is refused at submit is a scout who doesn't come back. Same
 * rule Phase 0 of Family-Identity-Auth.md applied to proof submission.
 */

import Link from 'next/link';
import { getIdentitySessionIfValid } from '@/lib/family-access';
import { SubmitStoryForm } from './submit-form';
import { submitStoryAction } from './actions';
import styles from './submit.module.css';

export const metadata = {
  title: 'Submit a Story — Scout Troop 79',
  description: 'Send the troop newsletter a story about something you did.'
};

export default async function SubmitStoryPage() {
  const session = await getIdentitySessionIfValid();

  return (
    <main style={{ padding: '1.5rem 0 3rem' }}>
      <h1>Submit a story</h1>

      {session ? (
        <>
          <p className={styles.intro}>
            Been on a campout, finished a project, learned something worth passing on? Write it up
            and a leader will put it on the news page. Scouts and parents are both welcome to send
            one in.
          </p>
          <SubmitStoryForm authorName={session.displayName} onSubmit={submitStoryAction} />
        </>
      ) : (
        <div className={styles.gate}>
          <p>
            Stories are published with your name on them, so we need to know who you are before you
            write one. Signing in takes a code sent to the email or phone the troop already has for
            you &mdash; no password to remember.
          </p>
          <p>
            <Link href={`/signin?next=${encodeURIComponent('/news/submit')}`}>
              Sign in to submit a story →
            </Link>
          </p>
          <p style={{ fontSize: '0.9rem' }}>
            No luck signing in? Ask a leader &mdash; they can give you a code, or take your story
            the old-fashioned way.
          </p>
        </div>
      )}
    </main>
  );
}
