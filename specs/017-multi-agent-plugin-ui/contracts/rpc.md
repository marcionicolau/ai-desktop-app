# Contract: Host RPC additions (renderer ⇄ main)

Extends `src/shared/rpc-contract.ts`. Naming follows existing `domain.verb`.
All errors use the existing `RpcError` shape; new codes appended to
`RPC_ERROR_CODES`: `PACK_INVALID`, `PACK_INCOMPATIBLE`, `PACK_NOT_FOUND`,
`CAPABILITY_DENIED`, `RUN_NOT_FOUND`, `RUN_ACTIVE`, `SOURCE_UNREACHABLE`,
`ARCHIVE_INVALID`.

## Requests

```text
extension.scan     {}                      → {packs: InstalledPackView[]}
extension.install  {source: {kind:"folder", path}
                          | {kind:"archive", path}
                          | {kind:"url", url}
                          | {kind:"registry", url, entry}} 
                                          → {pack: InstalledPackView}
                   # folder/archive/url/registry per FR-019; registry fetch
                   # resolves entry.url, downloads .tgz, extracts
extension.preview  {source}               → {manifest, warnings[]}
                   # dry-run: fetch/validate, no install — powers consent UI
extension.enable   {packId}               → {pack}
                   # requires consent given in same call's {consent:true}
                   # when capabilities non-empty (FR-005)
extension.disable  {packId}               → {pack}
                   # aborts active runs first; destroys view sessions
extension.remove   {packId, purgeData?:boolean} → {removed:true}
pack.contributions {packId}               → {skills, pipelines, agents,
                                             views, commands}
pack.readSpec      {contributionId}       → {frontmatter, body}   # inspect UI

run.start  {packId, target:{kind:"pipeline"|"agent", id},
            objective, params?, budget?}  → {runId}
run.cancel {runId}                        → {cancelled:true}
run.list   {packId?, status?}             → {runs: RunSummary[]}
run.get    {runId}                        → {run: RunRecord}
run.clear  {packId}                       → {removed:number}

view.open  {packId, viewId, slot}         → {sessionId}
view.close {sessionId}                    → {}
view.setBounds {sessionId, rect}          → {}   # renderer reports slot rect
```

## Events (main → renderer)

```text
extension.changed  {pack}                 # state transition or failure
run.event          {runId, entry: TraceEntry}   # step/delegation/artifact
run.status         {runId, status, error?}
```

## Notes

- `run.start` is refused while the model engine is busy on a chat turn
  (`ENGINE_BUSY`) unless the fabric queue is added — v1 serializes with
  chat (documented limitation).
- `view.open` may fail `PACK_NOT_FOUND`/`CAPABILITY_DENIED` (views.theme
  capability required for theme push only — views themselves need no cap).
- `extension.install` on `url|registry` enforces 64 MiB cap, `.tgz` only,
  path-traversal-safe extraction (D7).
- `extension.install` on an existing `packId` is an update: files are
  replaced, the manifest re-validated, and consent is re-requested on
  `enable` if declared `capabilities` changed.
- Serialization is bidirectional: `run.start` returns `ENGINE_BUSY` while
  chat generates, and chat entrypoints return `ENGINE_BUSY` while a fabric
  run is active (v1 shares one engine).
