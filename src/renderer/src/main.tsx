import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

function App() {
  return (
    <main className="flex h-screen items-center justify-center bg-background text-foreground">
      <h1 className="text-2xl font-semibold">AI Desktop App</h1>
    </main>
  );
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root element not found");
createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
