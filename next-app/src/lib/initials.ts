/** First letter of each whitespace-separated token, e.g. "Patrick B." → "PB". */
export function initialsFor(name: string | null | undefined): string {
  if (!name) return '';
  return name
    .trim()
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
}
