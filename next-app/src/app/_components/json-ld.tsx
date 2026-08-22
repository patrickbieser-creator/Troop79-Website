/**
 * A JSON-LD block.
 *
 * Server Component, no client JS: structured data is inert markup that only
 * crawlers and AI assistants read. The shapes come from lib/seo.ts, which is
 * pure and tested — this component exists solely to serialize them safely.
 *
 * `<` is escaped because a JSON string containing "</script>" would otherwise
 * close the block early and inject markup. Everything serialized here is
 * troop-authored (titles, excerpts, addresses), but an article title is still
 * user input, so the escape is not optional.
 */
export function JsonLd({ data }: { data: object | object[] }) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
