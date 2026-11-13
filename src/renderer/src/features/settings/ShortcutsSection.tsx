// feature 026 (FR-010): the one discoverable place that lists every
// keyboard shortcut. Fed by the action registry — it cannot drift from the
// shortcuts that actually exist.
import { ACTION_DEFS, isMacPlatform, shortcutLabel } from "@/lib/actions";
import { Kbd } from "@/components/ui/kbd";

export function ShortcutsSection() {
  const mac = isMacPlatform();
  const rows = ACTION_DEFS.filter((a) => a.shortcut);
  return (
    <section
      aria-labelledby="shortcuts-heading"
      className="border-b border-border bg-muted/40 px-4 py-3"
    >
      <div className="mx-auto max-w-2xl">
        <h2 id="shortcuts-heading" className="mb-2 text-xs font-medium text-muted-foreground">
          Keyboard shortcuts
        </h2>
        <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 text-sm">
          {rows.map((a) => (
            <div key={a.id} className="contents">
              <dt>{a.label}</dt>
              <dd>
                <Kbd>{shortcutLabel(a.shortcut!, mac)}</Kbd>
              </dd>
            </div>
          ))}
          <div className="contents">
            <dt>Send message</dt>
            <dd>
              <Kbd>Enter</Kbd>
            </dd>
          </div>
          <div className="contents">
            <dt>New line in the message box</dt>
            <dd>
              <Kbd>Shift+Enter</Kbd>
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
