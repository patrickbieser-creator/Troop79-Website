/** Client-safe: a teacher's note with "Not this week" (Emails E2), at most DECLINE_NOTE_LINES lines and
 *  DECLINE_NOTE_CHARS characters. The database checks the same (meeting_invites_decline_note_check). */
export const DECLINE_NOTE_CHARS = 240;
export const DECLINE_NOTE_LINES = 3;

/** The note as saved: line endings unified, cut to the limits, trimmed. Blank = no note. */
export function cleanDeclineNote(raw: string): string | null {
  const note = raw.replace(/\r\n?/g, '\n').split('\n').slice(0, DECLINE_NOTE_LINES).join('\n').trim().slice(0, DECLINE_NOTE_CHARS).trim();
  return note || null;
}
