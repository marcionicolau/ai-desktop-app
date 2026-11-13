// feature 023 FR-022/023: benchmark both ScriptBackend mechanisms.
//   bun scripts/bench-script-backends.ts              → full matrix
//   bun scripts/bench-script-backends.ts --fault <k>  → fault probe
//     (runs a SIGSEGV inside the session; exits 0 only if the host
//      survived — embedded workers share the address space, so this
//      must be observed from outside the process)
// Writes specs/023-python-r-scripts/benchmark.md + benchmark.json.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ScriptBackend } from "../src/bun/scripts/backend";
import { SubprocessBackend } from "../src/bun/scripts/backends/subprocess";
import { EmbeddedBackend } from "../src/bun/scripts/backends/embedded";
import { detectInterpreter } from "../src/bun/scripts/runtimes";
import { scriptRunsDir } from "../src/bun/store/paths";

const WARM_CALLS = 50;
const PY_CODE = "x = ARGS.get('n', 1)\nresult = x * 2";
const R_CODE = "x <- ARGS$n; if (is.null(x)) x <- 1; x * 2";
const STATE_PY = "_ns_total = globals().get('_ns_total', 0) + 1\n_ns_total";
const STATE_R = ".cz_total <- if (exists('.cz_total')) .cz_total + 1 else 1; .cz_total";
const BIG_PY = "print('y' * 1048576)";
const BIG_R = "cat(paste(rep('y', 1048576), collapse=''))";
const FAULT_PY = "import os,signal; os.kill(os.getpid(), signal.SIGSEGV)";
const FAULT_R = 'invisible(system("kill -SEGV $PPID"))'; // kills host if in-proc

type Rt = "python" | "r";
const CODE: Record<Rt, Record<string, string>> = {
  python: { warm: PY_CODE, state: STATE_PY, big: BIG_PY, fault: FAULT_PY },
  r: { warm: R_CODE, state: STATE_R, big: BIG_R, fault: FAULT_R },
};

interface Row {
  backend: string;
  runtime: Rt;
  metric: string;
  value: number | string;
  unit: string;
}

