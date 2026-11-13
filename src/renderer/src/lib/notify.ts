// feature 026 (FR-002): the only way to show transient feedback.
// Contract: specs/026-ux-interface-overhaul/contracts/feedback.md
// A thin policy layer over Sonner — success auto-dismisses, errors persist
// and may carry a recovery action, progress toasts update in place.
import { createElement } from "react";
import { toast, type ExternalToast } from "sonner";

export interface NoticeAction {
  label: string;
  run: () => void;
}

export interface NoticeOptions {
  description?: string;
  action?: NoticeAction;
}

// the subset of Sonner's API the policy needs — injectable for tests
export interface ToastSink {
  success(message: string, opts?: ExternalToast): string | number;
  error(message: string, opts?: ExternalToast): string | number;
  info(message: string, opts?: ExternalToast): string | number;
  warning(message: string, opts?: ExternalToast): string | number;
  loading(message: string, opts?: ExternalToast): string | number;
  dismiss(id?: string | number): void;
}

export const SUCCESS_MS = 4000;

// FR-018: a long error/detail must not blow the toast open — clamp it and
// keep the full text on the element's title so hover reveals it
export const MAX_DESC = 240;
function desc(text: string): ExternalToast["description"] {
  if (text.length <= MAX_DESC) return text;
  return createElement("span", { title: text, className: "line-clamp-3" }, text);
}

export interface ProgressHandle {
  update(percent: number): void;
  done(title: string): void;
  fail(title: string, opts?: NoticeOptions): void;
}

function toExternal(opts: NoticeOptions | undefined): ExternalToast {
  const out: ExternalToast = {};
  if (opts?.description) out.description = desc(opts.description);
  if (opts?.action) {
    const { label, run } = opts.action;
    out.action = { label, onClick: () => run() };
  }
  return out;
}

export function createNotify(sink: ToastSink) {
  return {
    success(title: string, opts?: NoticeOptions) {
      return sink.success(title, { ...toExternal(opts), duration: SUCCESS_MS });
    },
    info(title: string, opts?: NoticeOptions) {
      return sink.info(title, { ...toExternal(opts), duration: SUCCESS_MS });
    },
    warning(title: string, opts?: NoticeOptions) {
      return sink.warning(title, { ...toExternal(opts), duration: Infinity });
    },
    // errors stay until dismissed so a recovery action is never missed
    error(title: string, opts?: NoticeOptions) {
      return sink.error(title, {
        ...toExternal(opts),
        duration: Infinity,
        closeButton: true,
      });
    },
    // one toast, updated in place: loading → success | error
    progress(id: string, title: string): ProgressHandle {
      sink.loading(title, { id, duration: Infinity });
      return {
        update(percent) {
          const pct = Math.max(0, Math.min(100, Math.round(percent)));
          sink.loading(title, { id, description: `${pct}%`, duration: Infinity });
        },
        done(doneTitle) {
          sink.success(doneTitle, { id, description: undefined, duration: SUCCESS_MS });
        },
        fail(failTitle, opts) {
          sink.error(failTitle, {
            ...toExternal(opts),
            id,
            duration: Infinity,
            closeButton: true,
          });
        },
      };
    },
    dismiss(id?: string | number) {
      sink.dismiss(id);
    },
  };
}

export const notify = createNotify(toast as unknown as ToastSink);
