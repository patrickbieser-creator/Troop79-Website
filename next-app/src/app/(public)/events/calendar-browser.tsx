'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { CalendarCategory } from '@/lib/supabase/types';
import type { CalendarEntryWithSlug } from '@/lib/calendar';
import { formatCalendarDateParts, formatTimeOfDay, CATEGORY_COLORS } from '@/lib/calendar-shared';
import styles from './events.module.css';

function EntryRow({ entry, past }: { entry: CalendarEntryWithSlug; past?: boolean }) {
  const { month, day } = formatCalendarDateParts(entry.entry_date);
  const color = CATEGORY_COLORS[entry.category];
  const title = entry.articleSlug ? (
    <Link href={`/news/${entry.articleSlug}`}>{entry.title}</Link>
  ) : (
    entry.title
  );

  return (
    <li className={`${styles.item} ${past ? styles.pastItem : ''}`}>
      <div className={styles.dateBlock} style={past ? undefined : { background: color }}>
        <div className={styles.eMonth}>{month}</div>
        <div className={styles.eDay}>{day}</div>
      </div>
      <div className={styles.itemBody}>
        <p className={styles.itemTitle}>
          {title}
          {entry.day_note && <span className={styles.dayNote}>{entry.day_note}</span>}
        </p>
        <p className={styles.itemCategory} style={{ color }}>
          {entry.category}
        </p>
        {entry.start_time && (
          <p className={styles.itemMeta}>
            {formatTimeOfDay(entry.start_time)}
            {entry.end_time && <> &ndash; {formatTimeOfDay(entry.end_time)}</>}
          </p>
        )}
        {entry.location && <p className={styles.itemMeta}>{entry.location}</p>}
        {entry.description && <p className={styles.itemDesc}>{entry.description}</p>}
      </div>
    </li>
  );
}

export function CalendarBrowser({
  upcoming,
  past,
  categories
}: {
  upcoming: CalendarEntryWithSlug[];
  past: CalendarEntryWithSlug[];
  categories: CalendarCategory[];
}) {
  const [active, setActive] = useState<Set<CalendarCategory>>(new Set());

  function toggle(cat: CalendarCategory) {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  const apply = (list: CalendarEntryWithSlug[]) =>
    active.size === 0 ? list : list.filter((e) => active.has(e.category));
  const filteredUpcoming = apply(upcoming);
  const filteredPast = apply(past);

  return (
    <>
      <div className={styles.filterBar} role="group" aria-label="Filter by category">
        {categories.map((c) => {
          const isActive = active.has(c);
          const color = CATEGORY_COLORS[c];
          return (
            <button
              key={c}
              type="button"
              className={`${styles.filterChip} ${isActive ? styles.filterChipActive : ''}`}
              style={isActive ? { background: color, borderColor: color } : undefined}
              onClick={() => toggle(c)}
              aria-pressed={isActive}
            >
              <span className={styles.filterPip} style={{ background: isActive ? '#fff' : color }} />
              {c}
            </button>
          );
        })}
        {active.size > 0 && (
          <button type="button" className={styles.filterClear} onClick={() => setActive(new Set())}>
            Clear filter
          </button>
        )}
      </div>

      <div className={styles.sectionDivider}>
        <span className={styles.divLabel}>Upcoming</span>
        <span className={styles.divRule} aria-hidden="true" />
      </div>
      {filteredUpcoming.length === 0 ? (
        <p className={styles.empty}>
          {active.size > 0 ? 'No upcoming entries match that filter.' : 'Nothing on the calendar yet.'}
        </p>
      ) : (
        <ul className={styles.list}>
          {filteredUpcoming.map((entry) => (
            <EntryRow key={entry.id} entry={entry} />
          ))}
        </ul>
      )}

      {filteredPast.length > 0 && (
        <>
          <div className={styles.sectionDivider}>
            <span className={styles.divLabel}>Past</span>
            <span className={styles.divRule} aria-hidden="true" />
          </div>
          <ul className={styles.list}>
            {filteredPast.map((entry) => (
              <EntryRow key={entry.id} entry={entry} past />
            ))}
          </ul>
        </>
      )}
    </>
  );
}
