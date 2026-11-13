# Tasks: First-Run Model Bootstrap

- [x] T001 Write spec.md + checklists (issue #28)
- [x] T002 (FR-005) Extract download core to `src/bun/models/download.ts`
      (`HF_GGUF_RE`, `downloadGguf`); `model.download` handler calls it
- [x] T003 (FR-002, FR-008) `SetupState`/`SetupPhase` types in `src/shared/types.ts`;
      contract entries `setup.status`, `setup.retry`, event `setup.status`
- [x] T004 (FR-001, FR-003, FR-004, FR-006, FR-007) `src/bun/setup/service.ts` — `SetupService` + `DEFAULT_MODEL`;
      single-flight run, usable check, download→bind→load, user-download
      busy guard, retry on error
- [x] T005 (FR-007, FR-008) Wire in `handlers.ts` bottom/`createRpc.start`; `deps.setup` in
      `HandlerDeps`; `setup.status`/`setup.retry` handlers; user-download
      notifications in `model.download`
- [x] T006 (FR-002, FR-006) Renderer `features/setup/use-setup.ts` + `SetupPanel.tsx`;
      mount on models surface
- [x] T007 (FR-001, FR-003, FR-004, FR-006, FR-007) Tests `tests/bun/setup.test.ts` — fresh→download+bind+load;
      usable→skip; fail→error→retry; busy guard; .part restart
- [x] T008 Preflight: `bun run typecheck` · `bun run lint` · `bun test ./tests`
