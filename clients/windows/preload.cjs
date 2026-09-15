const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("JishiNative", {
  notify(title, body, key) {
    ipcRenderer.send("jishi:notify", String(title), String(body), String(key));
  },
  requestNotificationPermission() {
    return ipcRenderer.invoke("jishi:notification-permission");
  },
  notificationPermissionState() {
    return ipcRenderer.invoke("jishi:notification-permission");
  },
  syncReminders(payload) {
    ipcRenderer.send("jishi:sync-reminders", String(payload));
  },
  downloadUpdate(payload) {
    return ipcRenderer.invoke("jishi:update-download-start", String(payload));
  },
  updateDownloadState() {
    return ipcRenderer.invoke("jishi:update-download-state");
  },
  onUpdateDownload(listener) {
    if (typeof listener !== "function") return () => {};
    const receive = (_event, state) => listener(state);
    ipcRenderer.on("jishi:update-download", receive);
    return () => ipcRenderer.removeListener("jishi:update-download", receive);
  },
});
