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

import { useRef, useState, useTransition } from 'react';
import { DiscardButton, SaveButton, SaveFeedback, useDraftSnapshot, useSavePhase } from '../_components/save-state';
import { Button } from '../../_components/button';
import { FormSection } from '../../_components/form-panel';
import { MarkdownSplitPane, type MarkdownEditorHandle } from '../_components/markdown-split-pane';
import { useMarkdownBlockTools } from '../_components/markdown-block-tools';
import type { CalendarEntry, Media } from '@/lib/supabase/types';
import type { CalendarCategoryRow } from '@/lib/calendar-categories';
// MediaPicker still lives under news/ — the hero image it picks is the same
// media library the article editor uses.
import { MediaPicker } from '../news/_components/media-picker';
import { DatePickerField } from '../_components/date-picker-field';
import { DialogHeader, DialogBody, DialogActions } from '../_components/dialog';
import { Notice } from '../_components/notice';
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
  /** Layer ids, so the list's status pills can open each layer's screen
   *  (2026-08-24 — the Roll Call list folded into the Calendar). */
  agendaId?: number | null;
  signupId?: number | null;
  /** People marked present, split the way Roll Call reports it. Null = none. */
  attendance?: { scouts: number; adults: number } | null;
  /** Signup headcount (yes + full, guests included) for the Going column
   *  (2026-08-25). Null when the entry has no signup. */
  going?: number | null;
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
  const [isDraft, setIsDraft] = useState((row?.status ?? 'published') === 'draft');
  const [showOnHomepage, setShowOnHomepage] = useState(row?.show_on_homepage ?? false);
  const [featured, setFeatured] = useState(row?.featured ?? false);
  const [promoStart, setPromoStart] = useState(forceNew ? '' : (row?.promo_start ?? ''));
  const [promoEnd, setPromoEnd] = useState(forceNew ? '' : (row?.promo_end ?? ''));
  // The Story (details_md) is part of this form now (2026-08-25) — one save.
  const [story, setStory] = useState(row?.details_md ?? '');
  const storyRef = useRef<MarkdownEditorHandle>(null);
  const blockTools = useMarkdownBlockTools(storyRef);
  const [heroMedia, setHeroMedia] = useState<Media | null>(row?.hero_media ?? null);
  const [autoArchiveAt, setAutoArchiveAt] = useState(forceNew ? '' : (row?.auto_archive_at ?? ''));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Save standard (AGENTS.md "Save buttons", rolled out 2026-08-24 — this form
  // was Patrick's example of where it was missing): Save is off and reads
  // "Saved" until something differs from what is saved; Saving… → Done.
  const { dirty, markSaved, saved } = useDraftSnapshot({
    entryDate, endDate, startTime, endTime, dayNote, category, title, description, location,
    onCalendar, isDraft, showOnHomepage, featured, promoStart, promoEnd, story,
    heroMedia, autoArchiveAt
  });
  /** Discard: every field back to the last save (Patrick, 2026-08-24). */
  function discard() {
    setEntryDate(saved.entryDate); setEndDate(saved.endDate); setStartTime(saved.startTime);
    setEndTime(saved.endTime); setDayNote(saved.dayNote); setCategory(saved.category);
    setTitle(saved.title); setDescription(saved.description); setLocation(saved.location);
    setOnCalendar(saved.onCalendar); setIsDraft(saved.isDraft); setShowOnHomepage(saved.showOnHomepage);
    setFeatured(saved.featured); setPromoStart(saved.promoStart); setPromoEnd(saved.promoEnd);
    setStory(saved.story); setHeroMedia(saved.heroMedia); setAutoArchiveAt(saved.autoArchiveAt);
    setErr(null);
  }
  const feedback = useSavePhase();

  function submit() {
    setErr(null);
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
    fd.set('status', isDraft ? 'draft' : 'published');
    fd.set('show_on_homepage', showOnHomepage ? '1' : '');
    fd.set('featured', featured ? '1' : '');
    fd.set('promo_start', promoStart);
    fd.set('promo_end', promoEnd);
    // Only the inline (workbench) form carries the Story; the dialog leaves
    // details_md alone, and the action only writes it when present.
    if (inline) fd.set('details_md', story);
    fd.set('hero_media_id', heroMedia ? String(heroMedia.id) : '');
    fd.set('auto_archive_at', autoArchiveAt);
    feedback.start();
    startTransition(async () => {
      const res = isNew ? await onCreate(fd) : await onUpdate(fd);
      if (!res.ok) {
        feedback.fail();
        setErr(res.error ?? 'Save failed');
        return;
      }
      // The dialog's job is done on save; the workbench panel stays open,
      // because the leader is usually mid-way through the rest of the entry.
      if (inline) {
        markSaved();
        feedback.done();
      } else onClose();
    });
  }

  // Numbered sections in the order a leader thinks (Brad's prototype, Jenna's
  // order, Patrick 2026-08-25): what, when, where → the short text → the
  // write-up → who can see it → the homepage promotion. The dialog ("+ Add
  // Entry") skips the Story: create first, then write on the workbench.
  const body = (
    <>
      <FormSection num={1} title="Entry">
        <div className={styles.fieldGrid}>
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
            <span className={styles.editLabel}>Day Note (optional, e.g. &ldquo;Sat&rdquo;)</span>
            <input
              type="text"
              className={styles.editInput}
              value={dayNote}
              onChange={(e) => setDayNote(e.target.value)}
              placeholder="Sat"
            />
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

          <label className={styles.editFieldFull}>
            <span className={styles.editLabel}>Location (optional)</span>
            <input
              type="text"
              className={styles.editInput}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </label>
        </div>
      </FormSection>

      <FormSection num={2} title="Description">
        <label className={styles.editFieldFull}>
          <span className={styles.editLabel}>Description (optional)</span>
          {/*
            The ONE short text (Patrick, 2026-08-25: the homepage "Card
            summary" collapsed into this — "they seem to be doing the same
            thing"). A textarea, not a single-line input (2026-08-15): the
            column is unbounded text and a real event needs room. Every surface
            that shows it is sized for a summary, so length is handled at the
            point of DISPLAY: the calendar list clamps to one line, the
            month-grid day card to two, the homepage card runs it through
            eventCardExcerpt (160 chars at a word boundary). The event's own
            page prints it in full.
          */}
          <textarea
            className={styles.editInput}
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Totin' Chip, Open Advancement, Citizen in World"
          />
          <span className={styles.fieldHint}>
            Shown in full on the event&rsquo;s own page and as the summary on the calendar and the
            homepage card &mdash; put what matters first.
          </span>
        </label>
      </FormSection>

      {inline && (
        <FormSection num={3} title="Story">
          <p className={styles.fieldHint}>
            The full write-up families read on the event page. Leave it empty when the calendar
            line says everything &mdash; the rule of thumb is whether a family has to DECIDE
            something.
          </p>
          {/* D-081: `details_md` gets the NEWS EDITOR's experience — the same
              split pane, insert toolbar, inline prompts and click-to-edit
              blocks, from the same shared hook. Full-width now that it is not
              squeezed into its own tab (Jenna, 2026-08-25). */}
          <MarkdownSplitPane
            ref={storyRef}
            value={story}
            onChange={setStory}
            label="Story"
            cheatSheet
            toolbar={blockTools.toolbar}
            onEditBlock={blockTools.onEditBlock}
            placeholder="What is this, who is it for, what should families bring or decide?"
          >
            {blockTools.prompts}
          </MarkdownSplitPane>
          {blockTools.pickers}
        </FormSection>
      )}

      <FormSection num={inline ? 4 : 3} title="Visibility">
        <div className={styles.fieldGrid}>
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

          {/* Independent of the checkbox above: that one controls the month
              grid, this one controls whether the entry is live at all. Kept
              adjacent so the difference is visible rather than inferred. */}
          <label className={styles.editFieldFull}>
            <span className={styles.editLabel}>
              <input type="checkbox" checked={isDraft} onChange={(e) => setIsDraft(e.target.checked)} />{' '}
              Save as a draft
              <span className={styles.muted}>
                {' '}&mdash; nobody but a leader can see it: no calendar, no event page, no signup, no
                .ics feed. Use it while dates or details are still moving, then uncheck to publish.
              </span>
            </span>
          </label>

          <label className={styles.editField}>
            <span className={styles.editLabel}>Auto-archive on (optional)</span>
            <DatePickerField value={autoArchiveAt} onChange={setAutoArchiveAt} />
          </label>
        </div>
      </FormSection>

      {/* ── News promotion — replaces the Linked Article pattern ─────────
          The event itself appears in the homepage feed for a window; no
          companion article. Fields hide (and clear on save) when the
          opt-in is off. The card's summary is the Description; its image is
          homepage-only (the event page never shows it), which is why the
          picker lives here and not in section 1. */}
      <FormSection num={inline ? 5 : 4} title="Homepage feed">
        <div className={styles.fieldGrid}>
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
              <label className={styles.editField}>
                <span className={styles.editLabel}>Card image (optional)</span>
                <Button size="sm" onClick={() => setPickerOpen(true)}>
                  {heroMedia ? 'Change image' : 'Choose image'}
                </Button>
                {heroMedia && (
                  <Button size="sm" onClick={() => setHeroMedia(null)}>
                    Remove
                  </Button>
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
      </FormSection>

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

      {err && <Notice>{err}</Notice>}
      {inline && <SaveFeedback phase={feedback.phase} />}
    </>
  );

  const incomplete = !entryDate.trim() || !category || !title.trim();
  const actionButtons = (
    <>
      {!inline && (
        <Button size="sm" onClick={onClose} disabled={isPending}>
          Cancel
        </Button>
      )}
      {inline && !isNew && <DiscardButton dirty={dirty} pending={isPending} onClick={discard} />}
      <SaveButton
        dirty={dirty}
        pending={isPending}
        isNew={isNew}
        newLabel="Add Entry"
        blocked={incomplete}
        blockedReason="Date, category and title are required"
        onClick={submit}
      />
    </>
  );

  if (inline) {
    return (
      <div className={styles.formInline}>
        {body}
        <div className={styles.inlineActions}>{actionButtons}</div>
      </div>
    );
  }

  return (
    <>
      <DialogHeader
        title={isNew ? 'Add Calendar Entry' : `Edit: ${row?.title}`}
        sub="Shows on the public calendar and the .ics subscription feed."
      />
      <DialogBody>{body}</DialogBody>
      <DialogActions>{actionButtons}</DialogActions>
    </>
  );
}
