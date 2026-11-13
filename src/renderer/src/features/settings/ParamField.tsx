// feature 026 (FR-013): one generation parameter as a form field — label,
// value, unit and allowed range, help text, a slider for bounded parameters,
// and an inline error that keeps what the user typed.
import { useId } from "react";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { describeRange, type ParamSpec } from "./param-spec";

export function ParamField({
  spec,
  value,
  onChange,
  error,
  inheritedHint,
  disabled,
}: {
  spec: ParamSpec;
  value: string; // "" = inherit
  onChange: (text: string) => void;
  error?: string;
  // what an empty box falls back to, e.g. "default 0"
  inheritedHint?: string;
  disabled?: boolean;
}) {
  const uid = useId();
  const inputId = `${uid}-input`;
  const descId = `${uid}-desc`;
  const errId = `${uid}-err`;
  const n = Number(value);
  const sliderValue = value.trim() !== "" && Number.isFinite(n) && spec.slider
    ? Math.min(spec.slider.max, Math.max(spec.slider.min, n))
    : (spec.slider?.min ?? 0);
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={inputId}>
        {spec.label}
        <span className="ml-1.5 text-xs font-normal text-muted-foreground">{describeRange(spec)}</span>
      </FieldLabel>
      <div className="flex items-center gap-3">
        {spec.slider && (
          <Slider
            aria-label={`${spec.label} slider`}
            min={spec.slider.min}
            max={spec.slider.max}
            step={spec.step}
            value={[sliderValue]}
            disabled={disabled}
            onValueChange={([v]) => onChange(String(Math.round((v ?? 0) * 100) / 100))}
            className="flex-1"
          />
        )}
        <Input
          id={inputId}
          type="text"
          inputMode="decimal"
          value={value}
          placeholder={inheritedHint ?? "inherit"}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${descId} ${errId}` : descId}
          className={spec.slider ? "w-24 shrink-0" : "w-full"}
        />
      </div>
      <FieldDescription id={descId}>{spec.help}</FieldDescription>
      {error && <FieldError id={errId}>{error}</FieldError>}
    </Field>
  );
}
