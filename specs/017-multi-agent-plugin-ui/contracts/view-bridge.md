# Contract: Extension View Bridge (`ext.*`)

Each extension `BrowserView` receives a **dedicated** Electrobun RPC
instance — never the host schema. Inside a view, a preload exposes
`window.ext` (async methods) and `window.ext.on(event, cb)`.

## View → host methods

```text
ext.context()            → {packId, viewId, theme, locale}
                           # always available, no capability needed
ext.storage.get(key)     → {value|null}      # cap: storage
ext.storage.set(key,value) → {}              # scoped dataDir()/pack-data/<id>/
ext.storage.remove(key)  → {}
ext.runs.list()          → {runs: RunSummary[]}   # cap: runs.read, own pack
ext.runs.get(runId)      → {run}                  # own pack only
ext.invoke(commandId, args?) → {runId}            # cap: commands.invoke
ext.models.generate({prompt, params?}) → {text, usage}  # cap: models.generate
                           # routed through host EngineLike + model roles;
                           # counts against the run/app budget
```

Undeclared capability → `{code:"CAPABILITY_DENIED"}` (FR-014).

## Host → view events

```text
ext.themeChanged  {theme: {mode, accent, vars: Record<string,string>}}
                  # pushed on host theme change when pack declares
                  # views.theme (FR-015); view applies vars to :root
ext.runUpdated    {runId, status}             # cap: runs.read
ext.contextChanged {locale?}
```

## Isolation guarantees (enforced by host, D2/D4)

- Separate `BrowserView` with its own `partition` — no shared storage with
  host or other packs.
- `viewsRoot` = the view's own dir; `allowedProtocols` denies host
  `views://` assets and `appData://` outside the pack.
- Navigation locked to in-view relative resources; no remote URLs.
- A crashed view is destroyed and re-created on user retry (FR-016); the
  host slot shows the error placeholder, other views unaffected (FR-013).

## Preload surface

The bridge preload is host-shipped (same for every pack). Pack JS sees only
`window.ext` — no Electrobun internals, no `bun`, no host RPC object.
