/**
 * Brand detail at entry time (Plans/Menu-Monster-Brand-Detail.md): once a package is filed under a brand in the
 * catalog this page holds, the brand is no longer "New". Pure, so the Plan tab and the Shopping tab share it.
 * The server's own rule (catalog.ts) leaves a held package out; here the scout's own catalog carries it, so a
 * brand with a held size of its own reads as sized until a leader decides.
 */

import type { Catalog } from './types';

export function settleNewBrands(catalog: Catalog): Catalog {
  const brands = catalog.brands;
  if (!brands || !brands.some((b) => b.isNew)) return catalog;
  const sized = new Set(catalog.packages.filter((p) => p.brandId && p.yield != null && p.yield > 0 && !p.retiredAt).map((p) => p.brandId));
  if (!brands.some((b) => b.isNew && sized.has(b.id))) return catalog;
  return { ...catalog, brands: brands.map((b) => (b.isNew && sized.has(b.id) ? { ...b, isNew: undefined } : b)) };
}
