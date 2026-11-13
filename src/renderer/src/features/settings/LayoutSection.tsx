// feature 026 (FR-026): panel sizes are remembered per window; this puts
// them back to the defaults.
import { Button } from "@/components/ui/button";
import { notify } from "@/lib/notify";
import { resetLayout } from "@/lib/layout";

export function LayoutSection() {
  return (
    <section aria-labelledby="layout-heading" className="border-b border-border bg-muted/40 px-4 py-3">
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
        <div>
          <h2 id="layout-heading" className="text-xs font-medium text-muted-foreground">
            Layout
          </h2>
          <p className="text-sm">
            Drag the sidebar and the Metrics panel edges to resize them; sizes are remembered.
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            resetLayout();
            notify.success("Panel layout reset");
          }}
        >
          Reset layout
        </Button>
      </div>
    </section>
  );
}
