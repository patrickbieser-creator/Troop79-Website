'use client';

/**
 * The hub's Ingredients tab: the troop's price book as a scout reads it, in the
 * recipe library's look (recipe-browser.tsx). Search, a "Show" row of store
 * sections, then one row per ingredient with its lowest price; its name opens the
 * packages it is sold in (price, store) and the diets it doesn't suit. What shows
 * is lib/menu-monster/ingredient-browse.ts browseIngredients().
 */

import { useId, useState } from 'react';
import type { Catalog, Section } from '@/lib/menu-monster/types';
import { RESTRICTION_BY_KEY, SECTIONS, SECTION_ORDER, priceText } from '@/lib/menu-monster/units';
import { browseIngredients } from '@/lib/menu-monster/ingredient-browse';
import { FilterChips, SearchBox } from './browse-controls';
import w from '../menus/_components/workspace.module.css';

const SECTION_CHIPS = SECTION_ORDER.map((key) => ({ key, label: SECTIONS[key] }));

export function IngredientBrowser({ catalog }: { catalog: Catalog }) {
  const uid = useId();
  const [query, setQuery] = useState('');
  const [section, setSection] = useState<Section | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const entries = browseIngredients(catalog, query, section);
  const q = query.trim();

  return (
    <div className={w.browse}>
      <SearchBox label="Search ingredients" value={query} onChange={setQuery} />
      <FilterChips options={SECTION_CHIPS} value={section} onChange={setSection} />
      <p className={w.srOnly} aria-live="polite">
        {entries.length === 1 ? '1 ingredient' : `${entries.length} ingredients`}
      </p>
      <ul className={w.card} aria-label="Ingredients">
        {entries.length === 0 && <li className={w.empty}>{q ? `No ingredients match “${q}”.` : 'No ingredients here yet.'}</li>}
        {entries.map(({ ingredient: i, packages, from }) => {
          const open = openId === i.id;
          const panel = `${uid}-i-${i.id}`;
          return (
            <li key={i.id} className={w.row}>
              <div className={w.rowMain}>
                <button type="button" className={w.rowName} aria-expanded={open} aria-controls={open ? panel : undefined} onClick={() => setOpenId(open ? null : i.id)}>
                  {i.name}
                  <span className={w.chev} aria-hidden="true">
                    ›
                  </span>
                </button>
                {i.staple && <span className={w.meta}>Patrol box</span>}
              </div>
              <div className={w.fitCol}>
                <span className={w.meta}>{from == null ? 'No price yet' : priceText(from)}</span>
              </div>
              {open && (
                <div id={panel} className={w.inset}>
                  {packages.length === 0 ? (
                    <p className={w.insetMuted}>Not in the price book yet.</p>
                  ) : (
                    <ul className={w.plainList} aria-label={`${i.name} packages`}>
                      {packages.map((p) => (
                        <li key={p.id} className={w.insetLine}>
                          {[p.name, priceText(p.price), p.store].filter(Boolean).join(' · ')}
                        </li>
                      ))}
                    </ul>
                  )}
                  {i.avoid.length > 0 && <p className={w.insetMuted}>{i.avoid.map((k) => `Not ${RESTRICTION_BY_KEY[k].label.toLowerCase()}`).join(' · ')}</p>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
