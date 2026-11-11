# Implementation Plan: Sandboxed Local Tool Use

**Branch**: `015-local-tool-use` | **Date**: 2025-11-24 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/015-local-tool-use/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

The model may emit a fenced ````tool_call` JSON block mid-turn requesting
`read_file` / `list_dir` inside a user-configured sandbox root. A shared
parser detects complete blocks in the token stream; generation stops via
the existing `engine.stop()` + KV-continue mechanism, the call renders as
an inline card with Approve/Deny/Allow-session actions, and on approval
the main process executes it under realpath containment and injects a
````tool_result` block before resuming generation — a loop capped at 5
calls per turn. Policy (`sandboxRoot`, `mode`) is global settings;
session-allow is a per-conversation in-memory grant. Fusion: executor
only. `deny` mode leaves prompts byte-identical (SC-004).

## Technical Context

**Language/Version**: TypeScript strict (Bun 1.4.x main process, React/Vite renderer)

**Primary Dependencies**: Electrobun (typed RPC), Bun FFI llama.cpp shim (existing `lls_generate_continue`/`lls_step`/`lls_stop`), node:fs (tool executors) — **zero new dependencies**

**Storage**: conversation JSON (per-message `toolCalls`), `settings.json` (`tools` policy), append-only `dataDir()/tool-audit.jsonl`

**Testing**: `bun test` — `tests/tools/` unit suites + `tests/rpc/` handler tests with injected dialogs/store

**Target Platform**: Electrobun desktop (Linux dev target; cross-platform code paths only)

**Project Type**: desktop-app (Bun main + webview renderer over typed RPC)

**Performance Goals**: tool loop adds ≤1 extra prefill per call via KV-continue warm path; no per-token overhead when tools inactive

**Constraints**: realpath containment before any prompt/IO; 8 KiB result cap; 5 calls/turn; deny/unset mode = zero prompt delta; no new deps; no renderer-side filesystem access

**Scale/Scope**: ~7 new files (shared parser, tools/ module ×4, renderer card + settings UI), ~6 touched files (handlers.ts, fusion.ts, types.ts, rpc-contract.ts, MessageList/ChatPage)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Local-First AI | PASS | tools feed local llama.cpp turns; no network/cloud anything (FR-010) |
| II. Electrobun Boundaries | PASS | execution only in main via typed RPC; renderer sends `tool.respond` decisions — new methods go in the single shared contract |
| III. Strict TS & Typed FFI | PASS | shared parser yields typed records; **zero FFI changes** — stop/continue reuses existing shim symbols |
| IV. shadcn/Tailwind v4 | PASS | tool cards compose existing `Button`/card primitives |
| V. Vite pipeline | PASS | renderer additions only |
| VI. Minimal deps | PASS | node:fs + existing infra; spec-agents mined for patterns, not imported |

No violations → Complexity Tracking not required.

## Project Structure

### Documentation (this feature)

```text
specs/015-local-tool-use/
├── plan.md              # this file
├── research.md          # Phase 0 — D1–D11 decisions
├── data-model.md        # Phase 1 — ToolCallRecord, ToolPolicy, AuditEntry
├── quickstart.md        # Phase 1 — 8 manual scenarios + gates
├── contracts/rpc.md     # Phase 1 — tool.respond / tool.pickRoot / tool.update / settings delta
└── tasks.md             # Phase 2 (/speckit-tasks — NOT this command)
```

### Source Code (repository root)

```text
src/
├── shared/
│   ├── types.ts           # + ToolCallRecord, ToolPolicy, ToolName; Message.toolCalls
│   ├── rpc-contract.ts    # + tool.respond, tool.pickRoot, tool.update, TOOL_BUDGET, settings delta
│   └── tool-call.ts       # NEW shared parser: fenced-block scan → typed records
├── bun/
│   ├── tools/
│   │   ├── sandbox.ts     # NEW realpath containment (D4)
│   │   ├── executor.ts    # NEW read_file/list_dir via node:fs + 8KiB trunc (D7)
│   │   ├── loop.ts        # NEW stop-and-continue driver + budget + approval deferral (D1/D2/D5/D8)
│   │   ├── audit.ts       # NEW JSONL append (D10)
│   │   └── service.ts     # NEW policy lookup + per-conversation session grants (D9)
│   ├── llama/
│   │   ├── prompt.ts      # + tool instruction block assembly (system slot, gated)
│   │   └── fusion.ts      # executor genPhase gets optional tool loop hook (FR-009)
│   └── rpc/
│       └── handlers.ts    # wire loop into generate site; tool.respond/pickRoot; busy gate; warning emit
└── renderer/src/
    ├── features/
    │   ├── tools/
    │   │   ├── ToolCallCard.tsx   # NEW inline card: icon, tool, path, verdict, approve/deny, result preview
    │   │   └── use-tool-calls.ts  # NEW tool.update map + tool.respond sender
    │   └── settings/
    │       └── GenerationSettings.tsx  # + tools section (root picker, mode select)
    └── features/chat/
        └── MessageList.tsx      # split content on tool blocks → prose + <ToolCallCard>
tests/
└── tools/                       # NEW parser, sandbox, executor, loop, audit suites
    └── (rpc tool tests live alongside existing tests/rpc/)
```

**Structure Decision**: single-project layout unchanged. New code lands in
`src/bun/tools/` (main-process execution boundary), one shared parser in
`src/shared/tool-call.ts` (bun detects; renderer splits for cards), and a
`features/tools/` UI leaf matching the existing feature-folder convention.

## Post-Design Constitution Re-check

All six principles still PASS — the design adds no dependency, no FFI
surface, no renderer-side FS access, and keeps deny-mode prompts
byte-identical by construction (D9 gate upstream of prompt assembly).
