/**
 * The printed meeting plan (Patrick, 2026-11-09): "a printed version of everything that was planned and for who",
 * printed at the end of the meeting before advancement is recorded and used as the cross-check while it is. Pure
 * model from This week's view; app/(public)/planner/print draws it as a PDF.
 *
 * The page builds the view AS OF THE MEETING (ledger rows dated before it), so a reprint after sign-offs start still
 * shows the plan, not a plan with tonight's work already ticked off. A box is still to do; a filled box was done before
 * the meeting; a half box is a badge requirement partly done.
 */
import type { ThisWeek } from '@/lib/this-week';

export type PrintCell = 'todo' | 'part' | 'done';

export interface PrintSection {
  title: string;
  teachers: string;
  columns: { code: string; label: string }[];
  rows: { name: string; rankName: string; cells: PrintCell[]; note: string }[];
}

export interface PrintStations {
  badgeName: string;
  stations: { title: string; teachers: string; cells: { code: string; label: string }[] }[];
  groups: { name: string; sub: string; rows: { name: string; cells: PrintCell[] }[] }[];
}

export interface PrintPlan {
  title: string;
  dateLabel: string;
  printedAt: string;
  focus: string;
  stations: PrintStations | null;
  sections: PrintSection[];
  /** 'Life 7 Scoutmaster's Conference', 'Life board of review' (never 'Life board of review Board of review'). */
  classes: { label: string; teachers: string; scouts: string[] }[];
  cantCome: string[];
}

/** A class's name, saying a word once: the code label already ending in the title stands alone. */
function classLabel(codeLabel: string, title: string): string {
  const [c, t] = [codeLabel.trim(), title.trim()];
  if (!c) return t;
  if (c.toLowerCase().endsWith(t.toLowerCase())) return c;
  if (t.toLowerCase().startsWith(c.toLowerCase())) return t;
  return `${c} ${t}`;
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
const teacherLine = (ts: readonly { name: string }[] | undefined) => (ts?.length ? ts.map((t) => t.name).join(', ') : 'No teacher yet');

export function buildPrintPlan(view: ThisWeek, meta: { title: string; dateLabel: string; printedAt: string }): PrintPlan {
  const teachersOf = new Map(view.groups.map((g) => [g.key, g.teachers]));
  const cantCome = new Set<string>();
  const coming = <T extends { name: string; intent: string | null }>(people: readonly T[]) =>
    people.filter((p) => {
      if (p.intent !== 'not_coming') return true;
      cantCome.add(p.name);
      return false;
    });

  const sections: PrintSection[] = view.sections
    .map((sec) => ({
      title: sec.title,
      teachers: sec.kind === 'none' ? '' : teacherLine(teachersOf.get(sec.key)),
      columns: sec.columns.map((c) => ({ code: c.code, label: c.label })),
      rows: coming(sec.rows)
        .sort(byName)
        .map((r) => {
          const marks = sec.key === r.groupKey ? r.marks : sec.key === r.homeKey ? r.homeMarks : {};
          return {
            name: r.name,
            rankName: r.rankName,
            cells: sec.columns.map((c): PrintCell => (marks[c.key] === 'open' ? 'todo' : marks[c.key] === 'part' ? 'part' : 'done')),
            note: r.note
          };
        })
    }))
    .filter((s) => s.rows.length > 0);

  const rot = view.rotation;
  const stations: PrintStations | null =
    rot?.on && !rot.problem
      ? {
          badgeName: rot.badgeName ?? '',
          stations: rot.stations.map((x) => ({ title: x.title, teachers: teacherLine(x.teachers), cells: x.cells.map((c) => ({ code: c.code, label: c.label })) })),
          groups: rot.groups.map((g) => ({
            name: g.name,
            sub: g.seededFrom,
            rows: [...g.members].sort(byName).map((m) => {
              const done = new Set(m.done);
              return { name: m.name, cells: rot.stations.flatMap((x) => x.cells.map((c): PrintCell => (done.has(c.key) ? 'done' : 'todo'))) };
            })
          }))
        }
      : null;

  const classes = view.extras
    .map((x) => ({ label: classLabel(x.codeLabel, x.title), teachers: teacherLine(x.teachers), scouts: coming(x.scouts).map((p) => p.name).sort((a, b) => a.localeCompare(b)) }))
    .filter((c) => c.scouts.length > 0 || c.teachers !== 'No teacher yet');

  return {
    ...meta,
    focus: [...view.focus.map((f) => f.name), ...view.badges.filter((b) => b.direct).map((b) => b.name)].join(' + ') || 'No focus set',
    stations,
    sections,
    classes,
    cantCome: [...cantCome].sort((a, b) => a.localeCompare(b))
  };
}
