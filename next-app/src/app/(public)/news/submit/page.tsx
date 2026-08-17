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
import shell from '../../library/library.module.css';
import styles from './submit.module.css';

export const metadata = {
  title: 'Submit a Story — Scout Troop 79',
  description: 'Send the troop newsletter a story about something you did.'
};

export default async function SubmitStoryPage() {
  const session = await getIdentitySessionIfValid();

  return (
    <>
      <div className={shell.pageHeader}>
        <p className={shell.kicker}>News &amp; Events</p>
        <h1 className={shell.pageTitle}>Submit a Story</h1>
        <div className={shell.headRule} />
      </div>
      <main className={`${shell.main} ${shell.mainNarrow}`}>

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
          <p className={styles.gateLede}>
            Tell the troop what you got up to &mdash; a campout, a project, a skill you finally
            nailed. A leader reads it, adds photos, and it goes on the news page with your name on
            it.
          </p>
          <p className={styles.gateWhy}>
            Because your name goes on it, we need to know who you are first. There&rsquo;s no
            password to remember: find your name and we&rsquo;ll send a one-time code to the
            address the troop already has for you.
          </p>
          <p className={styles.gateAction}>
            <Link
              className={styles.gateBtn}
              href={`/signin?next=${encodeURIComponent('/news/submit')}`}
            >
              Sign in to write one
            </Link>
          </p>
          <p className={styles.gateNote}>
            No luck signing in? Ask a leader &mdash; they can give you a code, or take your story
            the old-fashioned way.
          </p>
        </div>
      )}
      </main>
    </>
  );
}
