# 1GB Linux 自托管

此方案由三个低内存服务组成：记时应用、本地 SQLite/D1 运行时、GitHub OAuth 网关。总内存上限约 664MB，业务数据和图片持久化在 `jishi_data` 卷。

1. 在 GitHub 创建 OAuth App，回调地址填写 `https://你的域名/oauth2/callback`。
2. 复制 `.env.selfhost.example` 为 `.env` 并填写三项 OAuth 值。
3. 执行 `docker compose up -d --build`。
4. 将现有 HTTPS 反向代理指向服务器的 `127.0.0.1:8080`；不要把应用容器的 3000 端口直接暴露到公网，因为身份头只应由 OAuth 网关注入。
5. 将 Windows、Android、鸿蒙端配置中的服务地址改成这个 HTTPS 域名。

回收站的 30 天清理会在用户同步时自动执行。数据库迁移在容器启动时自动应用。
