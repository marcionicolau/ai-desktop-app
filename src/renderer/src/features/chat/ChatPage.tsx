import { useChat } from "./use-chat";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { Sidebar } from "./Sidebar";
import { ModelPicker } from "../models/ModelPicker";

export function ChatPage() {
  const {
    state,
    send,
    stop,
    selectConversation,
    newConversation,
    renameConversation,
    deleteConversation,
    pickModel,
  } = useChat();
  const modelReady = state.modelStatus === "ready";

  return (
    <main className="flex h-screen bg-background text-foreground">
      <Sidebar
        conversations={state.conversations}
        activeId={state.conversationId}
        onSelect={(id) => void selectConversation(id)}
        onNew={newConversation}
        onRename={(id, t) => void renameConversation(id, t)}
        onDelete={(id) => void deleteConversation(id)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border px-4 py-2">
          <h1 className="text-sm font-semibold">AI Desktop App</h1>
          <ModelPicker
            status={state.modelStatus}
            name={state.modelName}
            error={state.modelError}
            onPick={() => void pickModel()}
          />
        </header>
        {state.modelStatus === "unloaded" && (
          <div className="border-b border-border bg-muted px-4 py-2 text-center text-sm text-muted-foreground">
            No model is loaded — pick a .gguf file to start chatting.
          </div>
        )}
        {state.modelStatus === "error" && (
          <div className="border-b border-border bg-red-950 px-4 py-2 text-center text-sm text-red-300">
            Model failed to load{state.modelError ? `: ${state.modelError}` : ""}
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
      </div>
    </main>
  );
}
