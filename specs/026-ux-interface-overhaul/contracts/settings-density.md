# Contract: `settings.set` — density

Existing RPC (no new method). Added optional param:

```ts
settings.set({ density?: "comfortable" | "compact", /* existing fields */ })
```

- Persisted in `settings.json` under `density`; `settings.get` returns it (default `"comfortable"`).
- Invalid value → `INVALID_PARAMS`; no write.
- Renderer applies it by setting `document.documentElement.dataset.density` (`lib/density.ts`), exactly as `lib/theme.ts` does for `themeMode`.
