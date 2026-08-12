# 独立服务器端

服务器端负责邮箱密码认证、多用户数据隔离、任务/分类/预设 CRUD、图片存储、回收站和 30 天清理，不包含任何客户端界面。密码使用 PBKDF2-SHA256 加盐哈希，会话保存在带签名的 HttpOnly Cookie 中。

- 本地开发：`npm install && npm run dev`
- 类型和部署检查：`npm run check`
- Cloudflare 部署：`npm run deploy`
- Linux 自托管：参阅 `deploy/selfhost/README.md`

Cloudflare 环境使用 D1 和 R2；自托管环境由仓库根目录的 `docker-compose.yml` 统一启动。修改 CORS 允许来源时，配置 `ALLOWED_ORIGINS`。

生产环境必须设置至少 32 个字符的 `AUTH_SECRET`，并使用 HTTPS；不要提交 `.dev.vars` 或服务器端密钥。
