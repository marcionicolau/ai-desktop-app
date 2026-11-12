// Main-process entrypoint: window bootstrap + RPC registration.
import { BrowserWindow } from "electrobun/main/browser-window";
import { createRpc } from "./rpc/handlers";

const DEV_URL = process.env.VITE_DEV_URL;
const url = DEV_URL ?? "views://main/index.html";

// feature 017: the view factory resolves the main window lazily — it only
// runs when an extension view is opened (after the window exists)
let mainWindow: BrowserWindow | null = null;
const { rpc, start } = createRpc(() =>
  mainWindow
    ? { windowId: mainWindow.id, webviewId: mainWindow.webviewId }
    : null,
);

mainWindow = new BrowserWindow({
  title: "Causerie",
  url,
  rpc,
  frame: { width: 1024, height: 720, x: 200, y: 200 },
});

start();
