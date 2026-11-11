// Main-process entrypoint: window bootstrap + RPC registration.
import { BrowserWindow } from "electrobun/main/browser-window";
import { createRpc } from "./rpc/handlers";

const DEV_URL = process.env.VITE_DEV_URL;
const url = DEV_URL ?? "views://main/index.html";

createRpc();

new BrowserWindow({
  title: "AI Desktop App",
  url,
  frame: { width: 1024, height: 720, x: 200, y: 200 },
});
