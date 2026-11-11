import { useState } from "react";
import { Library, Settings2 } from "lucide-react";
import { useChat } from "./use-chat";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { Sidebar } from "./Sidebar";
import { ModelPicker } from "../models/ModelPicker";
import { ModelLibrary } from "../models/ModelLibrary";
import { GenerationSettings } from "../settings/GenerationSettings";
import { Button } from "@/components/ui/button";

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
    saveGeneration,
    regenerate,
    editMessage,
    loadModel,
  } = useChat();
  const modelReady = state.modelStatus === "ready";
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);

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
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Model library"
              onClick={() => setLibraryOpen((v) => !v)}
            >
              <Library className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Generation settings"
              onClick={() => setSettingsOpen((v) => !v)}
            >
              <Settings2 className="h-4 w-4" />
            </Button>
            <ModelPicker
            status={state.modelStatus}
            name={state.modelName}
            error={state.modelError}
            onPick={() => void pickModel()}
          />
          </div>
        </header>
        {settingsOpen && (
          <GenerationSettings
            value={state.generation}
            onSave={saveGeneration}
          />
        )}
        {libraryOpen && (
          <ModelLibrary
            activeName={state.modelName}
            onLoad={(p) => void loadModel(p)}
          />
        )}
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
        {state.notice && (
          <div className="border-b border-border bg-amber-950 px-4 py-2 text-center text-sm text-amber-300">
            {state.notice}
          </div>
        )}
        {state.lastError && (
          <div className="border-b border-border bg-red-950 px-4 py-2 text-center text-sm text-red-300">
            {state.lastError.code}: {state.lastError.message}
          </div>
        )}
        <MessageList
          messages={state.messages}
          generating={state.generatingId !== null}
          onRegenerate={(id) => void regenerate(id)}
          onEdit={(id, c) => void editMessage(id, c)}
        />
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
