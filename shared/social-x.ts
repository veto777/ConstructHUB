/** Conservative URL detection: includes bare/Unicode domains, www, and explicit schemes.
 * Deliberately over-detects domains to keep billable links out of the main X post.
 * No TLD list dependency; trailing sentence punctuation stays in the main text. */
const links = /(?:[a-z][a-z\d+.-]*:\/\/|www\.)[^\s<>]+|(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?[.。．｡])+(?:xn--[a-z\d-]+|[\p{L}]{2,63})(?::\d+)?(?:[/?#][^\s<>]*)?/giu;
function linkBody(match: string): string {
  let url = match.replace(/[.,!?;:"'’”]+$/u, "");
  // Keep balanced parentheses in paths (e.g. Wikipedia); drop enclosing prose punctuation.
  while (/[)\]}]$/.test(url)) {
    const close = url.at(-1)!;
    const open = ({ ")": "(", "]": "[", "}": "{" })[close]!;
    if (url.split(close).length <= url.split(open).length) break;
    url = url.slice(0, -1).replace(/[.,!?;:"'’”]+$/u, "");
  }
  return url;
}
export function xSplitText(text: string): { main: string; reply: string } {
  const urls: string[] = [];
  const main = text.normalize("NFC").replace(links, (match) => {
    const url = linkBody(match);
    urls.push(url);
    return match.slice(url.length);
  }).replace(/[ \t]+/g, " ").replace(/ +\n/g, "\n").trim();
  return { main, reply: [...new Set(urls)].join("\n") };
}

/** Approximation of twitter-text v3, without a new dependency: NFC, weighted Unicode
 * ranges, and emoji grapheme clusters at 2. Intl segmentation may differ from X's
 * pinned emoji version; domain recognition is deliberately conservative. URLs = 23. */
export function xWeightedLength(text: string): number {
  let weight = 0;
  // Count the original spacing too; replacing URLs with a sentinel preserves it.
  const plain = text.normalize("NFC").replace(links, (m) => "\u0000" + m.slice(linkBody(m).length));
  for (const { segment } of new Intl.Segmenter("en", { granularity: "grapheme" }).segment(plain)) {
    if (segment === "\u0000") { weight += 23; continue; }
    if (/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(segment)) { weight += 2; continue; }
    for (const c of segment) {
      const n = c.codePointAt(0)!;
      weight += n <= 0x10ff || (n >= 0x2000 && n <= 0x200d) || (n >= 0x2010 && n <= 0x201f) || (n >= 0x2032 && n <= 0x2037) ? 1 : 2;
    }
  }
  return weight;
}
