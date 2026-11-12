import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ChatPage } from "./features/chat/ChatPage";
import "./index.css";

// dev-only: attach the react-devtools standalone backend (bun run dev:devtools)
// before React renders so the hook registers on the real root
if (import.meta.env.DEV) {
  const s = document.createElement("script");
  s.src = "http://localhost:8097";
  s.async = false;
  document.head.prepend(s);
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root element not found");
createRoot(rootEl).render(
  <StrictMode>
    <ChatPage />
  </StrictMode>,
);
