/** Meeting Planner III, client-safe: families sign up for two to three things (Patrick, 2026-10-28). The server
 *  (lib/family-week familyWrite) refuses a fourth tick; the page says so before asking. */
export const PLAN_PICK_CAP = 3;
/** Meeting Planner III Emails (N7): what a family adds to a plan is a suggestion for the planners, up to this many per
 *  scout. Counted again in the database under the scout's board lock (meeting_add_suggestion_capped). */
export const SUGGESTION_CAP = 5;
