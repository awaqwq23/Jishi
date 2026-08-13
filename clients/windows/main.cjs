/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow, net, shell } = require("electron");
const path = require("node:path");
const config = require(path.join(__dirname, "app-config.json"));
const { resolveAppUrl, uniqueUrls } = require(path.join(__dirname, "host-resolver.cjs"));

const APP_URLS = uniqueUrls([process.env.JISHI_WEB_URL, config.webUrl, ...(config.fallbackUrls || [])]);
const APP_ORIGINS = [...new Set(APP_URLS.map((url) => new URL(url).origin))];
const SMOKE_TEST = process.argv.includes("--jishi-smoke-test");
let downloadHandlerInstalled = false;

function createWindow(appUrl) {
  const window = new BrowserWindow({
    width: 1180, height: 780, minWidth: 760, minHeight: 560,
    backgroundColor: "#f4f0e8", title: "记时",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.webContents.setUserAgent(`${window.webContents.getUserAgent()} JishiWindows/${app.getVersion()}`);
  if (!downloadHandlerInstalled) {
    downloadHandlerInstalled = true;
    window.webContents.session.on("will-download", (_event, item) => {
      item.once("done", (_downloadEvent, state) => {
        if (state === "completed") shell.showItemInFolder(item.getSavePath());
      });
    });
  }
  void window.loadURL(appUrl);
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (APP_ORIGINS.includes(new URL(url).origin)) return { action: "allow" };
    void shell.openExternal(url); return { action: "deny" };
  });
}

async function openWindow() {
  try {
    const appUrl = await resolveAppUrl(APP_URLS, net.fetch);
    if (SMOKE_TEST) { console.log(`JISHI_RESOLVED_URL=${appUrl}`); app.quit(); return; }
    createWindow(appUrl);
  } catch (error) {
    if (SMOKE_TEST) { console.error(error); app.exit(1); return; }
    const window = new BrowserWindow({ width: 720, height: 480, backgroundColor: "#f4f0e8", title: "记时" });
    const message = encodeURIComponent("记时服务器暂时无法连接，请检查网络后重新打开应用。");
    void window.loadURL(`data:text/html;charset=utf-8,<meta charset=utf-8><title>记时</title><style>body{font-family:sans-serif;background:%23f4f0e8;color:%2345433f;display:grid;place-content:center;height:100vh;margin:0;text-align:center}h1{font-size:28px}p{color:%23736d64}</style><h1>暂时无法连接</h1><p>${message}</p>`);
  }
}

app.whenReady().then(() => { void openWindow(); app.on("activate", () => BrowserWindow.getAllWindows().length || void openWindow()); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
