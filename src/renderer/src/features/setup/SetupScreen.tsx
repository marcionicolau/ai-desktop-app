// feature 022: first-run setup gate (audio-tts pattern) — branded screen
// listing each provisioned model and the role it will fill. Rendered as
// an overlay while setup is in-flight; the skip escape drops to the
// model library, which stays the manual fallback (spec FR-006).
import { IconDot, IconError, IconSpinner, IconSuccess } from "@/components/icons";
import type { SetupState, SetupTargetStatus } from "@shared/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { useRoles } from "../roles/use-roles";

function formatBytes(n: number): string {
  if (n >= 1 << 30) return `${(n / (1 << 30)).toFixed(1)} GB`;
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(0)} MB`;
  return `${(n / 1024).toFixed(0)} KB`;
}

function StepIcon({ status }: { status: SetupTargetStatus }) {
  if (status === "done")
    return <IconSuccess className="size-4 text-primary" />;
  if (status === "error") return <IconError className="size-4 text-destructive" />;
  if (status === "downloading" || status === "loading")
    return <IconSpinner className="size-4 animate-spin text-primary" />;
  return <IconDot className="size-4 text-muted-foreground" />;
}

export function SetupScreen({
  state,
  onRetry,
  onSkip,
}: {
  state: SetupState;
  onRetry: () => void;
  onSkip: () => void;
}) {
  const { tags } = useRoles();
  const { phase } = state;

  const checkStatus: SetupTargetStatus =
    phase === "checking"
      ? "downloading" // active spinner style
      : "done";
  const loadStatus: SetupTargetStatus =
    phase === "loading" ? "loading" : phase === "done" ? "done" : "pending";

  return (
    // setup is a blocking first-run step: a modal Dialog that ignores
    // outside clicks and Escape (the Skip action is the explicit way out)
    <Dialog open onOpenChange={() => {}}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[90vh] overflow-y-auto sm:max-w-lg"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-center text-2xl font-semibold">Causerie</DialogTitle>
          <DialogDescription className="text-center">
            Setting up your local AI
          </DialogDescription>
        </DialogHeader>

        <div className="mt-8 space-y-3">
          <div className="flex items-center gap-3">
            <StepIcon status={checkStatus} />
            <span className="text-sm">Checking for models</span>
          </div>

          {state.targets.map((t) => {
            const pct =
              t.totalBytes && t.totalBytes > 0
                ? Math.round((t.downloadedBytes / t.totalBytes) * 100)
                : null;
            return (
              <div key={t.role} className="space-y-1.5">
                <div className="flex items-center gap-3">
                  <StepIcon status={t.status} />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {t.fileName}
                  </span>
                  <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-2xs uppercase tracking-wide text-muted-foreground">
                    {t.role}
                  </span>
                </div>
                {t.status === "downloading" && (
                  <div className="pl-7">
                    <Progress value={pct ?? 0} />
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t.totalBytes
                        ? `${formatBytes(t.downloadedBytes)} of ${formatBytes(t.totalBytes)}`
                        : "Starting…"}
                      {pct !== null ? ` — ${pct}%` : ""}
                    </p>
                  </div>
                )}
              </div>
            );
          })}

          <div className="flex items-center gap-3">
            <StepIcon status={loadStatus} />
            <span className="text-sm">Loading model</span>
          </div>
        </div>

        {tags.length > 0 && (
          <div className="mt-8">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Role assignments
            </p>
            <div className="mt-2 space-y-1.5">
              {tags.map((tag) => {
                const target = state.targets.find((t) => t.role === tag.name);
                const detail = target
                  ? `${target.fileName} (${target.status})`
                  : (tag.resolvedFile?.name ??
                    tag.binding ??
                    "not assigned");
                return (
                  <div
                    key={tag.name}
                    className="flex items-baseline justify-between gap-3 text-xs"
                  >
                    <span className="font-medium">{tag.name}</span>
                    <span className="min-w-0 truncate text-muted-foreground">
                      {detail}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {phase === "error" && (
          <div className="mt-8">
            <Alert variant="destructive">
              <IconError aria-hidden="true" />
              <AlertTitle>Setup failed</AlertTitle>
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
            <div className="mt-4 flex items-center justify-center gap-3">
              <Button onClick={onRetry}>Retry setup</Button>
              <button
                className="text-sm text-muted-foreground underline-offset-4 hover:underline"
                onClick={onSkip}
              >
                Skip — choose a model manually
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
