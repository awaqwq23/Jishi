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
});
