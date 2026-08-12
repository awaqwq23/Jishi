# 记时四端工程

- `../`：Web/PWA 主应用，同时提供所有业务界面和同步 API。
- `windows/`：Electron 桌面外壳，通过 `JISHI_SERVER_URL` 指向已部署的 HTTPS 地址。
- `android/`：Capacitor Android 外壳，首次运行 `npm install && npx cap add android`，再同步打开 Android Studio。
- `harmony/`：DevEco Studio Stage 模型工程；发布前将 `Index.ets` 中的地址替换为部署地址并配置签名与应用图标。

四端不保存独立业务数据，统一通过云端账号同步；主题等设备展示偏好也会写入账号设置。
