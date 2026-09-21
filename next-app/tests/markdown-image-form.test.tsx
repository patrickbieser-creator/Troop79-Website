import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';
import { useMarkdownBlockTools } from '../src/app/admin/(workspace)/_components/markdown-block-tools';
import type { MarkdownEditorHandle } from '../src/app/admin/(workspace)/_components/markdown-split-pane';
import type { Media } from '../src/lib/supabase/types';

/**
 * Insert Image no longer asks for a caption through window.prompt (step 3 of
 * Plans/Article-Image-Flexibility.md): picking a photo opens the same kind of
 * inline form the gallery-link and video blocks use — caption, plus "Link to"
 * none / full-size / a URL — and Edit on an existing image reopens it
 * prefilled and splices the rebuilt markdown over the ORIGINAL span.
 */
const CDN = 'https://troop79.b-cdn.net/flyer.png';
const picked: Media = {
  id: 1, bunny_path: '', cdn_url: CDN, alt_text: 'Flyer', caption: null,
  uploaded_by: '', width: null, height: null, created_at: ''
};

// The picker itself is a modal over Supabase media — stand in with a button
// that "picks" one fixed photo.
vi.mock('../src/app/admin/(workspace)/news/_components/media-picker', () => ({
  MediaPicker: ({ onInsert }: { onInsert: (m: Media[]) => void }) => (
    <button type="button" onClick={() => onInsert([picked])}>Pick flyer</button>
  )
}));

const insertAtCursor = vi.fn();
const replaceRange = vi.fn();

function Host() {
  const ref = useRef<MarkdownEditorHandle | null>({
    insertAtCursor, replaceRange, insertInline: vi.fn(), focus: vi.fn()
  });
  const tools = useMarkdownBlockTools(ref);
  return (
    <div>
      {tools.toolbar}
      {tools.prompts}
      {tools.pickers}
      <button
        type="button"
        onClick={() => tools.onEditBlock({ type: 'image', raw: `[![Flyer](${CDN} "Old cap")](/events/23)`, start: 10, end: 60 })}
      >
        Edit existing
      </button>
    </div>
  );
}

beforeEach(() => {
  insertAtCursor.mockClear();
  replaceRange.mockClear();
});

describe('Insert Image form', () => {
  it('Author_InsertsPlainImage_WhenNothingElseChosen', async () => {
    render(<Host />);
    await userEvent.click(screen.getByRole('button', { name: 'Insert Image' }));
    await userEvent.click(screen.getByRole('button', { name: 'Pick flyer' }));
    await userEvent.click(screen.getByRole('button', { name: 'Insert' }));
    expect(insertAtCursor).toHaveBeenCalledWith(`![Flyer](${CDN})`);
  });

  it('Author_InsertsLinkedImageMarkdown_WhenFullSizeChosen', async () => {
    render(<Host />);
    await userEvent.click(screen.getByRole('button', { name: 'Insert Image' }));
    await userEvent.click(screen.getByRole('button', { name: 'Pick flyer' }));
    await userEvent.type(screen.getByLabelText(/Caption/), 'Sat 9–3');
    await userEvent.click(screen.getByLabelText(/Full-size image/));
    await userEvent.click(screen.getByRole('button', { name: 'Insert' }));
    expect(insertAtCursor).toHaveBeenCalledWith(`[![Flyer](${CDN} "Sat 9–3")](${CDN})`);
  });

  it('Author_CannotInsert_UntilTheUrlIsTyped_WhenAUrlIsChosen', async () => {
    render(<Host />);
    await userEvent.click(screen.getByRole('button', { name: 'Insert Image' }));
    await userEvent.click(screen.getByRole('button', { name: 'Pick flyer' }));
    await userEvent.click(screen.getByLabelText(/A web address/));
    expect(screen.getByRole('button', { name: 'Insert' })).toHaveProperty('disabled', true);
    await userEvent.type(screen.getByLabelText(/Link URL/), '/events/23');
    await userEvent.click(screen.getByRole('button', { name: 'Insert' }));
    expect(insertAtCursor).toHaveBeenCalledWith(`[![Flyer](${CDN})](/events/23)`);
  });

  it('Author_SplicesTheOriginalSpan_WhenEditingAnExistingImage', async () => {
    render(<Host />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit existing' }));
    // Prefilled from the markdown, not from a media row.
    expect(screen.getByLabelText(/Caption/)).toHaveProperty('value', 'Old cap');
    expect(screen.getByLabelText(/A web address/)).toHaveProperty('checked', true);
    expect(screen.getByLabelText(/Link URL/)).toHaveProperty('value', '/events/23');
    await userEvent.click(screen.getByLabelText(/^None/));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(replaceRange).toHaveBeenCalledWith(10, 60, `![Flyer](${CDN} "Old cap")`);
    expect(insertAtCursor).not.toHaveBeenCalled();
  });

  it('Author_DiscardsTheForm_WhenCancelling', async () => {
    render(<Host />);
    await userEvent.click(screen.getByRole('button', { name: 'Insert Image' }));
    await userEvent.click(screen.getByRole('button', { name: 'Pick flyer' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText(/Caption/)).toBeNull();
    expect(insertAtCursor).not.toHaveBeenCalled();
  });
});
