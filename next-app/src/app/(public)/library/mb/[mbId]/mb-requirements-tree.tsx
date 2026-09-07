import { optionalityNote, type ReqNode } from '@/lib/mb-helpers';
import type { LibraryViewer } from '@/lib/library-viewer';
import s from './mb-tracker.module.css';

/**
 * The full requirement list with optionality callouts, moved here from the
 * retired /merit-badges/[mbId] (2026-08-22).
 *
 * KEPT even though the proof picker below lists every leaf: the tree carries
 * the optionality notes ("Do ONE of…") and the full labels that a radio list
 * cannot, and it is part of "everything on the individual merit badge display"
 * that Patrick asked to relocate. The picker is for claiming; this is for
 * reading.
 *
 * `viewer` and `pendingByLeaf` (Plans/Library-MB-Consolidation.md, Phase 1)
 * arrive from the page and are threaded through the recursion but NOT yet
 * rendered — Phase 2 turns each row into the consolidated requirement row
 * (resources, note, pending pill, per-row actions). Server component, so a
 * Map/Set prop is fine; keep it that way or these need serialising.
 */
export function MbRequirementsTree({
  nodes,
  depth,
  viewer,
  pendingByLeaf
}: {
  nodes: ReqNode[];
  depth: number;
  viewer?: LibraryViewer;
  /** leaf code → scout ids with a proof still pending (the viewer's own scouts only). */
  pendingByLeaf?: Map<string, Set<string>>;
}) {
  return (
    <>
      {nodes.map((node) => {
        const hasChildren = node.children.length > 0;
        const note = optionalityNote(node);
        // Top-level reqs always render as parent-style headings even when childless.
        if (!hasChildren && depth > 0) {
          return (
            <div
              key={node.id}
              className={s.reqLeaf}
              style={{ marginLeft: depth * 20 }} /* dynamic: indent computed from tree depth */
            >
              <span className={s.reqTag}>{node.code}</span> {node.label}
            </div>
          );
        }
        return (
          <div
            key={node.id}
            className={depth === 0 ? `${s.reqParent} ${s.reqParentTop}` : s.reqParent}
            style={{ marginLeft: depth * 20 }} /* dynamic: indent computed from tree depth */
          >
            <div className={s.reqParentHead}>
              <span className={`${s.reqTag} ${s.reqTagLarge}`}>{node.code}</span>
              {node.label}
            </div>
            {note && (
              <div className={s.reqNote}>
                <span className={s.reqNoteLabel}>Note:</span>
                {note}
              </div>
            )}
            {hasChildren && (
              <div className={s.reqChildren}>
                <MbRequirementsTree
                  nodes={node.children}
                  depth={depth + 1}
                  viewer={viewer}
                  pendingByLeaf={pendingByLeaf}
                />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
