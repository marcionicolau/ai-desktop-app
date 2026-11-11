import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ChatPage } from "./features/chat/ChatPage";
import "./index.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root element not found");
createRoot(rootEl).render(
  <StrictMode>
    <ChatPage />
  </StrictMode>,
);
