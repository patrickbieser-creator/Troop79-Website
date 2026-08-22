import { optionalityNote, type ReqNode } from '@/lib/mb-helpers';
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
 */
export function MbRequirementsTree({ nodes, depth }: { nodes: ReqNode[]; depth: number }) {
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
                <MbRequirementsTree nodes={node.children} depth={depth + 1} />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
