export function sanitizeHTML(html) {
  const allowed = new Set(['b', 'i', 'u', 's', 'ul', 'li', 'br', 'div', 'p']);
  return String(html).replace(/<(script|style|iframe|object|svg|math)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<[^>]*>/g, tag => {
      const match = tag.match(/^<\s*(\/?)\s*([a-z0-9]+)\b[^>]*>$/i);
      if (!match || !allowed.has(match[2].toLowerCase())) return '';
      return `<${match[1]}${match[2].toLowerCase()}>`;
    });
}
export function sortNotes(notes) {
  return [...notes].sort((a, b) => b.modified - a.modified);
}
