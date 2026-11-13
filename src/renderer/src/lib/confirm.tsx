// feature 026 (FR-004): destructive actions confirm with a dialog that names
// the affected item and the consequence. Imperative API:
//   if (await confirm({ title, itemName, consequence })) doTheThing();
// <ConfirmHost /> must be mounted once at the app root.
import { useSyncExternalStore } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ConfirmRequest {
  title: string;
  // the thing being affected, e.g. the conversation title or file name
  itemName: string;
  // what happens, e.g. "The conversation and its attachments are deleted."
  consequence: string;
  confirmLabel?: string;
  // false for non-destructive confirmations (default: true)
  destructive?: boolean;
}

interface Pending extends ConfirmRequest {
  resolve(ok: boolean): void;
}

// framework-free store: a FIFO queue so overlapping requests never lose
// a promise; the host shows the head of the queue.
export function createConfirmStore() {
  let queue: Pending[] = [];
  const subs = new Set<() => void>();
  const emit = () => subs.forEach((f) => f());
  return {
    request(req: ConfirmRequest): Promise<boolean> {
      return new Promise<boolean>((resolve) => {
        queue = [...queue, { ...req, resolve }];
        emit();
      });
    },
    current(): Pending | null {
      return queue[0] ?? null;
    },
    settle(ok: boolean) {
      const head = queue[0];
      if (!head) return;
      queue = queue.slice(1);
      head.resolve(ok);
      emit();
    },
    subscribe(f: () => void) {
      subs.add(f);
      return () => void subs.delete(f);
    },
  };
}

const store = createConfirmStore();

export function confirm(req: ConfirmRequest): Promise<boolean> {
  return store.request(req);
}

export function ConfirmHost() {
  const current = useSyncExternalStore(store.subscribe, store.current, store.current);
  const destructive = current?.destructive !== false;
  return (
    <AlertDialog
      open={current !== null}
      onOpenChange={(open) => {
        if (!open) store.settle(false);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{current?.title}</AlertDialogTitle>
          <AlertDialogDescription>
            <span className="font-medium text-foreground">{current?.itemName}</span>
            {" — "}
            {current?.consequence}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={cn(destructive && buttonVariants({ variant: "destructive" }))}
            onClick={() => store.settle(true)}
          >
            {current?.confirmLabel ?? (destructive ? "Delete" : "Confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
