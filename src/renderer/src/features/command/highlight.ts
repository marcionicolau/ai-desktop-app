// feature 026: split a search snippet into text before, the match, and text
// after (the server supplies matchStart/matchEnd, in snippet coordinates).
// Out-of-range offsets are clamped so a malformed hit never throws or
// drops text.
export function splitHighlight(
  snippet: string,
  start: number,
  end: number,
): { before: string; match: string; after: string } {
  const s = Math.max(0, Math.min(snippet.length, start));
  const e = Math.max(s, Math.min(snippet.length, end));
  return { before: snippet.slice(0, s), match: snippet.slice(s, e), after: snippet.slice(e) };
}
