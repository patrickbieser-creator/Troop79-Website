/**
 * Topic-shelf tools — the one hook /library/topic/[slug] needs.
 *
 * WHY A CODE MAP AND NOT A library_topics COLUMN: a tool is a server
 * component (it loads its own data with the service role and renders a
 * client planner), and a component can't be stored as data. Presence in
 * this map IS the "this shelf has a tool" fact — a `has_tool` column would
 * be a second copy of it that could disagree with the code (PATTERNS.md:
 * simplify, don't layer). The shelf row itself (title, icon, blurb, order)
 * stays in library_topics like every other shelf, so /library's card list
 * needs no change to show a tool-bearing shelf.
 *
 * Adding a tool = one entry here + a folder beside this file.
 */
import type { ComponentType } from 'react';
import { MenuMonsterShelfTool } from './menu-monster/shelf-tool';

export const TOPIC_TOOLS: Record<string, ComponentType> = {
  'menu-monster': MenuMonsterShelfTool
};
