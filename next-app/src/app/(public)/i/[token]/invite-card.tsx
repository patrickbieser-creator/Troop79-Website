import Link from 'next/link';
import { Button } from '@/app/_components/button';
import { Notice } from '@/app/_components/notice';
import { FormCard, FieldHint } from '@/app/_components/form';
import type { TopicPart } from '@/lib/meeting-board-picklist';
import type { InviteResponse, InviteState } from '@/lib/meeting-invites';
import { TopicParts } from '../../member/meeting/topic-parts';
import { answerInviteAction } from '../actions';
import styles from './invite.module.css';

/** Why an answer didn't take, by the ?err= code the action sends back. */
const ERR: Record<string, string> = {
  busy: 'Too many tries from here. Please try again in an hour.',
  full: 'You’re already teaching 2 things that day. Drop one on your Sunday page, then come back to this invite.',
  save: 'That didn’t save. Please try again.'
};

/**
 * One meeting invite, as its link shows it (Plans/Matcher-Tune-Up.md T-5). Answers go by POST only; reading this
 * changes nothing. It answers the one invite and never signs anyone in (qa-lead review), so it says plainly who it's
 * for, and a spent or unknown link points to the Sunday page rather than reading as broken.
 */
export function InviteCard(props: {
  state: InviteState;
  token: string;
  inviteeName: string;
  topic: string;
  code: string;
  minutes: string;
  parts: TopicPart[];
  day: string;
  response: InviteResponse | null;
  err: string | null;
}) {
  const sunday = (
    <Link href="/member/meeting">your Sunday page</Link>
  );
  return (
    <FormCard>
      {props.err && ERR[props.err] && (
        <Notice tone="error">
          {ERR[props.err]}
        </Notice>
      )}
      {props.state === 'open' && (
        <>
          <h2 className={styles.ask}>Can you teach {props.topic}?</h2>
          <p className={styles.meta}>{[props.code, props.day, props.minutes].filter(Boolean).join(' · ')}</p>
          <TopicParts parts={props.parts} title={props.topic} />
          <FieldHint>
            This invite is for {props.inviteeName}. If that isn’t you, please don’t answer it.
          </FieldHint>
          <form action={answerInviteAction} className={styles.answers}>
            <input type="hidden" name="token" value={props.token} />
            <Button variant="primary" type="submit" name="answer" value="accept">
              Yes, I’ll teach it
            </Button>
            <Button variant="secondary" type="submit" name="answer" value="decline">
              Not this week
            </Button>
          </form>
        </>
      )}
      {props.state === 'answered' &&
        (props.response === 'accepted' ? (
          <Notice tone="success">
            You’re teaching {props.topic} on {props.day}. Thank you! You can see who’s coming on {sunday}.
          </Notice>
        ) : (
          <Notice tone="info">Thanks for letting us know. Maybe another week.</Notice>
        ))}
      {props.state === 'expired' && (
        <Notice tone="info">
          This invite closed at 6:00 PM on the meeting day. You can still offer to teach on {sunday}.
        </Notice>
      )}
      {(props.state === 'void' || props.state === 'unknown') && (
        <Notice tone="info">This link doesn’t work any more. You can still sign up to teach on {sunday}.</Notice>
      )}
    </FormCard>
  );
}
