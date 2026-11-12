import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Checkpoint,
  CheckpointLabel,
  CheckpointTrigger,
} from "@/components/ai/checkpoint";

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
    <Checkpoint className="mt-1 gap-0.5">
      <CheckpointTrigger
        aria-label="Previous variant"
        disabled={disabled || pos <= 1}
        onClick={onPrev}
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </CheckpointTrigger>
      <CheckpointLabel className="min-w-8 flex-none text-center tabular-nums">
        {pos}/{total}
      </CheckpointLabel>
      <CheckpointTrigger
        aria-label="Next variant"
        disabled={disabled || pos >= total}
        onClick={onNext}
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </CheckpointTrigger>
    </Checkpoint>
  );
}
