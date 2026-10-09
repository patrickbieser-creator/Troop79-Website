/**
 * Proposes which shopping-list ingredient a printed receipt line is (Plans/Menu-Monster-Receipt-Reconciliation.md).
 * Pure. Aldi prints abbreviations ("FC OJ No Pulp", "Mrshmllw/Puff"); the printed name is tokenised through an
 * abbreviation table and a short list of keyword hints, then scored by word overlap against each candidate's
 * name. A proposal needs a minimum score AND a clear margin over the runner-up: a wrong guess is worse than
 * none, because the scout is meant to look at every line anyway. Price is never used.
 */

export interface MatchCandidate {
  id: string;
  name: string;
  /** On the menu's shopping list (preferred over the rest of the catalog). */
  planned: boolean;
}

/** Aldi abbreviations, applied to receipt names AND candidate names (so "GF" reads as "gluten free" on both sides). */
const ABBREV: Record<string, string[]> = {
  oj: ['orange', 'juice'],
  fc: [],
  chz: ['cheese'],
  ched: ['cheddar', 'cheese'],
  pepjac: ['pepperjack', 'cheese'],
  bfast: ['breakfast'],
  trky: ['turkey'],
  smkd: ['smoked'],
  mushrm: ['mushroom'],
  mrshmllw: ['marshmallow'],
  jce: ['juice'],
  brries: ['berries'],
  chrries: ['cherries'],
  rstd: ['roasted'],
  sslt: ['seasalt'],
  pnut: ['peanut'],
  chickn: ['chicken'],
  org: ['organic'],
  k: ['kernels'],
  pen: ['penne'],
  rot: ['rotini'],
  chick: ['chickpea'],
  gf: ['gluten', 'free'],
  m: [],
  s: []
};

/** What a printed word tells us beyond itself. Receipt names only. */
const HINTS: Record<string, string[]> = {
  pepperoni: ['lunch', 'meat'],
  salami: ['lunch', 'meat'],
  ham: ['lunch', 'meat'],
  turkey: ['lunch', 'meat'],
  roast: ['lunch', 'meat'],
  string: ['stick'],
  links: ['sausage'],
  mayonnaise: ['mayo'],
  parmesan: ['grated'],
  american: ['slices'],
  doritos: ['chips'],
  squares: ['cereal', 'gluten', 'free'],
  crispy: ['cold', 'cereal'],
  crunchn: ['cold', 'cereal'],
  chickpea: ['gluten', 'free'],
  penne: ['pasta'],
  rotini: ['pasta'],
  italian: ['gluten', 'free']
};
const LUNCH_MEAT_WITH_DELI = new Set(['chicken', 'beef', 'pork']);

/** Words that say nothing about which food it is. */
const NOISE = new Set(['no', 'pulp', 'or', 'and', 'etc', 'the', 'of', 'premium', 'pure', 'large', 'whole', 'white', 'wh', 'bs', 'pb']);
/** Qualifiers: they separate variants but never identify a food alone. */
const WEAK = new Set(['gluten', 'free', 'organic', 'veg', 'vegetarian', 'meatless', 'individually', 'wrapped', 'mix', 'sandwich', 'dry']);
/** Distinctive short names that must win over a food named alongside them ("M&M Peanut or PB"). */
const STRONG: Record<string, number> = { mm: 3 };

function stem(t: string): string {
  if (t.length > 4 && t.endsWith('ies')) return `${t.slice(0, -3)}y`;
  if (t.length > 4 && t.endsWith('oes')) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  if (t.length > 4 && t.endsWith('ed')) return t.slice(0, -1);
  return t;
}

/** M&M (and M&M's) keep their ampersand's meaning: "mm". */
const mmFix = (raw: string) => raw.replace(/\bm\s*&\s*m(?:['’]?s)?\b/gi, ' mm ').replace(/pepjac/gi, ' pepperjack cheese ');

/** Lower-case words of a printed or catalog name: camelCase, "/", "-" and digits split; quantities and punctuation dropped. */
function words(raw: string): string[] {
  return mmFix(raw)
    .replace(/[’'`]/g, '')
    .replace(/&/g, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w !== '' && !/^\d+$/.test(w) && !['oz', 'lb', 'ct'].includes(w));
}

function abbreviated(raw: string): string[] {
  const out: string[] = [];
  for (const w of words(raw)) out.push(...(ABBREV[w] ?? [w]));
  return out;
}

/** The meaningful words of a printed receipt name after abbreviations and hints, singularised. */
export function expandReceiptName(raw: string): string[] {
  const base = abbreviated(raw);
  const out = new Set<string>();
  const hasDeli = base.includes('deli');
  const hasCheese = base.includes('cheese');
  for (const w of base) {
    out.add(w);
    for (const h of HINTS[w] ?? []) out.add(h);
    if (hasDeli && !hasCheese && LUNCH_MEAT_WITH_DELI.has(w)) {
      out.add('lunch');
      out.add('meat');
    }
  }
  return [...out].filter((w) => !NOISE.has(w)).map(stem);
}

const weight = (w: string) => STRONG[w] ?? (WEAK.has(w) ? 0.5 : 1);

/** A catalog name as weighted words: words inside brackets count half ("Lunch Meat (Deli Ham, Turkey …)"). */
function candidateWords(name: string): Map<string, number> {
  const open = name.indexOf('(');
  const main = open >= 0 ? name.slice(0, open) : name;
  const aside = open >= 0 ? name.slice(open) : '';
  const out = new Map<string, number>();
  for (const [part, scale] of [[main, 1], [aside, 0.5]] as const) {
    for (const w of abbreviated(part)) {
      if (NOISE.has(w)) continue;
      const s = stem(w);
      if (!out.has(s)) out.set(s, weight(s) * scale);
    }
  }
  return out;
}

const MIN_SCORE = 0.6;
const MIN_MARGIN = 0.15;
const PLANNED_BONUS = 0.25;

/** The candidate a printed line most likely is, or null when nothing is clearly it. */
export function proposeMatch(rawName: string, candidates: readonly MatchCandidate[]): { id: string; score: number } | null {
  const tokens = new Set(expandReceiptName(rawName));
  if (tokens.size === 0) return null;
  const scored: { id: string; score: number; raw: number }[] = [];
  for (const c of candidates) {
    const cw = candidateWords(c.name);
    let matched = 0;
    let head = false;
    let total = 0;
    for (const [w, wt] of cw) {
      total += wt;
      if (!tokens.has(w)) continue;
      matched += wt;
      if (!WEAK.has(w)) head = true;
    }
    if (!head || total <= 0) continue;
    const raw = matched / Math.pow(total, 0.75);
    scored.push({ id: c.id, raw, score: raw + (c.planned ? PLANNED_BONUS : 0) });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (!top || top.raw < MIN_SCORE) return null;
  if (scored[1] && top.score - scored[1].score < MIN_MARGIN) return null;
  return { id: top.id, score: Math.round(top.score * 100) / 100 };
}
