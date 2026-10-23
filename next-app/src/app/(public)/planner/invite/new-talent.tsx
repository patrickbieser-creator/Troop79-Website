/**
 * Build a Plan B10d: the Invite tab's collapsed "New talent (n)": what adults said they'd enjoy teaching in the last 30
 * days (teaching_interests), grouped by adult: the name, each item the short way, its note, the date. Anyone who can
 * view the planner sees it. Patrick: this is the ONLY place interests show on the Invite tab (no per-class tier), and
 * the engine and matcher ignore them. Notes are plain text: React escapes them and nothing links them.
 */
import { fmtDate } from '@/lib/format-date';
import type { TalentGroup } from '@/lib/teaching-interests-shared';
import b from '../build/build.module.css';
import s from './invite.module.css';

export function NewTalent({ groups }: { groups: TalentGroup[] | null }) {
  if (!groups?.length) return null;
  const n = groups.reduce((sum, g) => sum + g.items.length, 0);
  return (
    <details className={b.others}>
      <summary>New talent ({n})</summary>
      <ul className={s.talent}>
        {groups.map((g) => (
          <li key={g.personId} className={s.talentPerson}>
            <strong>{g.name}</strong>
            <ul className={s.talentItems}>
              {g.items.map((i) => (
                <li key={i.id}>
                  {i.short}
                  {i.note ? <span className={s.talentNote}> “{i.note}”</span> : null}
                  <span className={s.meta}> · {fmtDate(i.createdAt, { year: false })}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </details>
  );
}
