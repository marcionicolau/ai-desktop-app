// feature 026 (FR-013): register a form's dirty state, and ask before
// leaving while any form has unsaved edits.
import { useEffect } from "react";
import { confirm } from "@/lib/confirm";
import { unsaved } from "@/lib/unsaved";

export function useUnsavedGuard(id: string, label: string, dirty: boolean) {
  useEffect(() => {
    unsaved.set(id, dirty ? label : null);
    return () => unsaved.set(id, null);
  }, [id, label, dirty]);
}

// resolves true when it is fine to leave (nothing dirty, or the user agreed)
export async function confirmLeave(): Promise<boolean> {
  if (!unsaved.any()) return true;
  return confirm({
    title: "Discard unsaved changes?",
    itemName: unsaved.labels().join(", "),
    consequence: "Your edits will be lost.",
    confirmLabel: "Discard",
  });
}
