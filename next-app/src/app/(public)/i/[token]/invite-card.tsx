import Link from 'next/link';
import { Button } from '@/app/_components/button';
import { Notice } from '@/app/_components/notice';
import { FormCard, FieldHint } from '@/app/_components/form';
import type { TopicPart } from '@/lib/meeting-board-picklist';
import type { InviteResponse, InviteState } from '@/lib/meeting-invites';
import { TopicParts } from '../../member/meeting/topic-parts';
import { answerInviteAction } from '../actions';
import styles from './invite.module.css';

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/**
 * One meeting invite, as its link shows it (Plans/Matcher-Tune-Up.md T-5): a teaching invite (P1) or a scout's invite,
 * to the scout or a parent (P2). Answers go by POST only; reading this changes nothing. It answers the one invite and
 * never signs anyone in (qa-lead review), so it says plainly who it's for; "Pick something else" is an ordinary
 * sign-in link to the scout's Sunday page and carries no token.
 */
export function InviteCard(props: {
  state: InviteState;
  kind: 'teach' | 'pick';
  token: string;
  inviteeId: number;
  inviteeName: string;
  recipientName: string;
  recipientIsInvitee: boolean;
  topic: string;
  code: string;
  minutes: string;
  parts: TopicPart[];
  day: string;
  response: InviteResponse | null;
  err: string | null;
}) {
  const pick = props.kind === 'pick';
  const scout = firstName(props.inviteeName);
  const sunday = <Link href="/member/meeting">your Sunday page</Link>;
  const errText: Record<string, string> = {
    busy: 'Too many tries from here. Please try again in an hour.',
    full: 'You’re already teaching 2 things that day. Drop one on your Sunday page, then come back to this invite.',
    picks: `${props.recipientIsInvitee ? 'You already have' : `${scout} already has`} 5 picks. Use “Pick something else” to swap one out.`,
    gone: `That isn’t on ${props.recipientIsInvitee ? 'your' : `${scout}’s`} list any more; it may already be signed off.`,
    save: 'That didn’t save. Please try again.'
  };
  const somethingElse = `/signin?next=${encodeURIComponent(props.recipientIsInvitee ? '/member/meeting' : `/member/meeting?scout=${props.inviteeId}`)}`;
  const whoFor = props.recipientIsInvitee
    ? `This invite is for ${props.inviteeName}. If that isn’t you, please don’t answer it.`
    : `This invite is for ${props.recipientName}, about ${props.inviteeName}. If that isn’t you, please don’t answer it.`;

  return (
    <FormCard>
      {props.err && errText[props.err] && <Notice tone="error">{errText[props.err]}</Notice>}
      {props.state === 'open' && (
        <>
          <h2 className={styles.ask}>
            {pick ? (props.recipientIsInvitee ? `Work on ${props.topic} this week?` : `${props.topic} for ${scout}?`) : `Can you teach ${props.topic}?`}
          </h2>
          <p className={styles.meta}>{[props.code, props.day, pick ? '' : props.minutes].filter(Boolean).join(' · ')}</p>
          <TopicParts parts={props.parts} title={props.topic} />
          <FieldHint>{whoFor}</FieldHint>
          <form action={answerInviteAction} className={styles.answers}>
            <input type="hidden" name="token" value={props.token} />
            <Button variant="primary" type="submit" name="answer" value="accept">
              {pick ? (props.recipientIsInvitee ? 'Yes, I’ll come' : `Yes, make it ${scout}’s first pick`) : 'Yes, I’ll teach it'}
            </Button>
            <Button variant="secondary" type="submit" name="answer" value="decline">
              Not this week
            </Button>
          </form>
          {pick && (
            <p className={styles.meta}>
              <Link href={somethingElse}>Pick something else</Link> (you’ll sign in first)
            </p>
          )}
        </>
      )}
      {props.state === 'answered' &&
        (props.response === 'accepted' ? (
          <Notice tone="success">
            {pick
              ? `Done. ${props.topic} is ${props.recipientIsInvitee ? 'your' : `${scout}’s`} first pick for ${props.day}, and ${props.recipientIsInvitee ? 'you’re' : `${scout} is`} marked coming.`
              : `You’re teaching ${props.topic} on ${props.day}. Thank you!`}{' '}
            You can see the rest on {sunday}.
          </Notice>
        ) : props.response === 'superseded' ? (
          <Notice tone="info">Someone already said yes for {scout}. Nothing more to do.</Notice>
        ) : (
          <Notice tone="info">Thanks for letting us know. Maybe another week.</Notice>
        ))}
      {props.state === 'expired' && (
        <Notice tone="info">
          This invite closed at 6:00 PM on the meeting day. {pick ? 'You can still pick for another week on' : 'You can still offer to teach on'} {sunday}.
        </Notice>
      )}
      {(props.state === 'void' || props.state === 'unknown') && (
        <Notice tone="info">This link doesn’t work any more. You can still sign up on {sunday}.</Notice>
      )}
    </FormCard>
  );
}
