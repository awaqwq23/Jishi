/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow, ipcMain, Menu, net, Notification, shell, Tray } = require("electron");
const path = require("node:path");
const config = require(path.join(__dirname, "app-config.json"));
const { resolveAppUrl, uniqueUrls } = require(path.join(__dirname, "host-resolver.cjs"));

const APP_URLS = uniqueUrls([process.env.JISHI_WEB_URL, config.webUrl, ...(config.fallbackUrls || [])]);
const APP_ORIGINS = [...new Set(APP_URLS.map((url) => new URL(url).origin))];
const SMOKE_TEST = process.argv.includes("--jishi-smoke-test");
let downloadHandlerInstalled = false;
const reminderTimers = new Map();
let tray;
let mainWindow;
let isQuitting = false;

app.setAppUserModelId("cn.jishi.todo");

function showNativeNotification(window, title, body) {
  if (!Notification.isSupported()) return;
  const notification = new Notification({ title: String(title).slice(0, 120), body: String(body).slice(0, 500), silent: false });
  notification.on("click", () => { if (window && !window.isDestroyed()) { window.show(); window.focus(); } });
  notification.show();
}

function syncNativeReminders(window, payload) {
  for (const timer of reminderTimers.values()) clearTimeout(timer);
  reminderTimers.clear();
  let reminders;
  try { reminders = JSON.parse(String(payload)); } catch { return; }
  if (!Array.isArray(reminders)) return;
  const now = Date.now();
  for (const reminder of reminders.slice(0, 300)) {
    const key = String(reminder?.key || ""); const at = Number(reminder?.at);
    if (!key || !Number.isFinite(at) || at <= now || at - now > 21 * 86400000) continue;
    const timer = setTimeout(() => { reminderTimers.delete(key); showNativeNotification(window, reminder.title || "记时提醒", reminder.body || "计划时间已到"); }, at - now);
    reminderTimers.set(key, timer);
  }
}

function isTrustedSender(event) {
  try { return APP_ORIGINS.includes(new URL(event.senderFrame.url).origin); } catch { return false; }
}

function createWindow(appUrl) {
  const window = new BrowserWindow({
    width: 1180, height: 780, minWidth: 760, minHeight: 560,
    backgroundColor: "#f4f0e8", title: "记时",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, "preload.cjs") },
  });
  mainWindow = window;
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
  window.on("close", (event) => {
    if (isQuitting || !tray) return;
    event.preventDefault();
    window.hide();
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (APP_ORIGINS.includes(new URL(url).origin)) return { action: "allow" };
    void shell.openExternal(url); return { action: "deny" };
  });
}

async function installTray() {
  const icon = await app.getFileIcon(process.execPath, { size: "small" });
  tray = new Tray(icon);
  tray.setToolTip("记时 · 提醒在后台运行");
  const showWindow = () => { if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); } };
  tray.on("click", showWindow);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "打开记时", click: showWindow },
    { type: "separator" },
    { label: "退出", click: () => { isQuitting = true; app.quit(); } },
  ]));
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

ipcMain.on("jishi:notify", (event, title, body) => { if (isTrustedSender(event)) showNativeNotification(BrowserWindow.fromWebContents(event.sender), title, body); });
ipcMain.on("jishi:sync-reminders", (event, payload) => { if (isTrustedSender(event)) syncNativeReminders(BrowserWindow.fromWebContents(event.sender), payload); });
ipcMain.handle("jishi:notification-permission", (event) => isTrustedSender(event) && Notification.isSupported() ? "granted" : "denied");

app.whenReady().then(async () => {
  try { await installTray(); } catch (error) { console.warn("Unable to create the system tray; closing the window will exit.", error); }
  await openWindow();
  app.on("activate", () => mainWindow && !mainWindow.isDestroyed() ? (mainWindow.show(), mainWindow.focus()) : void openWindow());
});
app.on("before-quit", () => { isQuitting = true; });
app.on("window-all-closed", () => { if (!tray && process.platform !== "darwin") app.quit(); });
