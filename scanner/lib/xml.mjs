// Small, forgiving XML reader. The game's XML is hand-edited (odd comments, stray
// whitespace, mismatched case), so this never throws: it builds the best tree it can.
// Node shape: { tag, a: {attr: string}, c: [children] }

const TOKEN = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE[^>]*>|<\/([\w:.\-]+)\s*>|<([\w:.\-]+)((?:\s+[\w:.\-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
const ATTR = /([\w:.\-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

const unescape = (s) => s.indexOf('&') < 0 ? s : s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&');

export function parseXml(text, { keepText = false } = {}) {
  const root = { tag: '#root', a: {}, c: [] };
  const stack = [root];
  let m;
  let last = 0;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(text))) {
    if (keepText && m.index > last) {
      const t = text.slice(last, m.index);
      if (t.trim()) { const top = stack[stack.length - 1]; top.t = (top.t || '') + unescape(t); }
    }
    last = TOKEN.lastIndex;
    if (m[1]) {
      const name = m[1].toLowerCase();
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag.toLowerCase() === name) { stack.length = i; break; }
      }
    } else if (m[2]) {
      const node = { tag: m[2], a: {}, c: [] };
      if (m[3]) {
        let am;
        ATTR.lastIndex = 0;
        while ((am = ATTR.exec(m[3]))) node.a[am[1]] = unescape(am[2] ?? am[3]);
      }
      stack[stack.length - 1].c.push(node);
      if (!m[4]) stack.push(node);
    }
  }
  return root;
}

const eq = (a, b) => a.toLowerCase() === b.toLowerCase();

export const kids = (node, tag) => (node ? node.c.filter((n) => eq(n.tag, tag)) : []);
export const kid = (node, tag) => (node ? node.c.find((n) => eq(n.tag, tag)) : undefined);

export function find(node, tag, out = []) {
  if (!node) return out;
  for (const n of node.c) {
    if (eq(n.tag, tag)) out.push(n);
    find(n, tag, out);
  }
  return out;
}

// Case-insensitive attribute read.
export function attr(node, name, dflt) {
  if (!node) return dflt;
  if (name in node.a) return node.a[name];
  const l = name.toLowerCase();
  for (const k in node.a) if (k.toLowerCase() === l) return node.a[k];
  return dflt;
}

export const num = (node, name, dflt = 0) => {
  const v = attr(node, name);
  if (v === undefined || v === '') return dflt;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : dflt;
};

// Convert every attribute to a number where it cleanly is one.
export function attrsTyped(node) {
  const out = {};
  if (!node) return out;
  for (const [k, v] of Object.entries(node.a)) {
    const t = v.trim();
    out[k] = /^-?(\d+\.?\d*|\.\d+)f?$/.test(t) ? parseFloat(t) : v;
  }
  return out;
}
