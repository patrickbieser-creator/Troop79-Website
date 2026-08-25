import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CalendarEntryForm, type CalendarEntryRow } from '../src/app/admin/(workspace)/calendar/entry-form';

/**
 * The consolidated Entry form (Patrick, 2026-08-25: "consolidate Details and
 * story … based on the news editor"; Brad's prototype, Jenna's order). One
 * form, numbered sections, the Story inside it under the one Save — and the
 * homepage "Card summary" gone: Description is the single short text.
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() })
}));
vi.mock('../src/app/admin/(workspace)/_components/markdown-split-pane', () => ({
  MarkdownSplitPane: ({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) => (
    <textarea aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
  )
}));
vi.mock('../src/app/admin/(workspace)/_components/markdown-block-tools', () => ({
  useMarkdownBlockTools: () => ({ toolbar: null, onEditBlock: vi.fn(), prompts: null, pickers: null })
}));
vi.mock('../src/app/admin/(workspace)/news/_components/media-picker', () => ({
  MediaPicker: () => null
}));
vi.mock('../src/app/admin/(workspace)/_components/date-picker-field', () => ({
  DatePickerField: ({ value, onChange, id }: { value: string; onChange: (v: string) => void; id?: string }) => (
    <input id={id} aria-label="date" value={value} onChange={(e) => onChange(e.target.value)} />
  )
}));

function row(over: Partial<CalendarEntryRow> = {}): CalendarEntryRow {
  return {
    id: 109,
    title: 'Fall Campout',
    entry_date: '2099-10-09',
    end_date: '2099-10-11',
    start_time: null,
    end_time: null,
    day_note: null,
    category: 'Campout',
    location: 'Camp Long Lake',
    description: 'Three days in the woods.',
    details_md: '# Bring\n- a headlamp',
    on_calendar: true,
    status: 'published',
    show_on_homepage: false,
    featured: false,
    hero_media: null,
    hasAgenda: false,
    agendaStatus: null,
    signupStatus: null,
    ...over
  } as unknown as CalendarEntryRow;
}

function renderForm(variant: 'inline' | 'dialog', r: CalendarEntryRow | null = row(), onUpdate = vi.fn(async () => ({ ok: true }))) {
  render(
    <CalendarEntryForm
      row={r}
      variant={variant}
      categories={[{ label: 'Campout' }, { label: 'Meeting' }] as never}
      onCreate={vi.fn(async () => ({ ok: true }))}
      onUpdate={onUpdate}
      onClose={vi.fn()}
    />
  );
  return onUpdate;
}

const sectionTitles = () => screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent);

describe('Calendar entry form — one form, numbered sections', () => {
  it('Inline_HasNumberedSections_InOrder_EntryDescriptionStoryVisibilityHomepage', () => {
    renderForm('inline');
    expect(sectionTitles()).toEqual(['Entry', 'Description', 'Story', 'Visibility', 'Homepage feed']);
  });

  it('Dialog_AddEntry_HasNoStory_CreateFirstThenWriteOnTheWorkbench', () => {
    renderForm('dialog', null);
    expect(sectionTitles()).toEqual(['Entry', 'Description', 'Visibility', 'Homepage feed']);
    expect(screen.queryByRole('textbox', { name: 'Story' })).toBeNull();
  });

  it('Story_IsUnderTheOneSave_DirtyGatedWithEverythingElse', async () => {
    const user = userEvent.setup();
    renderForm('inline');
    const save = screen.getByRole('button', { name: 'Saved' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByRole('textbox', { name: 'Story' }), '\n- water');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save story' })).toBeNull();
  });

  it('Save_SendsTheStoryWithTheOtherFields', async () => {
    const user = userEvent.setup();
    const onUpdate = renderForm('inline');
    await user.type(screen.getByRole('textbox', { name: 'Story' }), '!');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    const fd = (onUpdate.mock.calls[0] as unknown as [FormData])[0];
    expect(fd.get('details_md')).toBe('# Bring\n- a headlamp!');
    expect(fd.get('title')).toBe('Fall Campout');
    expect(fd.has('excerpt')).toBe(false);
  });

  it('HomepageFeed_HasNoCardSummary_DescriptionIsTheOneShortText', () => {
    renderForm('inline', row({ show_on_homepage: true }));
    expect(screen.queryByText(/Card summary/)).toBeNull();
    expect(screen.getByLabelText(/Promote from/)).toBeTruthy();
    expect(screen.getByRole('textbox', { name: /^Description/ })).toBeTruthy();
  });
});
