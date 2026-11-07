/** Canonical forms used to compare CSS values that are written differently but compute equally. */

const NAMED: Record<string, string> = { white: '#ffffff', black: '#000000' };

const round = (n: number) => Number(n.toFixed(4));

/** Parse a hex, rgb()/rgba() or named colour into `r, g, b` and alpha. */
export function canonicalColor(text: string): { rgb: string; alpha: number } | null {
  let value = text.trim().toLowerCase();
  if (NAMED[value]) value = NAMED[value];
  const hex = /^#([0-9a-f]{3,8})$/.exec(value);
  if (hex) {
    let h = hex[1];
    if (h.length <= 4) h = h.replace(/./g, (c) => c + c);
    const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
    const alpha = h.length === 8 ? round(Number.parseInt(h.slice(6), 16) / 255) : 1;
    return { rgb: `${r}, ${g}, ${b}`, alpha };
  }
  const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+%?))?\s*\)$/.exec(
    value
  );
  if (fn) {
    const alphaText = fn[4];
    const alpha =
      alphaText === undefined
        ? 1
        : alphaText.endsWith('%')
          ? round(Number.parseFloat(alphaText) / 100)
          : round(Number.parseFloat(alphaText));
    return { rgb: `${round(+fn[1])}, ${round(+fn[2])}, ${round(+fn[3])}`, alpha };
  }
  return null;
}

/** Whitespace, colour and time canonicalisation for whole CSS values. */
export function normalizeCss(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g, (m) => {
      const c = canonicalColor(m);
      return c ? `rgba(${c.rgb}, ${c.alpha})` : m;
    })
    .replace(/(?<![\w.-])(\d*\.?\d+)s\b/g, (_m, n: string) => `${round(Number(n) * 1000)}ms`)
    .replace(/\s*,\s*/g, ', ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')');
}
