# Windows 客户端

修改 `app-config.json` 中的 `webUrl` 即可切换服务器。执行 `npm install && npm run build` 后，安装程序位于 `dist/`。

0.4.5 使用隔离的 preload 桥接系统通知，并把未来 21 天的提醒同步到 Electron 主进程。关闭主窗口后应用会驻留系统托盘以继续计时；需要完全退出时使用托盘菜单中的“退出”。
