/**
 * Page sidebar markdown (content-managed pages): `## ` lines split it into modules — each module's title is the
 * sidebar heading, its body is rendered by PageSidebar (a `- **Label** value` list becomes the fact card,
 * paragraphs become notes). Text before the first `## ` is an untitled module. Pure, so the editor and the
 * tests can use it without React.
 */
export interface SidebarModule {
  title: string | null;
  body: string;
}

export function splitSidebarModules(markdown: string): SidebarModule[] {
  const modules: SidebarModule[] = [];
  let current: { title: string | null; lines: string[] } = { title: null, lines: [] };
  const flush = () => {
    const body = current.lines.join('\n').trim();
    // An untitled, empty lead-in is nothing; a titled module with no body is still a heading the author wrote.
    if (current.title !== null || body) modules.push({ title: current.title, body });
  };
  for (const line of markdown.split(/\r?\n/)) {
    const h = /^##\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      flush();
      current = { title: h[1], lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  flush();
  return modules;
}
