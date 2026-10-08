# 运维与发布

正式站点：`https://awaqwq233.com/note/`，备用站：`https://jishi.awaqwq233.com/`。

## 目录

| 位置 | 用途 |
|---|---|
| `clients/` | Web、Windows、Android、HarmonyOS 源码 |
| `server/` | API、完整数据库迁移链、可复用部署配置 |
| `scripts/` | 构建、版本校验、发布与维护工具 |
| `docs/` | 当前运维说明和最近两代版本记录 |
| `releases/current/` | 当前交付包、清单、SHA-256 |
| `releases/previous/` | 上一代交付包及校验信息 |
| `.local/` | Git 忽略的本机工具、缓存、凭据与签名材料 |

单一根 `package-lock.json` 管理所有 npm workspace；在根目录运行 `npm ci`，不再维护重复子端锁文件。所有构建产物只用于待发布验证，发布槽位不保存未完成或未签名的候选包。

## 生产目录

代码 `/opt/jishi`；数据库与媒体 `/var/lib/jishi`；公开下载及更新清单 `/var/www/jishi-downloads`；发布暂存 `/opt/jishi-staging`；回退备份 `/var/backups/jishi`。不得清理其他服务目录。

生产服务是 `jishi-api`、`jishi-web`、`nginx`。API 使用单一 Wrangler 实例，Web 使用 Node 静态服务，Nginx 保留生产 HTTPS 与 `/note` 路由。Web 同时处理根路径与 `/note`，API 错误与代理失败返回 JSON。

## 发布和强制更新

1. 完成代码、迁移和原生版本号；运行 Server、Web、Windows 检查，构建并验收对应安装包，审计不得有 high/critical。
2. 新包核验后进入 `releases/current`，原当前包移到 `releases/previous`；只保留两代。生成 Web 稳定哈希、更新清单、SHA-256。清单默认 `required=true`，已安装客户端必须更新；旧 API 和 Cookie 保持兼容。
3. 提交推送代码，公开 GitHub Release 核验包大小、SHA-256 与下载链接。
4. 在 Linux 独立暂存安装依赖、执行完整迁移、构建/测试/审计，复算 Web 哈希；验证 Wrangler、Node Web 启动入口以及完整 systemd 限制组合。
5. 展示准确生产命令、新备份位置、短暂停机与回滚方式，取得本次明确确认后切换。先 API 与迁移、再 Web、最后 Nginx。
6. 检查公网、主备站、JSON 401、真实账号 bootstrap、新表与旧数据、清单、旧客户端状态码。全部成功后再清理旧暂存和旧备份，最终只保留本次创建的上一版本备份。

## 秘密与回退

生产 `server/.dev.vars` 必须存在、为普通文件、服务账号所有、权限 600，`AUTH_SECRET` 长度至少 32；只检查条件，不能输出内容。同步必须排除 `.dev.vars`、`.dev.vars.*`、`.env`、`.env.*`，保留数据库、媒体与更新清单。备份必须覆盖切换前完整生产状态，采用现有服务器密钥加密；密钥不能进入仓库、输出或发布包。

2026-08-16 部署曾删除生产 `.dev.vars`，引起登录 HTTP 500。秘密文件门禁必须在同步前和 API 重启前各检查一次。不得用仓库 Nginx 模板覆盖 Certbot 维护的生产配置。不得在 API 正在运行时用第二个 Wrangler 进程访问 `/var/lib/jishi`。

## 鸿蒙当前限制

应用包名 `cn.jishi.todo`，APP ID `6917615912834362075`。已有发布证书与 Profile，有效期至 2029-09-18；签名材料保存在忽略目录，密码由开发者本人保管。当前 Profile 尚未授予代理提醒。华为要求真实提醒设置截图与已保存分类截图，分类已保存为“应用 / 效率”，标签“日程清单”。获得能力后须更新 Profile 并重新签包、真机验证后台通知。签名测试 HAP 与本地 APP 候选的校验不能代替正式上架或真机验收；未签名或被拒绝的 APP 不得交付。

应用市场图标需与应用一致且为合规方形图；现有横幅不能直接替代。正式审核资料和协议需要开发者本人确认。
