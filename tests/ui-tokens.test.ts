import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// feature 026 (FR-007, FR-017): size and motion tokens in index.css.

const CSS = readFileSync(
  join(import.meta.dir, "..", "src", "renderer", "src", "index.css"),
  "utf8",
);

function px(value: string): number {
  const m = value.trim().match(/^([\d.]+)(rem|px)$/);
  if (!m) throw new Error(`cannot convert ${value}`);
  return m[2] === "rem" ? Number(m[1]) * 16 : Number(m[1]);
}

function token(css: string, name: string): string | null {
  const m = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
  return m ? m[1]!.trim() : null;
}

// the base :root block plus any [data-density="…"] override blocks
function densityBlocks(): { name: string; css: string }[] {
  const out = [{ name: "default", css: CSS.slice(CSS.indexOf(":root {")) }];
  for (const m of CSS.matchAll(/\[data-density="([\w-]+)"\]\s*\{([^}]*)\}/g)) {
    out.push({ name: m[1]!, css: m[2]! });
  }
  return out;
}

describe("ui-tokens: control sizes (FR-007)", () => {
  test("primary control height ≥ 32 px in every density", () => {
    for (const { name, css } of densityBlocks()) {
      const v = token(css, "control-h-md");
      expect(v, `--control-h-md in ${name}`).not.toBeNull();
      expect(px(v!)).toBeGreaterThanOrEqual(32);
    }
  });

  test("smallest control height and the minimum hit area are ≥ 24 px", () => {
    for (const { name, css } of densityBlocks()) {
      const sm = token(css, "control-h-sm");
      expect(sm, `--control-h-sm in ${name}`).not.toBeNull();
      expect(px(sm!)).toBeGreaterThanOrEqual(24);
    }
    expect(px(token(CSS, "hit-min")!)).toBeGreaterThanOrEqual(24);
  });
});

describe("ui-tokens: reduced motion (FR-017)", () => {
  test("prefers-reduced-motion collapses animation and transition durations", () => {
    const start = CSS.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(start).toBeGreaterThan(-1);
    const block = CSS.slice(start, start + 600);
    expect(block).toMatch(/animation-duration:\s*0\.01ms/);
    expect(block).toMatch(/transition-duration:\s*0\.01ms/);
  });
});
