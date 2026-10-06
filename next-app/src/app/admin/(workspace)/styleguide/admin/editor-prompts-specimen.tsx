'use client';

/**
 * The markdown editor's inline-prompt family (_components/markdown-block-tools), rendered from the LIVE
 * hook: each instance is opened on a block through the same `onEditBlock` a preview Edit click uses, so
 * the forms are the real ones. Display-only (no editor attached, nothing is inserted).
 */
import { useEffect, useRef } from 'react';
import { useMarkdownBlockTools } from '../../_components/markdown-block-tools';
import type { MarkdownEditorHandle } from '../../_components/markdown-split-pane';
import { buildGalleryLinkToken, buildImageMarkdown, buildVideoToken } from '@/lib/article-body/tokens';

type Kind = 'image' | 'gallerylink' | 'video';

const SAMPLE: Record<Kind, string> = {
  // A 1px GIF: the specimen needs a thumbnail slot, not a real photo.
  image: buildImageMarkdown({ src: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', alt: 'Troop 79 flag', caption: 'Flag ceremony', href: null }),
  gallerylink: buildGalleryLinkToken('https://photos.app.goo.gl/example', 'Fall campout photos'),
  video: buildVideoToken('https://www.youtube.com/watch?v=example', 'Court of Honor')
};

function PromptInstance({ kind, showToolbar }: { kind: Kind; showToolbar?: boolean }) {
  const editorRef = useRef<MarkdownEditorHandle | null>(null);
  const tools = useMarkdownBlockTools(editorRef);
  const { onEditBlock } = tools;
  useEffect(() => {
    const raw = SAMPLE[kind];
    onEditBlock({ type: kind, raw, start: 0, end: raw.length });
  }, [kind, onEditBlock]);
  return (
    <div>
      {showToolbar && <div>{tools.toolbar}</div>}
      {tools.prompts}
    </div>
  );
}

export function EditorPromptsSpecimen() {
  return (
    <div>
      <PromptInstance kind="gallerylink" showToolbar />
      <PromptInstance kind="video" />
      <PromptInstance kind="image" />
    </div>
  );
}
