# Implementation Plan: First-Run Model Bootstrap

**Branch**: `022-bootstrap-model` · **Spec**: [spec.md](spec.md) · **Issue**: #28

## Architecture

Reuse — don't duplicate — the existing `model.download` machinery. The
handler's download core (HF allowlist, `.part`→rename, throttled
`model.download` events) extracts into `src/bun/models/download.ts` so the
new `SetupService` and the handler share one implementation.

```text
startup (createRpc.start)
  └─ SetupService.run()          new — single-flight, idempotent
       ├─ usable model?          scanModels() / activeModelPath exists
       │    └─ done (bootstrapModel(emit) loads configured path as today)
       └─ downloadGguf(DEFAULT)  shared core → bind "default" → load
```

- `models/download.ts` — `HF_GGUF_RE`, `downloadGguf(url, fileName, dir,
  onEvent)` emitting `DownloadState` phases; throws `EngineError` codes.
- `setup/service.ts` — `SetupService`, injected deps (scan/activePath/
  download/bind/load/emit) for headless tests; `DEFAULT_MODEL` const
  (small instruct GGUF, bartowski Qwen2.5-0.5B Q4_K_M ≈ 400 MB);
  `noteUserDownload(Start/End)` enforces FR-007.
- Contract: `setup.status` query, `setup.retry` trigger, `setup.status`
  event (`SetupState` in shared/types).
- Renderer: `features/setup/` — `use-setup` hook + `SetupPanel` rendered
  on the models surface (download progress / error+retry / null when
  done), so the feature-018 library remains the fallback.

## Constitution check

Local-first ✓ (network only for the model fetch) · typed RPC ✓ ·
no new deps ✓ · `.part` protocol ✓ · tests via injected deps ✓.

## Tasks summary

See tasks.md — 10 tasks: extract download core → SetupService →
contract → handlers+wiring → renderer panel → tests.
