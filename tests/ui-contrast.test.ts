import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// feature 026 (FR-005, SC-001): WCAG 2.2 AA gate over the design tokens in
// index.css. Pure TS — OKLCH → linear sRGB → relative luminance → ratio —
// so no accessibility framework is needed (research.md R4).

const CSS = readFileSync(
  join(import.meta.dir, "..", "src", "renderer", "src", "index.css"),
  "utf8",
);

type Tokens = Record<string, string>;

// returns the text between the braces of the first `selector {` block at
// or after `from`, plus the index just past its closing brace
function block(css: string, selector: string, from = 0): { body: string; end: number } {
  const start = css.indexOf(selector + " {", from);
  if (start < 0) throw new Error(`block not found: ${selector}`);
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) {
      return { body: css.slice(css.indexOf("{", start) + 1, i), end: i + 1 };
    }
  }
  throw new Error(`unterminated block: ${selector}`);
}

function vars(body: string): Tokens {
  const out: Tokens = {};
  for (const m of body.matchAll(/--([\w-]+):\s*(oklch\([^)]*\))\s*;/g)) {
    out[m[1]!] = m[2]!;
  }
  return out;
}

const light = vars(block(CSS, ":root").body);
const dark = vars(block(CSS, ".dark").body);
const moreStart = CSS.indexOf("@media (prefers-contrast: more)");
const more = block(CSS, "@media (prefers-contrast: more)", moreStart).body;
const lightMore = { ...light, ...vars(block(more, ":root").body) };
const darkMore = { ...dark, ...vars(block(more, ".dark").body) };

function oklchToLinear(spec: string): [number, number, number] {
  const m = spec.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (!m) throw new Error(`cannot parse ${spec}`);
  const L = Number(m[1]);
  const C = Number(m[2]);
  const h = (Number(m[3]) * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const mm = m_ ** 3;
  const s = s_ ** 3;
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  return [
    clamp(4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s),
    clamp(-1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s),
    clamp(-0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s),
  ];
}

function luminance(spec: string): number {
  const [r, g, b] = oklchToLinear(spec);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function ratio(fg: string, bg: string): number {
  const a = luminance(fg);
  const b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

// [foreground token, background token, minimum ratio, why]
const PAIRS: [string, string, number][] = [
  // body text on its surface (4.5:1)
  ["foreground", "background", 4.5],
  ["card-foreground", "card", 4.5],
  ["popover-foreground", "popover", 4.5],
  ["secondary-foreground", "secondary", 4.5],
  ["accent-foreground", "accent", 4.5],
  ["sidebar-foreground", "sidebar", 4.5],
  ["sidebar-accent-foreground", "sidebar-accent", 4.5],
  ["muted-foreground", "background", 4.5],
  ["muted-foreground", "card", 4.5],
  ["muted-foreground", "muted", 4.5],
  ["muted-foreground", "sidebar", 4.5],
  // text on filled controls
  ["primary-foreground", "primary", 4.5],
  ["destructive-foreground", "destructive", 4.5],
  // status colors used as text on the two main surfaces
  ["primary", "background", 4.5],
  ["destructive", "background", 4.5],
  ["success", "background", 4.5],
  ["warning", "background", 4.5],
  ["info", "background", 4.5],
  ["success", "card", 4.5],
  ["warning", "card", 4.5],
  ["info", "card", 4.5],
  // non-text indicators: focus ring and form-control boundaries (3:1)
  ["ring", "background", 3],
  ["ring", "card", 3],
  ["input", "background", 3],
  ["input", "card", 3],
];

const MODES: [string, Tokens][] = [
  ["light", light],
  ["dark", dark],
  ["light + prefers-contrast: more", lightMore],
  ["dark + prefers-contrast: more", darkMore],
];

describe("ui-contrast: WCAG 2.2 AA token pairs", () => {
  for (const [mode, tokens] of MODES) {
    test(`${mode}: every listed pair meets its minimum ratio`, () => {
      const failures: string[] = [];
      for (const [fg, bg, min] of PAIRS) {
        const f = tokens[fg];
        const b = tokens[bg];
        if (!f || !b) {
          failures.push(`${fg}/${bg}: token missing`);
          continue;
        }
        const r = ratio(f, b);
        if (r < min) failures.push(`${fg} on ${bg}: ${r.toFixed(2)} < ${min}`);
      }
      expect(failures).toEqual([]);
    });
  }

  test("ratio() sanity: black on white is 21:1", () => {
    expect(ratio("oklch(0 0 0)", "oklch(1 0 0)")).toBeCloseTo(21, 0);
  });
});
