'use client';

/**
 * The calendar entry's own fields — dates, category, title, location, the
 * on-calendar flag and the whole news-promotion block.
 *
 * Extracted from calendar-editor.tsx so ONE form serves both places an entry
 * can be written: the "+ Add Entry" dialog on the list, and the Details panel
 * in the workbench. Before this, the workbench showed these fields read-only
 * and the only way to fix a typo in a title was to back out to the list and
 * open a different editor — two doors to "change this entry", which is the same
 * confusion the calendar unification removed one level up.
 *
 * `variant` is the only difference between the two uses: the dialog closes on
 * save, the inline panel stays put and says "Saved".
 */

import { useState, useTransition } from 'react';
import type { CalendarEntry, Media } from '@/lib/supabase/types';
import type { CalendarCategoryRow } from '@/lib/calendar-categories';
// MediaPicker still lives under news/ — the hero image it picks is the same
// media library the article editor uses.
import { MediaPicker } from '../news/_components/media-picker';
import { DatePickerField } from '../_components/date-picker-field';
import styles from './calendar.module.css';

type ActionResult = { ok: boolean; error?: string };

/**
 * Admin rows carry the resolved promotion hero for the editor's preview, plus
 * the state of each layer:
 *   * `hasAgenda` — deleting the entry cascades into the meeting and its
 *     sessions, so the delete confirm has to say so.
 *   * `agendaStatus` / `signupStatus` — what the Status column reports. Null
 *     means the entry has no layer of that kind, which is different from having
 *     one that is draft or closed.
 */
export type CalendarEntryRow = CalendarEntry & {
  hero_media: Media | null;
  hasAgenda: boolean;
  agendaStatus: string | null;
  signupStatus: string | null;
};

