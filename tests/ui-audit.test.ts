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
  test("no @radix-ui / radix-ui imports outside components/ui/", () => {
    const offenders = outsideUi.filter((f) =>
      /(?:@radix-ui\/|from\s+["']radix-ui["'])/.test(readFileSync(f, "utf8")),
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
          spec === "@/components/icons" ||
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

// feature 026 (US2/US1/US4): the design-scale audit. Rules start warn-only
// (summaries via console.warn) and are promoted to hard failures by adding
// their name to ENFORCED once their last violation is converted — overlays
// after T029, native controls after T048, the rest in the final polish task.
const ENFORCED = new Set<string>([
  "icon-import-site", // enforced since T015–T018
  "font-sizes", // enforced since T019
  "icon-sizes", // enforced since T019
  "overlays", // enforced since T031
  "native-controls", // enforced since T051
]);

function check(rule: string, offenders: string[]) {
  if (ENFORCED.has(rule)) {
    expect(offenders).toEqual([]);
  } else if (offenders.length > 0) {
    console.warn(`ui-audit[${rule}] (warn-only): ${offenders.length} offender(s)`);
  }
}

const tsxOutsideUi = outsideUi.filter((f) => f.endsWith(".tsx"));

function offendersOf(re: RegExp, pool = tsxOutsideUi): string[] {
  return pool.filter((f) => re.test(readFileSync(f, "utf8"))).map((f) => relative(RENDERER, f));
}

describe("ui-audit: design scale (feature 026)", () => {
  test("font-sizes: no arbitrary pixel font sizes", () => {
    check("font-sizes", offendersOf(/text-\[\d+(?:\.\d+)?px\]/));
  });

  test("icon-sizes: no off-scale icon sizes (scale: size-3.5, size-4, size-5)", () => {
    check("icon-sizes", offendersOf(/\bsize-3(?![.\w])/));
  });

  test("icon-import-site: icons come only from components/icons.ts", () => {
    const iconsFile = join(RENDERER, "components", "icons.ts");
    const pool = files.filter((f) => /\.tsx?$/.test(f) && f !== iconsFile);
    check(
      "icon-import-site",
      offendersOf(/from\s+["'](?:lucide-react|@remixicon\/react)["']/, pool),
    );
  });

  test("native-controls: no native select/checkbox/radio/range outside ui/", () => {
    check(
      "native-controls",
      offendersOf(/<select\b|type=["'](?:checkbox|radio|range)["']/),
    );
  });

  test("overlays: no hand-rolled fixed overlays outside ui/", () => {
    check("overlays", offendersOf(/fixed inset|role=["']dialog["']/));
  });
});
