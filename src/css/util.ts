/** Small value helpers shared by the CSS parsers. Pure: strings in, data out. */

export const num = (v: string | null | undefined) => {
  const n = parseFloat(v || '');
  return isFinite(n) ? n : 0;
};

/** Split on commas that are not inside parentheses. */
export const splitTopLevel = (s: string): string[] => {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
};

/** Split on whitespace that is not inside parentheses. */
export const splitTopLevelWs = (v: string): string[] => {
  const out: string[] = [];
  let depth = 0, cur = '';
  for (const ch of v) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (/\s/.test(ch) && depth === 0) { if (cur) out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
};

export const lenToPx = (t: string, ref: number): number | null => {
  if (/%$/.test(t)) return (parseFloat(t) / 100) * ref;
  if (/px$/.test(t)) return parseFloat(t);
  if (t === '0') return 0;
  return null;
};
