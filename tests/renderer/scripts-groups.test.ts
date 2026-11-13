// feature 027 (T004): scripts-groups — language grouping, alphabetical
// sort, counts, empty-group elision, runtime-missing + disabled flags.
import { describe, expect, test } from "bun:test";
import type { ScriptListItem } from "../../src/shared/types";
import { groupScripts } from "../../src/renderer/src/features/scripts/scripts-groups";

const it_ = (
  id: string,
  runtime: "python" | "r" = "python",
  over: Partial<ScriptListItem> = {},
): ScriptListItem => ({
  id,
  runtime,
  source: { kind: "stored" },
  description: "",
  params: [],
  enabled: true,
  runtimeStatus: "ready",
  linked: false,
  sourceState: "ok",
  ...over,
});

describe("groupScripts", () => {
  test("groups per language, alphabetical, counts, non-empty only", () => {
    const groups = groupScripts([
      it_("zeta"),
      it_("Alpha"),
      it_("r-one", "r"),
      it_("beta"),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Python", "R"]);
    const py = groups[0];
    expect(py.count).toBe(3);
    expect(py.rows.map((r) => r.id)).toEqual(["Alpha", "beta", "zeta"]);
    const r = groups[1];
    expect(r.count).toBe(1);
    expect(r.runtimeMissing).toBe(false);
  });

  test("empty input → no groups", () => {
    expect(groupScripts([])).toEqual([]);
  });

  test("runtimeMissing only when every entry lacks a runtime", () => {
    const mixed = groupScripts([
      it_("a", "python", { runtimeStatus: "missing" }),
      it_("b", "python", { runtimeStatus: "ready" }),
    ]);
    expect(mixed[0].runtimeMissing).toBe(false);
    const allMissing = groupScripts([
      it_("a", "r", { runtimeStatus: "missing" }),
      it_("b", "r", { runtimeStatus: "missing" }),
    ]);
    expect(allMissing[0].runtimeMissing).toBe(true);
  });

  test("200 scripts group instantly (SC-007)", () => {
    const items = Array.from({ length: 200 }, (_, i) =>
      it_(`script-${String(i).padStart(3, "0")}`, i % 3 === 0 ? "r" : "python"),
    );
    const t0 = performance.now();
    const groups = groupScripts(items);
    expect(performance.now() - t0).toBeLessThan(50);
    expect(groups.reduce((n, g) => n + g.count, 0)).toBe(200);
  });

  test("linked + disabled flags pass through to rows", () => {
    const [g] = groupScripts([
      it_("linked-one", "python", {
        linked: true,
        enabled: false,
        source: { kind: "external", path: "/x.py" },
        sourceState: "missing",
      }),
    ]);
    expect(g.rows[0].linked).toBe(true);
    expect(g.rows[0].enabled).toBe(false);
    expect(g.rows[0].sourceState).toBe("missing");
  });
});
