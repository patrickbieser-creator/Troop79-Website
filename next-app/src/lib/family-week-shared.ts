/** Meeting Planner III, client-safe constants and types for the family page. */
/** Meeting Planner III Emails (N7): what a family adds to a plan is a suggestion for the planners, up to this many per
 *  scout. Counted again in the database under the scout's board lock (meeting_add_suggestion_capped). */
export const SUGGESTION_CAP = 5;

/** A scout's one answer on the family page (Emails, the one-tap rule). 'ok' = coming, the plan looks good (or "a leader
 *  can pick" for a scout who finished everything); 'change' = coming, with changes; 'mb' / 'help' = a Merit badge group
 *  scout coming for the badge, or to help teach; 'out' = can't make it. */
export type FamilyChoice = 'ok' | 'change' | 'out' | 'mb' | 'help';
