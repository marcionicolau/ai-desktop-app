// feature 026 (FR-013): shadcn Select with a plain options API, replacing
// native select elements. Radix Select forbids an empty-string item value, so ""
// (commonly "none"/"inherit") is mapped to a sentinel and back.
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

const EMPTY = "__empty__";
const toInternal = (v: string) => (v === "" ? EMPTY : v);
const fromInternal = (v: string) => (v === EMPTY ? "" : v);

export function SelectField({
  value,
  onValueChange,
  options,
  id,
  "aria-label": ariaLabel,
  placeholder,
  disabled,
  invalid,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  id?: string;
  "aria-label"?: string;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
}) {
  return (
    <Select value={toInternal(value)} onValueChange={(v) => onValueChange(fromInternal(v))} disabled={disabled}>
      <SelectTrigger
        id={id}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        size="sm"
        className={cn("w-full min-w-0", className)}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent position="popper">
        {options.map((o) => (
          <SelectItem key={o.value} value={toInternal(o.value)} disabled={o.disabled}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
