import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// feature 021 (US1): the wrapper-boundary audit. Feature code must not
// import primitive libraries directly, must use theme tokens instead of
// hardcoded palette literals, and ai/* recipes may only compose ui/*
// primitives, lib/ utilities, and feature modules.

const RENDERER = join(import.meta.dir, "..", "src", "renderer", "src");
const UI_DIR = join(RENDERER, "components", "ui");

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx|css)$/.test(entry)) yield p;
  }
}

const files = [...walk(RENDERER)];
const outsideUi = files.filter((f) => !f.startsWith(UI_DIR));

describe("ui-audit: primitive boundary", () => {
  test("no @radix-ui imports outside components/ui/", () => {
    const offenders = outsideUi.filter((f) =>
      /@radix-ui\//.test(readFileSync(f, "utf8")),
    );
    expect(offenders.map((f) => relative(RENDERER, f))).toEqual([]);
  });

  test("components/ai/ imports only ui/, lib/, shared/, react and package deps", () => {
    const aiDir = join(RENDERER, "components", "ai");
    const offenders: string[] = [];
    for (const f of walk(aiDir)) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/from\s+["']([^"']+)["']/g)) {
        const spec = m[1];
        if (spec.startsWith("@radix-ui/") || spec.startsWith("react")) continue;
        if (
          spec.startsWith("@/components/ui") ||
          spec.startsWith("@/lib") ||
          spec.startsWith("@/components/ai") ||
          spec.startsWith("../") ||
          spec.startsWith("./")
        )
          continue;
        if (!spec.startsWith("@/")) continue; // package deps allowed
        offenders.push(`${relative(RENDERER, f)} → ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("ui-audit: theme tokens", () => {
  // palette literals that must become tokens; token utilities
  // (bg-background, text-muted-foreground, border-border, bg-accent…) pass
  const LITERAL =
    /\b(?:bg|text|border|ring|from|to|via|fill|stroke|divide|outline)-(?:zinc|amber|emerald|neutral|stone|slate|gray|red|blue|green|yellow|orange|sky|indigo|violet|purple|fuchsia|pink|rose|cyan|teal|lime)-\d/;

  test("no hardcoded palette literals outside components/ui/", () => {
    const offenders: string[] = [];
    for (const f of outsideUi) {
      const src = readFileSync(f, "utf8");
      if (LITERAL.test(src)) offenders.push(relative(RENDERER, f));
    }
    expect(offenders).toEqual([]);
  });
});
