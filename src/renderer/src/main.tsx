import { TooltipProvider } from "@/components/ui/tooltip";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ChatPage } from "./features/chat/ChatPage";
import { Toaster } from "@/components/ui/sonner";
import { ConfirmHost } from "@/lib/confirm";
import "./index.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root element not found");
createRoot(rootEl).render(
  <StrictMode>
    <TooltipProvider delayDuration={200}>
      <ChatPage />
    </TooltipProvider>
    <Toaster />
    <ConfirmHost />
  </StrictMode>,
);
