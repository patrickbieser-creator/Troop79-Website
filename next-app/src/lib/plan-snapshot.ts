/**
 * Publish snapshot (Plans/Meeting-Planner-III.md, Decision 5): what families are sent, as data. Pure and
 * client-safe. The payload is the families-visible plan only: the focus, the night's options (groups, merit badges,
 * classes from requests and offers) and each scout's suggested options. Its canonical JSON is hashed (by the caller,
 * server-side) to tell "the plan has changed since snapshot n".
 */
import type { ThisWeek } from '@/lib/this-week';

export interface SnapshotOption {
  key: string;
  title: string;
  /** 'FC 7a, 7b' / 'Merit badge' / 'Tenderfoot 4a'. */
  sub: string;
  teacher: string | null;
  /** What it covers, in words: '7a · Flag - display, raise, lower, fold'. */
  items?: string[];
}

export interface SnapshotPayload {
  focus: string[];
  options: SnapshotOption[];
  /** personId → the option keys suggested for that scout (placement's choice). */
  suggested: Record<string, string[]>;
}

export function snapshotPayload(tw: ThisWeek): SnapshotPayload {
  const options: SnapshotOption[] = [
    ...tw.groups.map((g) => ({
      key: g.key,
      title: g.kind === 'badge' ? `${g.name} merit badge` : `${g.name} group`,
      sub: g.columns.map((c) => c.code).join(', '),
      teacher: g.teacher?.name ?? null,
      items: g.columns.map((c) => `${c.code} · ${c.label}`)
    })),
    ...tw.extras.map((x) => ({ key: x.key, title: x.title, sub: x.codeLabel, teacher: x.teacher?.name ?? null }))
  ];
  const suggested: Record<string, string[]> = {};
  for (const sec of tw.sections) for (const r of sec.rows) if (r.suggested.length) suggested[String(r.personId)] = [...r.suggested];
  return {
    focus: [...tw.focus.map((f) => f.name), ...tw.badges.filter((b) => b.direct).map((b) => `${b.name} merit badge`)],
    options,
    suggested: Object.fromEntries(Object.entries(suggested).sort(([a], [b]) => Number(a) - Number(b)))
  };
}

/** Canonical JSON (keys in a fixed order), the thing hashed. */
export function canonical(p: SnapshotPayload): string {
  return JSON.stringify({
    focus: p.focus,
    options: p.options.map((o) => ({ key: o.key, title: o.title, sub: o.sub, teacher: o.teacher, items: o.items ?? [] })),
    suggested: Object.keys(p.suggested)
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => [k, p.suggested[k]])
  });
}

/**
 * Which scouts' families a republish should email: everyone when the options themselves changed (every family sees
 * the list), else only scouts whose suggestions changed. `scouts` is every active scout's personId.
 */
export function changedScouts(prev: SnapshotPayload | null, next: SnapshotPayload, scouts: readonly number[]): number[] {
  if (!prev) return [...scouts];
  const opts = (p: SnapshotPayload) => JSON.stringify([p.focus, p.options.map((o) => [o.key, o.title, o.sub, o.teacher])]);
  if (opts(prev) !== opts(next)) return [...scouts];
  return scouts.filter((id) => JSON.stringify(prev.suggested[String(id)] ?? []) !== JSON.stringify(next.suggested[String(id)] ?? []));
}
