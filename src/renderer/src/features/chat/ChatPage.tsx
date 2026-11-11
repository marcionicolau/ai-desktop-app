import { useChat } from "./use-chat";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";

export function ChatPage() {
  const { state, send, stop } = useChat();
  const modelReady = state.modelStatus === "ready";

  return (
    <main className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border px-4 py-2">
        <h1 className="text-sm font-semibold">AI Desktop App</h1>
        <span className="text-xs text-muted-foreground">
          model: {state.modelStatus}
          {state.modelError ? ` (${state.modelError})` : ""}
        </span>
      </header>
      {state.modelStatus === "unloaded" && (
        <div className="border-b border-border bg-muted px-4 py-2 text-center text-sm text-muted-foreground">
          No model is loaded — messages will be rejected until one is loaded.
        </div>
      )}
      {state.lastError && (
        <div className="border-b border-border bg-red-950 px-4 py-2 text-center text-sm text-red-300">
          {state.lastError.code}: {state.lastError.message}
        </div>
      )}
      <MessageList messages={state.messages} />
      <Composer
        generating={state.generatingId !== null}
        modelReady={modelReady}
        onSend={(c) => void send(c)}
        onStop={stop}
      />
    </main>
  );
}
