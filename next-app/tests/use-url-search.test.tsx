import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useUrlSearch, URL_SEARCH_DEBOUNCE_MS } from '../src/app/admin/(workspace)/_components/use-url-search';

/**
 * The one URL-search hook (2026-08-26) — the behaviours the three toolbars
 * each hand-rolled: debounced `q` push, page reset, and the focused-input
 * guard against the server's lagging `q` clobbering keystrokes.
 */

const push = vi.fn();
let params = new URLSearchParams('status=draft&page=3');
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  useSearchParams: () => params
}));

function Harness({ q, resetPage = false }: { q: string; resetPage?: boolean }) {
  const s = useUrlSearch({ path: '/admin/list', q, resetPage });
  return (
    <div>
      <input aria-label="Search" {...s.inputProps} />
      <button type="button" onClick={() => s.push({ status: 'published' })}>
        filter
      </button>
    </div>
  );
}

beforeEach(() => {
  push.mockClear();
  params = new URLSearchParams('status=draft&page=3');
});

describe('useUrlSearch', () => {
  it('Search_PushesQOnceAfterTheDebounce_NotPerKeystroke', async () => {
    const user = userEvent.setup();
    render(<Harness q="" />);
    await user.type(screen.getByLabelText('Search'), 'camp');
    expect(push).not.toHaveBeenCalled();
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1), { timeout: URL_SEARCH_DEBOUNCE_MS * 4 });
    expect(push.mock.calls[0][0]).toBe('/admin/list?status=draft&page=3&q=camp');
  });

  it('Push_DropsPage_WhenResetPageIsSet_AndDeletesEmptyValues', async () => {
    const user = userEvent.setup();
    render(<Harness q="" resetPage />);
    await user.click(screen.getByText('filter'));
    expect(push.mock.calls[0][0]).toBe('/admin/list?status=published');
  });

  it('ServerQ_DoesNotClobberTheInput_WhileItIsFocused', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness q="" />);
    const input = screen.getByLabelText('Search');
    await user.click(input);
    await user.type(input, 'ca');
    // The server answers an earlier, shorter q while the leader is still typing.
    rerender(<Harness q="c" />);
    expect((input as HTMLInputElement).value).toBe('ca');
    // Once the input is blurred, the URL is the source of truth again.
    await user.tab();
    rerender(<Harness q="cam" />);
    expect((input as HTMLInputElement).value).toBe('cam');
  });
});
