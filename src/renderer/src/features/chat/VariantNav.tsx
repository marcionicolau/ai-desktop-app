import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  pos: number; // 1-based
  total: number;
  disabled?: boolean;
  onPrev: () => void;
  onNext: () => void;
}

// ‹ n/m › variant picker rendered on messages that have siblings
export function VariantNav({ pos, total, disabled, onPrev, onNext }: Props) {
  if (total < 2) return null;
  return (
    <div className="mt-1 flex items-center gap-0.5 text-xs text-muted-foreground">
      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5"
        aria-label="Previous variant"
        disabled={disabled || pos <= 1}
        onClick={onPrev}
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </Button>
      <span className="min-w-8 text-center tabular-nums">
        {pos}/{total}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5"
        aria-label="Next variant"
        disabled={disabled || pos >= total}
        onClick={onNext}
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
