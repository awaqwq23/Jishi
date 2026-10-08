# Web / PWA 客户端

从仓库根目录运行 `npm ci`，再用 `npm run dev:web` 开发。Vite 开发服务将 `/api` 代理到本机 8787；可通过忽略的 `.env.local` 配置 `API_UPSTREAM` 和公开的 `NEXT_PUBLIC_API_URL`。

`npm run build:web` 执行 TypeScript 检查和静态构建；`npm start --workspace @jishi/web` 用 Node 提供页面和 API 代理。同一构建支持根路径与 `/note`。安装包和 Web 更新流程见 [运维说明](../../docs/OPERATIONS.md)。