export function CalendarEntryForm({
  row,
  forceNew = false,
  variant = 'dialog',
  categories,
  onCreate,
  onUpdate,
  onClose
}: {
  row: CalendarEntryRow | null;
  forceNew?: boolean;
  variant?: 'dialog' | 'inline';
  categories: CalendarCategoryRow[];
  onCreate: (fd: FormData) => Promise<ActionResult>;
  onUpdate: (fd: FormData) => Promise<ActionResult>;
  onClose: () => void;
}) {
  const isNew = row === null || forceNew;
  const inline = variant === 'inline';
  const [entryDate, setEntryDate] = useState(forceNew ? '' : (row?.entry_date ?? ''));
  const [endDateInit] = useState(forceNew ? '' : (row?.end_date ?? ''));
  const [endDate, setEndDate] = useState(endDateInit);
  const [startTime, setStartTime] = useState(row?.start_time?.slice(0, 5) ?? '');
  const [endTime, setEndTime] = useState(row?.end_time?.slice(0, 5) ?? '');
  const [dayNote, setDayNote] = useState(row?.day_note ?? '');
  const [category, setCategory] = useState<string>(row?.category ?? '');
  const [title, setTitle] = useState(row?.title ?? '');
  const [description, setDescription] = useState(row?.description ?? '');
  const [location, setLocation] = useState(row?.location ?? '');
  const [onCalendar, setOnCalendar] = useState(row?.on_calendar ?? true);
  const [showOnHomepage, setShowOnHomepage] = useState(row?.show_on_homepage ?? false);
  const [featured, setFeatured] = useState(row?.featured ?? false);
  const [promoStart, setPromoStart] = useState(forceNew ? '' : (row?.promo_start ?? ''));
  const [promoEnd, setPromoEnd] = useState(forceNew ? '' : (row?.promo_end ?? ''));
  const [excerpt, setExcerpt] = useState(row?.excerpt ?? '');
  const [heroMedia, setHeroMedia] = useState<Media | null>(row?.hero_media ?? null);
  const [autoArchiveAt, setAutoArchiveAt] = useState(forceNew ? '' : (row?.auto_archive_at ?? ''));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function submit() {
    setErr(null);
    setSaved(false);
    const fd = new FormData();
    if (row && !forceNew) fd.set('id', String(row.id));
    fd.set('entry_date', entryDate);
    fd.set('end_date', endDate);
    fd.set('start_time', startTime);
    fd.set('end_time', endTime);
    fd.set('day_note', dayNote);
    fd.set('category', category);
    fd.set('title', title);
    fd.set('description', description);
    fd.set('location', location);
    fd.set('on_calendar', onCalendar ? '1' : '');
    fd.set('show_on_homepage', showOnHomepage ? '1' : '');
    fd.set('featured', featured ? '1' : '');
    fd.set('promo_start', promoStart);
    fd.set('promo_end', promoEnd);
    fd.set('excerpt', excerpt);
    fd.set('hero_media_id', heroMedia ? String(heroMedia.id) : '');
    fd.set('auto_archive_at', autoArchiveAt);
    startTransition(async () => {
      const res = isNew ? await onCreate(fd) : await onUpdate(fd);
      if (!res.ok) {
        setErr(res.error ?? 'Save failed');
        return;
      }
      // The dialog's job is done on save; the workbench panel stays open,
      // because the leader is usually mid-way through the rest of the entry.
      if (inline) setSaved(true);
      else onClose();
    });
  }

  return (
    <div className={inline ? styles.formInline : styles.dialogInner}>
      {!inline && (
        <div className={styles.dialogHeader}>
          <h3>{isNew ? 'Add Calendar Entry' : `Edit: ${row?.title}`}</h3>
          <p>Shows on the public calendar and the .ics subscription feed.</p>
        </div>
      )}

      <div className={styles.editGrid}>
        <label className={styles.editField}>
          <span className={styles.editLabel}>Date</span>
          <DatePickerField value={entryDate} onChange={setEntryDate} />
        </label>
        <label className={styles.editField}>
          <span className={styles.editLabel}>End Date (multi-day only)</span>
          <DatePickerField value={endDate} onChange={setEndDate} />
        </label>

        <label className={styles.editField}>
          <span className={styles.editLabel}>Start Time (optional)</span>
          <input type="time" className={styles.editInput} value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        </label>
        <label className={styles.editField}>
          <span className={styles.editLabel}>End Time (optional)</span>
          <input type="time" className={styles.editInput} value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        </label>

        <label className={styles.editField}>
          <span className={styles.editLabel}>Category</span>
          <select
            className={styles.editInput}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            required
          >
            <option value="">— Select —</option>
            {categories.map((c) => (
              <option key={c.label} value={c.label}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.editField}>
          <span className={styles.editLabel}>Day Note (optional, e.g. &ldquo;Sat&rdquo;)</span>
          <input
            type="text"
            className={styles.editInput}
            value={dayNote}
            onChange={(e) => setDayNote(e.target.value)}
            placeholder="Sat"
          />
        </label>

        <label className={styles.editFieldFull}>
          <span className={styles.editLabel}>Title</span>
          <input
            type="text"
            className={styles.editInput}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </label>

        <label className={styles.editFieldFull}>
          <span className={styles.editLabel}>Description (optional)</span>
          <input
            type="text"
            className={styles.editInput}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Totin' Chip, Open Advancement, Citizen in World"
          />
        </label>

        <label className={styles.editField}>
          <span className={styles.editLabel}>Location (optional)</span>
          <input
            type="text"
            className={styles.editInput}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </label>
        <label className={styles.editField}>
          <span className={styles.editLabel}>Auto-archive on (optional)</span>
          <DatePickerField value={autoArchiveAt} onChange={setAutoArchiveAt} />
        </label>

        <label className={styles.editFieldFull}>
          <span className={styles.editLabel}>
            <input
              type="checkbox"
              checked={onCalendar}
              onChange={(e) => setOnCalendar(e.target.checked)}
            />{' '}
            On the troop calendar
            <span className={styles.muted}>
              {' '}&mdash; uncheck for outside opportunities (district merit badge clinics, external
              service days): they keep their event page and can appear in the news feed, but never
              on our calendar.
            </span>
          </span>
        </label>

        {/* ── News promotion — replaces the Linked Article pattern ─────────
            The event itself appears in the homepage feed for a window; no
            companion article. Fields hide (and clear on save) when the
            opt-in is off. */}
        <label className={styles.editFieldFull}>
          <span className={styles.editLabel}>
            <input
              type="checkbox"
              checked={showOnHomepage}
              onChange={(e) => setShowOnHomepage(e.target.checked)}
            />{' '}
            Show in the homepage news feed
          </span>
        </label>

        {showOnHomepage && (
          <>
            <label className={styles.editField}>
              <span className={styles.editLabel}>Promote from (blank = now)</span>
              <DatePickerField value={promoStart} onChange={setPromoStart} />
            </label>
            <label className={styles.editField}>
              <span className={styles.editLabel}>Promote until (blank = event date)</span>
              <DatePickerField value={promoEnd} onChange={setPromoEnd} />
            </label>
            <label className={styles.editFieldFull}>
              <span className={styles.editLabel}>Card summary (blank = description)</span>
              <input
                type="text"
                className={styles.editInput}
                value={excerpt}
                onChange={(e) => setExcerpt(e.target.value)}
                maxLength={200}
                placeholder="One sentence for the homepage card"
              />
            </label>
            <label className={styles.editField}>
              <span className={styles.editLabel}>Card image (optional)</span>
              <button type="button" className={styles.editBtn} onClick={() => setPickerOpen(true)}>
                {heroMedia ? 'Change image' : 'Choose image'}
              </button>
              {heroMedia && (
                <button type="button" className={styles.editBtn} onClick={() => setHeroMedia(null)}>
                  Remove
                </button>
              )}
            </label>
            <label className={styles.editField}>
              <span className={styles.editLabel}>
                <input
                  type="checkbox"
                  checked={featured}
                  onChange={(e) => setFeatured(e.target.checked)}
                />{' '}
                Feature as homepage hero
              </span>
            </label>
          </>
        )}
      </div>

      {pickerOpen && (
        <MediaPicker
          mode="single"
          onClose={() => setPickerOpen(false)}
          onInsert={(media) => {
            setHeroMedia(media[0] ?? null);
            setPickerOpen(false);
          }}
        />
      )}

      {err && <div className={styles.editError}>{err}</div>}

      <div className={styles.dialogActions}>
        {inline && saved && <span className={styles.savedNote}>Saved</span>}
        {!inline && (
          <button type="button" className={styles.editBtn} onClick={onClose} disabled={isPending}>
            Cancel
          </button>
        )}
        <button
          type="button"
          className={styles.editSaveBtn}
          onClick={submit}
          disabled={isPending || !entryDate.trim() || !category || !title.trim()}
        >
          {isPending ? 'Saving…' : isNew ? 'Add Entry' : 'Save details'}
        </button>
      </div>
    </div>
  );
}
