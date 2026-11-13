// feature 026 (FR-026): panel sizes are remembered per window; this puts
// them back to the defaults.
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { setDensity, useDensity } from "@/lib/density";
import type { Density } from "../../../../shared/types";
import { Button } from "@/components/ui/button";
import { notify } from "@/lib/notify";
import { resetLayout } from "@/lib/layout";

export function LayoutSection() {
  const density = useDensity();
  return (
    <section id="settings-layout" aria-labelledby="layout-heading" className="border-b border-border bg-muted/40 px-4 py-3">
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
        <div className="space-y-2">
          <h2 id="layout-heading" className="text-xs font-medium text-muted-foreground">
            Layout
          </h2>
          <p className="text-sm">
            Drag the sidebar and the Metrics panel edges to resize them; sizes are remembered.
          </p>
          <RadioGroup
            aria-label="Interface density"
            value={density}
            onValueChange={(v) => setDensity(v as Density)}
            className="flex flex-wrap items-center gap-x-4 gap-y-1.5"
          >
            <label className="flex items-center gap-1.5 text-xs">
              <RadioGroupItem value="comfortable" />
              Comfortable
              <span className="text-muted-foreground">(more space)</span>
            </label>
            <label className="flex items-center gap-1.5 text-xs">
              <RadioGroupItem value="compact" />
              Compact
              <span className="text-muted-foreground">(more on screen)</span>
            </label>
          </RadioGroup>
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
