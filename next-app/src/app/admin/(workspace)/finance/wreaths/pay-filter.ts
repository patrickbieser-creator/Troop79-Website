/** The Orders tab's starting payment filter from `?pay=` (Home's inbox links `?pay=unpaid`). Anything else is ignored. */
export function parsePayFilter(raw: string | undefined): '' | 'paid' | 'unpaid' | 'cancelled' {
  return raw === 'paid' || raw === 'unpaid' || raw === 'cancelled' ? raw : '';
}
