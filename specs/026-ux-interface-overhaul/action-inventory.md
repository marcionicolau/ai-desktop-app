# User-Initiated Action Inventory (SC-007, FR-001, FR-002)

Source: `src/shared/rpc-contract.ts` (92 methods). Queries (`*.list`, `*.get`, `*.status`, `*.state`, `*.usage`, `search.query`, `role.resolve`, `model.advise`, `pack.*`, `settings.get`), pushed events (`chat.token`, `chat.phase`, `chat.done`, `chat.warning`, `model.progress`, `tool.update`, `*.changed`, `run.event`, `run.status`, `view.error`) and window plumbing (`view.setBounds`, `view.setVisible`, `view.open`, `view.close`) are not user-initiated actions and are excluded.

**Progress** = what the user sees within 200 ms of triggering. **Recovery** = what an error offers. Pattern names refer to `contracts/feedback.md`: *busy* (spinner/progress + `aria-busy` in the triggering control), *toast* (`notify.*`), *confirm* (`confirm()`), *inline* (field-level message), *banner* (persistent `Alert` in the surface).

| # | Action (RPC) | Surface | Progress | Success | Failure recovery |
|---|---|---|---|---|---|
| 1 | Send message (`chat.send`) | Chat | busy send button + streaming text | reply completes, live-region announcement | `Alert` with Retry (regenerate) |
| 2 | Regenerate (`chat.regenerate`) | Chat | busy action + streaming | new variant shown | `Alert` with Retry |
| 3 | Edit & resend (`chat.edit`) | Chat | busy + streaming | new variant shown | `Alert` with Retry |
| 4 | Stop generation (`chat.stop`) | Chat | immediate state change | message marked partial | toast error with Retry stop |
| 5 | Select variant (`message.selectVariant`) | Chat | instant | path switches | toast error (e.g. engine busy) |
| 6 | New / rename conversation (`conversation.create`, `.rename`) | Sidebar | instant | list updates | inline error on the rename field |
| 7 | Delete conversation (`conversation.delete`) | Sidebar | confirm → busy | toast "Conversation deleted" | toast error with Retry |
| 8 | Export conversation (`conversation.export`) | Sidebar | busy | toast with the written file name | toast error with Retry |
| 9 | Import conversation (`conversation.import`) | Sidebar | busy (file dialog open) | toast "Imported N conversation(s)" | toast error naming the invalid field |
| 10 | Set mode (`conversation.setMode`) | Chat header | instant | mode shown | inline reason (e.g. role unbound) + link to Roles |
| 11 | Set persona (`conversation.setPersona`) | Chat header | instant | badge updates | toast error |
| 12 | Attach files (`attachment.pick`) | Composer | busy (dialog) | chips appear | toast error per rejected file |
| 13 | Load model (`model.load`) | Models | busy button + progress | toast "Model ready" | toast error with Retry / pick another |
| 14 | Unload model (`model.unload`) | Models | instant | status updates | toast error |
| 15 | Pick model file (`model.pick`) | Models | busy (dialog) | model listed | toast error |
| 16 | Download model (`model.download`) | Models | progress toast with percent | toast "Download complete" | toast error with Retry |
| 17 | Benchmark model (`model.benchmark`) | Models | busy button + progress | row shows measured figures | toast error (engine busy) with Retry |
| 18 | Per-model overrides (`model.setOverride`) | Models | instant | saved indicator | inline validation message |
| 19 | Retry first-run setup (`setup.retry`) | Setup | busy + per-role status | status done | `Alert` with Retry |
| 20 | Change generation settings (`settings.set`) | Settings | instant | saved indicator | inline validation message |
| 21 | Tool policy / sandbox root (`settings.set`, `tool.pickRoot`) | Settings | busy (dialog) | root shown | inline error |
| 22 | Approve / deny tool call (`tool.respond`) | Chat | instant | card state changes | toast error |
| 23 | Create / update / delete role (`role.create`, `.update`, `.delete`) | Roles | instant; delete → confirm | list updates | inline error; "referenced by" offers detach |
| 24 | Bind / fallback role (`role.bind`, `.setFallback`) | Roles | instant | binding shown | inline error (cycle, missing file) |
| 25 | Create / update / delete persona (`persona.upsert`, `.delete`) | Personas | instant; delete → confirm | list updates | inline error |
| 26 | Create / update / delete snippet (`snippet.upsert`, `.delete`) | Personas | instant | list updates | inline error |
| 27 | Create / update / delete script (`script.upsert`, `.delete`, `.enable`) | Scripts | instant; delete → confirm | list updates | inline error |
| 28 | Run script (`script.run`) | Scripts | busy + live status | output shown | `Alert` with the error and Retry |
| 29 | Detect / reset runtime (`runtime.detect`, `.reset`) | Scripts | busy | status updates | toast error |
| 30 | Install extension (`extension.install`, `.preview`) | Extensions | busy | consent dialog / listed | toast error naming the validation issue |
| 31 | Enable / disable extension (`extension.enable`, `.disable`) | Extensions | busy | tab appears / closes | toast error; consent re-prompt |
| 32 | Remove extension (`extension.remove`) | Extensions | confirm → busy | toast "Extension removed" | toast error |
| 33 | Start / cancel run (`run.start`, `run.cancel`) | Workspace | busy + live trace | run completes | `Alert` with Retry |
| 34 | Clear run history (`run.clear`) | Workspace | confirm | toast "History cleared" | toast error |
| 35 | Export backup (`backup.export`) | Settings | busy | toast with the written file name | toast error with Retry |
| 36 | Restore backup (`backup.import`) | Settings | confirm → busy | toast "Backup restored" | toast error; nothing is partially applied |
| 37 | Clear KV snapshots (`snapshot.clear`) | Settings | confirm | toast "N snapshots cleared" | toast error |
| 38 | Clear metrics (`metrics.clear`) | Metrics panel | instant | list empties | toast error |
| 39 | Check / download / apply update (`update.check`, `.download`, `.apply`) | Update banner | busy / progress | banner updates; restart prompt | `Alert` with Retry |
| 40 | Switch theme (`settings.set`) | Sidebar footer | instant | theme changes | toast error |

40 actions across 13 surfaces. Rows marked *confirm* use `lib/confirm.tsx`; rows marked *busy* must show feedback within 200 ms (FR-001); every failure row names a recovery (FR-002).
