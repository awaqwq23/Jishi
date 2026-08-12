/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow, shell } = require("electron");

const APP_URL = process.env.JISHI_SERVER_URL || "http://localhost:3000";

function createWindow() {
  const window = new BrowserWindow({
    width: 1180, height: 780, minWidth: 760, minHeight: 560,
    backgroundColor: "#f4f0e8", title: "记时",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.loadURL(APP_URL);
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (new URL(url).origin === new URL(APP_URL).origin) return { action: "allow" };
    void shell.openExternal(url); return { action: "deny" };
  });
}

app.whenReady().then(() => { createWindow(); app.on("activate", () => BrowserWindow.getAllWindows().length || createWindow()); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
