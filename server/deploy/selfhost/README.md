# 1GB Linux 自托管

此方案由三个独立低内存服务组成：Web 客户端、API 服务器和 Nginx 网关。用户使用邮箱和密码注册登录，业务数据和图片持久化在 `jishi_data` 卷。

1. 复制 `server/.env.selfhost.example` 为仓库根目录的 `.env`，使用 `openssl rand -hex 32` 生成 `AUTH_SECRET`。
2. 执行 `docker compose up -d --build`。
3. 将现有 HTTPS 反向代理指向服务器的 `127.0.0.1:8080`，不要把应用容器的 3000/8787 端口直接暴露到公网。
4. 将 Windows、Android、鸿蒙端配置中的服务地址改成这个 HTTPS 域名。

回收站的 30 天清理会在用户同步时自动执行。数据库迁移在容器启动时自动应用。
