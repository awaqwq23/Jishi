# 安全加固部署说明

这些文件是待验证的部署配置；不能直接覆盖 Certbot 管理的生产 Nginx 配置。

## 认证和代理

- 公开服务仅使用 jishi_session Cookie 登录。客户端传入的 oai-authenticated-user-*、x-auth-request-* 默认不再被当作身份。
- 独立认证网关确需接入时，配置独立 AUTH_PROXY_SECRET（至少 32 个随机字符），由网关覆盖 x-jishi-auth-proxy-secret。此值不得发给浏览器。普通生产部署不配置该选项。
- ALLOWED_ORIGINS 必须包含实际使用的 HTTPS origin，包括 https://awaqwq233.com、https://jishi.awaqwq233.com 和已验证的旧客户端备用站 origin；不要填 /note 路径。
- 仅在 API 绑定 127.0.0.1、可信代理覆盖 X-Real-IP 后设置 TRUST_PROXY_HEADERS=true。多级代理需先验证来源链，不能直接信任公网提供的 X-Forwarded-For。
- 新迁移 0002 增加认证限流表，保存时间桶与身份摘要，不保存原始邮箱/IP。
- 建议在实际 Nginx 配置的 API location 中清空所有上述身份头以及 x-jishi-auth-proxy-secret，作为第二道保护。需要认证网关的独立部署例外。
- 拒绝 /cdn-cgi/local/、点文件、源码和依赖路径的公网请求；保留 /.well-known/ 证书续期路径。核查认证限流的拒绝状态使用 JSON 429，而不是 Nginx 默认 HTML 503。

## 进程、文件与传输

- systemd 模板增加 UMask=0077、ProtectSystem=strict 和内核/权限保护，保留运行目录写入权限。必须在 Linux 暂存验证后合并生产单元。
- 检查 /var/lib/jishi 与备份目录仅授权服务账号/root 访问；SQLite/WAL/SHM、媒体和秘密配置不得公开读取。
- API/Web 只监听回环地址，公网只开放确有需要的 SSH、HTTP/HTTPS。多级反向代理每段使用 TLS 且验证上游证书，不使用 proxy_ssl_verify off。
- 密码现有 PBKDF2-HMAC-SHA256、独立随机盐及签名会话保持兼容。备份加密不等于在线数据库加密，更不等于端到端加密；在线数据仍由服务端读取，需依靠权限、网络隔离和主机防护。

## 加密备份与恢复

scripts/backup-crypto.mjs 使用 Node 内置 AES-256-GCM、每次随机 IV 和完整性标签。错误密钥、截断或篡改不能生成最终还原文件；输出使用排他创建，拒绝覆盖已有文件。密钥文件必须是 32 字节、非符号链接，Linux 权限为 600。

准备时在独立于代码、数据库与备份目录的 /etc/jishi/backup.key 创建密钥。密钥必须另行安全保管，不能仅与备份一起存放；丢失密钥将无法恢复。示例命令中的所有文件路径需在本次生产方案中替换为经过检查的准确绝对路径。

```bash
sudo install -d -m 0700 /etc/jishi
sudo node /opt/jishi/scripts/backup-crypto.mjs create-key /etc/jishi/backup.key
# 停服务后生成代表部署前状态的 tar，随后加密并做还原校验。
sudo node /opt/jishi/scripts/backup-crypto.mjs encrypt /var/backups/jishi/RELEASE/production.tar /var/backups/jishi/RELEASE/production.tar.aesgcm /etc/jishi/backup.key
sudo node /opt/jishi/scripts/backup-crypto.mjs decrypt /var/backups/jishi/RELEASE/production.tar.aesgcm /var/backups/jishi/RELEASE/verified.tar /etc/jishi/backup.key
sudo cmp /var/backups/jishi/RELEASE/production.tar /var/backups/jishi/RELEASE/verified.tar
```

验证后才能移除本次备份目录中的明文 tar 与验证临时文件。保留加密包、公开 SHA256 校验值及恢复说明；不要把密钥值写入恢复说明。已有备份只在新版本全部验证通过后按 AGENTS.md 的保留规则清理。首次启用加密备份前必须确认密钥的独立保管方式。