function pct(vs: number[], p: number): number {
  const s = [...vs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
}

function rss(): number {
  return process.memoryUsage().rss / 1024 / 1024;
}

async function call(
  b: ScriptBackend,
  rt: Rt,
  code: string,
  timeoutMs = 30_000,
) {
  const runId = crypto.randomUUID();
  const cwd = join(scriptRunsDir(), `bench-${runId}`);
  mkdirSync(cwd, { recursive: true });
  return b.call(rt, {
    runId,
    code,
    args: {},
    cwd,
    timeoutMs,
  });
}

async function benchOne(b: ScriptBackend, rt: Rt, rows: Row[]) {
  const interp = detectInterpreter(rt);
  if (!interp) {
    rows.push({ backend: b.kind, runtime: rt, metric: "status", value: "interpreter-missing", unit: "" });
    return;
  }
  const t0 = performance.now();
  try {
    await b.ensure(rt, interp);
  } catch (e) {
    rows.push({ backend: b.kind, runtime: rt, metric: "status", value: `ensure-failed: ${(e as Error).message}`, unit: "" });
    return;
  }
  rows.push({ backend: b.kind, runtime: rt, metric: "session-startup", value: Math.round(performance.now() - t0), unit: "ms" });

  // cold call (first call into a live session)
  const c1 = await call(b, rt, CODE[rt].warm);
  rows.push({ backend: b.kind, runtime: rt, metric: "cold-call", value: Math.round(c1.durationMs * 100) / 100, unit: "ms" });

  // warm p50/p95
  const lat: number[] = [];
  for (let i = 0; i < WARM_CALLS; i++) {
    lat.push((await call(b, rt, CODE[rt].warm)).durationMs);
  }
  rows.push({ backend: b.kind, runtime: rt, metric: "warm-p50", value: Math.round(pct(lat, 50) * 100) / 100, unit: "ms" });
  rows.push({ backend: b.kind, runtime: rt, metric: "warm-p95", value: Math.round(pct(lat, 95) * 100) / 100, unit: "ms" });

  // cross-call state fidelity
  let stateOk = true;
  for (let i = 1; i <= 5; i++) {
    const r = await call(b, rt, CODE[rt].state);
    if (!r.stdout.includes(String(i))) stateOk = false;
  }
  rows.push({ backend: b.kind, runtime: rt, metric: "state-fidelity", value: stateOk ? "pass" : "FAIL", unit: "" });

  // ~1 MiB output
  const big = await call(b, rt, CODE[rt].big, 60_000);
  rows.push({ backend: b.kind, runtime: rt, metric: "1mib-output", value: `${Math.round(big.durationMs)}ms ok=${big.stdout.length >= 1_000_000}`, unit: "" });

  // steady-state RSS of the host process (includes workers/procs)
  rows.push({ backend: b.kind, runtime: rt, metric: "host-rss", value: Math.round(rss()), unit: "MiB" });
}

async function faultProbe(kind: string, rt: Rt) {
  // child-mode: run the fault inside THIS process; exit 0 = survived
  const b = kind === "embedded" ? new EmbeddedBackend() : new SubprocessBackend();
  const interp = detectInterpreter(rt);
  if (!interp) process.exit(3);
  await b.ensure(rt, interp);
  try {
    await call(b, rt, CODE[rt].fault, 15_000);
  } catch {
    /* session death is the expected outcome */
  }
  await new Promise((r) => setTimeout(r, 600));
  // session should be dead; next call must restart cleanly
  await b.ensure(rt, interp);
  const r2 = await call(b, rt, CODE[rt].warm);
  if (r2.exitStatus !== 0) process.exit(4);
  process.exit(0); // host survived
}

async function faultCheck(kind: string, rt: Rt, rows: Row[]) {
  const proc = Bun.spawn(
    ["bun", import.meta.dir + "/bench-script-backends.ts", "--fault", kind, rt],
    { stdout: "pipe", stderr: "pipe" },
  );
  const code = await proc.exited;
  const stderr = await new Response(proc.stderr).text();
  rows.push({
    backend: kind,
    runtime: rt,
    metric: "crash-containment",
    value:
      code === 0
        ? "host survived, session restarted"
        : `HOST DIED (exit ${code})${stderr.includes("Segmentation") ? " — SIGSEGV" : ""}`,
    unit: "",
  });
}

// init + a few calls inside a spawned probe — used for embedded/r,
// whose init can be host-fatal (R_Suicide exits the process)
async function probeCheck(kind: string, rt: Rt, rows: Row[]) {
  const proc = Bun.spawn(
    ["bun", import.meta.dir + "/bench-script-backends.ts", "--probe", kind, rt],
    { stdout: "pipe", stderr: "pipe" },
  );
  const out = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();
  const code = await proc.exited;
  const line = out.trim().split("\n").find((l) => l.startsWith("{"));
  if (line) {
    const res = JSON.parse(line) as { startupMs: number; warmMs: number[] };
    rows.push({ backend: kind, runtime: rt, metric: "session-startup", value: Math.round(res.startupMs), unit: "ms" });
    rows.push({ backend: kind, runtime: rt, metric: "warm-p50", value: Math.round(pct(res.warmMs, 50) * 100) / 100, unit: "ms" });
    return;
  }
  rows.push({
    backend: kind,
    runtime: rt,
    metric: "status",
    value: `init-fatal — process exited ${code}${err ? ` (${err.trim().split("\n").pop()})` : ""}`,
    unit: "",
  });
}

async function probeRun(kind: string, rt: Rt) {
  const b = kind === "embedded" ? new EmbeddedBackend() : new SubprocessBackend();
  const interp = detectInterpreter(rt);
  const t0 = performance.now();
  await b.ensure(rt, interp ?? "");
  const startupMs = performance.now() - t0;
  const warmMs: number[] = [];
  for (let i = 0; i < 5; i++) {
    warmMs.push((await call(b, rt, CODE[rt].warm)).durationMs);
  }
  console.log(JSON.stringify({ startupMs, warmMs }));
  process.exit(0);
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--fault") {
    await faultProbe(args[1]!, args[2] as Rt);
    return;
  }
  if (args[0] === "--probe") {
    await probeRun(args[1]!, args[2] as Rt);
    return;
  }
  mkdirSync(scriptRunsDir(), { recursive: true });
  const rows: Row[] = [];
  for (const rt of ["python", "r"] as Rt[]) {
    await benchOne(new SubprocessBackend(), rt, rows);
  }
  // embedded python is host-safe to bench in-process; embedded r's
  // init can be host-fatal → probed in a spawned child instead
  await benchOne(new EmbeddedBackend(), "python", rows);
  await probeCheck("embedded", "r", rows);
  for (const b of ["subprocess", "embedded"]) {
    for (const rt of ["python", "r"] as Rt[]) {
      await faultCheck(b, rt, rows);
    }
  }
  // packaging feasibility
  rows.push({ backend: "subprocess", runtime: "python", metric: "packaging", value: "2 runner files ship in Resources/app; interpreters are user-provided", unit: "" });
  rows.push({ backend: "embedded", runtime: "python", metric: "packaging", value: "needs libpython discovery at runtime + code-signing of dlopen'd libs", unit: "" });
  rows.push({ backend: "embedded", runtime: "r", metric: "packaging", value: "needs script_shim build + libR headers on every target platform", unit: "" });

  const dir = join(import.meta.dir, "../specs/023-python-r-scripts");
  writeFileSync(join(dir, "benchmark.json"), JSON.stringify(rows, null, 2));
  const md = [
    "# Script backend benchmark (FR-023)",
    "",
    `Run: ${new Date().toISOString()} — \`bun scripts/bench-script-backends.ts\``,
    "",
    "| Backend | Runtime | Metric | Value |",
    "|---|---|---|---|",
    ...rows.map((r) => `| ${r.backend} | ${r.runtime} | ${r.metric} | ${r.value} ${r.unit} |`),
    "",
  ].join("\n");
  writeFileSync(join(dir, "benchmark.md"), md);
  console.log(md);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
