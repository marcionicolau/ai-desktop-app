# Tasks: First-Run Model Bootstrap

- [x] T001 Write spec.md + checklists (issue #28)
- [ ] T002 Extract download core to `src/bun/models/download.ts`
      (`HF_GGUF_RE`, `downloadGguf`); `model.download` handler calls it
- [ ] T003 `SetupState`/`SetupPhase` types in `src/shared/types.ts`;
      contract entries `setup.status`, `setup.retry`, event `setup.status`
- [ ] T004 `src/bun/setup/service.ts` — `SetupService` + `DEFAULT_MODEL`;
      single-flight run, usable check, download→bind→load, user-download
      busy guard, retry on error
- [ ] T005 Wire in `handlers.ts` bottom/`createRpc.start`; `deps.setup` in
      `HandlerDeps`; `setup.status`/`setup.retry` handlers; user-download
      notifications in `model.download`
- [ ] T006 Renderer `features/setup/use-setup.ts` + `SetupPanel.tsx`;
      mount on models surface
- [ ] T007 Tests `tests/bun/setup.test.ts` — fresh→download+bind+load;
      usable→skip; fail→error→retry; busy guard; .part restart
- [ ] T008 Preflight: `bun run typecheck` · `bun run lint` · `bun test ./tests`
