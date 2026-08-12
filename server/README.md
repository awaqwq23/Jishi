# 独立服务器端

服务器端负责多用户身份、任务/分类/预设 CRUD、图片存储、回收站和 30 天清理，不包含任何客户端界面。

- 本地开发：`npm install && npm run dev`
- 类型和部署检查：`npm run check`
- Cloudflare 部署：`npm run deploy`
- Linux 自托管：参阅 `deploy/selfhost/README.md`

Cloudflare 环境使用 D1 和 R2；自托管环境由仓库根目录的 `docker-compose.yml` 统一启动。修改 CORS 允许来源时，配置 `ALLOWED_ORIGINS`。
