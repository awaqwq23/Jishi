# 记时

一个面向 Web、Windows、Android、HarmonyOS 的多用户待办与提醒软件。四端复用同一套响应式界面和云端数据，支持 OAuth 登录、自动同步、筛选、滑动完成/删除、回收站、分类与提醒预设、主题和背景图片。

## 本地运行

需要 Node.js 22.13 或更高版本。

```bash
npm install
npm run dev
```

浏览器访问 `http://localhost:3000`。本地预览自动使用演示账号并写入项目内的本地 D1 状态。

## 校验

```bash
npm run lint
npm test
```

## 四端

- Web/PWA：项目根目录，可安装到桌面并使用系统通知。
- Windows：`platforms/windows` Electron 工程。
- Android：`platforms/android` Capacitor 工程。
- HarmonyOS：`platforms/harmony` DevEco Studio Stage 工程。

各端在生产构建前需要将 `JISHI_SERVER_URL` 或 ArkTS 中的 `appUrl` 指向同一个 HTTPS 服务地址。

## 部署

默认站点发布使用 D1、R2 和平台 OAuth。若部署到 1GB Linux 服务器，使用根目录的 `docker-compose.yml`；详细步骤见 `deploy/selfhost/README.md`。

## 数据与安全

- 每条记录按 OAuth 用户 ID 隔离。
- 删除采用软删除，回收站记录 30 天后自动清理。
- 图片限制为 5MB 并存储在对象存储中。
- 自托管模式仅通过 OAuth 网关暴露应用，禁止直接公开内部 3000 端口。
